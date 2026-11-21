#!/usr/bin/env python3
"""Build the sanitized ABB 580 base parameter dictionary.

Primary ground truth: a Drive Composer Pro parameter print (PDF) of an ACH580
with US units enabled. From it we take parameter IDs, group names, names, units,
min, max and factory default values.

SECURITY: the "Value" column of the print (site-specific configuration) is
NEVER written to the output. Only schema data and factory defaults are kept.

Optional enrichment (never overrides units/min/max/defaults from the print):
  --fw-enums   JSON produced by scripts/extract_fw_manual.py (firmware manual)
  --schema     one or more .dcparamsbak backups; ONLY the firmware schema is
               read from them (data type, display decimals, enum value lists,
               bit names). Their values are discarded.

Usage:
  python scripts/build_base_dict.py --pdf print.pdf \
      [--fw-enums fw_enums.json] [--schema a.dcparamsbak b.dcparamsbak] \
      --out src/data/abb580_base_dict.json
"""
import argparse
import datetime
import io
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

import pymupdf  # PyMuPDF

HEADER = ["Index", "Name", "Value", "Unit", "Min", "Max", "Default"]
COLS = ["index", "name", "value", "unit", "min", "max", "default"]
XSI = "{http://www.w3.org/2001/XMLSchema-instance}type"


def pid(group, index):
    """Canonical parameter id, e.g. (7, 3) -> '07.03', (10, 101) -> '10.101'."""
    return "%02d.%02d" % (int(group), int(index))


# ---------------------------------------------------------------------------
# Drive Composer PDF table extraction (column positions detected per page)
# ---------------------------------------------------------------------------
def extract_pdf_rows(path):
    doc = pymupdf.open(path)
    rows = []
    groups = {}
    group = None
    device = {}
    for page_no, page in enumerate(doc, start=1):
        spans = []
        for block in page.get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                for s in line["spans"]:
                    if s["text"].strip():
                        spans.append((s["bbox"][1], s["bbox"][0], s["text"].strip()))
        spans.sort()
        lines = []
        for y, x, t in spans:
            if lines and abs(lines[-1][0] - y) < 3:
                lines[-1][1].append((x, t))
            else:
                lines.append([y, [(x, t)]])
        cols = None
        header_y = None
        for y, items in lines:
            items.sort()
            if [t for _, t in items] == HEADER:
                cols = [(c, x) for c, (x, _) in zip(COLS, items)]
                header_y = y
                break
        if cols is None:
            continue

        def col_of(x):
            found = None
            for name, x0 in cols:
                if x >= x0 - 1.5:
                    found = name
            return found

        for y, items in lines:
            if y <= header_y:
                if page_no == 1:
                    # Device info block: "Model" label followed by model text
                    for x, t in items:
                        if re.match(r"^AC[HQS]580-", t):
                            device["model"] = t
                continue
            texts = [t for _, t in items]
            if texts and texts[0].startswith("Drive Composer"):
                continue
            row = {}
            for x, t in items:
                row.setdefault(col_of(x), []).append(t)
            row = {k: " ".join(v) for k, v in row.items()}
            idx = row.get("index", "")
            m = re.match(r"^(\d+)\.$", idx)
            if m and set(row) <= {"index", "name"}:
                group = int(m.group(1))
                groups[group] = row.get("name", "")
                continue
            if not re.match(r"^\d+$", idx) or group is None:
                continue
            row["group"] = group
            row["idx"] = int(idx)
            rows.append(row)
    return device, groups, rows


# ---------------------------------------------------------------------------
# Schema-only reader for .dcparamsbak (values are ignored on purpose)
# ---------------------------------------------------------------------------
def read_schema(path):
    with zipfile.ZipFile(path) as z:
        name = next(n for n in z.namelist() if n.lower().endswith(".dcparams"))
        root = ET.parse(io.BytesIO(z.read(name))).getroot()
    out = {}
    for dp in root.iter("DriveParameter"):
        d = {}
        for c in dp:
            if c.tag in ("ParameterList", "ValueNames"):
                d[c.tag] = [
                    (x.findtext("Name") or "", int(x.findtext("Value")))
                    for x in c.iter("ValueListItem")
                ]
            elif c.tag == "BitNames":
                d[c.tag] = [x.text or "" for x in c]
            else:
                d[c.tag] = c.text
        key = pid(d["Group"], d["Index"])
        out[key] = {
            "type": d.get("Type"),
            "decimals": int(d.get("DisplayDecimals") or 0),
            "enum": d.get("ValueNames") or d.get("ParameterList") or [],
            "bits": [b for b in d.get("BitNames", [])],
            "signal": d.get("IsSignal") == "true",
            "noCompare": d.get("NoCompare") == "true",
            "rawValue": d.get("RawValue"),
        }
    return out


def decimals_of(s):
    if s is None:
        return None
    m = re.match(r"^-?\d+(?:\.(\d+))?$", s)
    if not m:
        return None
    return len(m.group(1) or "")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", required=True)
    ap.add_argument("--fw-enums")
    ap.add_argument("--schema", nargs="*", default=[])
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    device, groups, rows = extract_pdf_rows(args.pdf)
    schemas = [read_schema(p) for p in args.schema]
    fw = {}
    if args.fw_enums:
        raw = json.load(open(args.fw_enums, encoding="utf-8"))
        for k, v in raw.items():
            g, i = k.split(".")
            fw[pid(g, i)] = v

    params = {}
    drive_ratings = {}
    for r in rows:
        key = pid(r["group"], r["idx"])
        entry = {
            "name": r.get("name", ""),
            "unit": r.get("unit", "") if r.get("unit") != "NoUnit" else "",
        }
        for c in ("min", "max", "default"):
            if r.get(c) not in (None, ""):
                entry[c] = r[c]
        dec = decimals_of(r.get("default")) or decimals_of(r.get("min"))
        if dec is not None:
            entry["decimals"] = dec
        # Schema enrichment (first backup that knows the parameter wins)
        enum = {}
        for sc in schemas:
            s = sc.get(key)
            if not s:
                continue
            entry.setdefault("type", s["type"])
            entry["decimals"] = s["decimals"] if s["type"] == "Decimal" else entry.get("decimals", 0)
            if s["signal"]:
                entry["signal"] = True
            if any(s["bits"]):
                last = max(i for i, b in enumerate(s["bits"]) if b)
                entry["bitNames"] = s["bits"][: last + 1]
            for label, code in s["enum"]:
                if label and label != ".":
                    enum.setdefault(str(code), label)
        fw_entry = fw.get(key)
        enum_source = "backup-schema" if enum else None
        if fw_entry and fw_entry.get("enumMap"):
            for code, label in fw_entry["enumMap"].items():
                if str(code) not in enum:
                    enum[str(code)] = label
                    enum_source = enum_source or "fw-manual"
        if enum:
            entry["enumMap"] = dict(sorted(enum.items(), key=lambda kv: int(kv[0])))
            entry["enumSource"] = enum_source
        # Repair Default labels truncated by the print column width
        d = entry.get("default")
        if enum and d and not re.match(r"^-?\d", d) and d not in enum.values():
            full = [lbl for lbl in enum.values() if lbl.startswith(d)]
            if len(full) == 1:
                entry["default"] = full[0]
        params[key] = entry

    # Drive rating id table: derived from schema raw code + printed model label.
    for sc in schemas:
        s = sc.get("07.03")
        if s and s["rawValue"] and device.get("model"):
            drive_ratings[str(int(float(s["rawValue"])))] = device["model"]

    out = {
        "meta": {
            "description": "ABB ACH580/ACQ580/ACS580 parameter schema and factory defaults (US units). "
            "Site-specific values are intentionally stripped.",
            "primarySource": "Drive Composer Pro parameter print, ACH580-01-240A-4, firmware AHVK4 2.20.0.34, US units (96.16)",
            "enrichment": ["dcparamsbak firmware schema (enum lists, data types)", "ACH580 firmware manual (enum labels)"],
            "valuesStripped": True,
            "generated": datetime.date.today().isoformat(),
            "paramCount": len(params),
        },
        "groups": {"%02d" % g: n for g, n in sorted(groups.items())},
        "driveRatings": drive_ratings,
        "params": dict(sorted(params.items(), key=lambda kv: tuple(int(x) for x in kv[0].split(".")))),
    }
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print("wrote %s: %d params, %d groups" % (args.out, len(params), len(groups)), file=sys.stderr)


if __name__ == "__main__":
    main()
