#!/usr/bin/env python3
"""Extract structured reference data from the ABB ACH580 firmware manual PDF.

Usage:
    python extract_fw_manual.py <fw_manual.pdf> <out_dir>

Outputs:
    <out_dir>/fw_enums.json   - {"GG.II": {"name": str, "enumMap": {"<code>": label}}}
    <out_dir>/fw_events.json  - [{"code": "0x7081", "kind": ..., "name": ..., "description": ...}]

Requires PyMuPDF (``pip install pymupdf``).

The parser relies on the layout of the manual tables:

* Parameter listing: four columns "No." / "Name/Value" / "Description" /
  "Def/FbEq16". A parameter row has an italic "GG.II" number in the "No."
  column and an italic name in the "Name/Value" column. Selectable values are
  plain (non-italic) rows whose "Def/FbEq16" cell is a bare integer code.
* Fault tracing: four columns "Code (hex)" / "Warning|Fault / Aux. code" /
  "Cause" / "What to do". Auxiliary codes are placed in an indented
  sub-column and are ignored.

Column x positions differ between odd and even pages, so they are detected
per page from the table header row.
"""

import json
import os
import re
import sys

import pymupdf

# Vertical distance (pt) under which two lines of the same column are treated
# as wrapped lines of one table cell. Body text line pitch is ~10.5 pt, while
# consecutive table rows are at least ~15.5 pt apart.
WRAP_GAP = 13.0
# Tolerance (pt) for matching cells that start on the same table row.
ROW_TOL = 2.0
# Tolerance (pt) for "starts at the column's left edge".
COL_TOL = 4.0

PARAM_ID_RE = re.compile(r"^(\d{2})\.(\d{2,3})$")
INT_RE = re.compile(r"^-?\d+$")
HEX4_RE = re.compile(r"^[0-9A-F]{4}$")


# ---------------------------------------------------------------------------
# Generic helpers
# ---------------------------------------------------------------------------

def clean_text(s):
    """Normalize whitespace and typographic characters."""
    s = s.replace("\u00a0", " ").replace("\u2019", "'").replace("\u2018", "'")
    s = s.replace("\u201c", '"').replace("\u201d", '"').replace("\u2013", "-")
    s = s.replace("\u2014", "-").replace("\u00ad", "")
    return re.sub(r"\s+", " ", s).strip()


SUPERSCRIPTS = {"2": "\u00b2", "3": "\u00b3"}


def page_lines(page):
    """Return a list of text lines with geometry and style information."""
    out = []
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            spans = [sp for sp in line["spans"] if sp["text"].strip()]
            if not spans:
                continue
            main_size = max(sp["size"] for sp in spans)
            main_top = min(sp["bbox"][1] for sp in spans if sp["size"] >= 0.85 * main_size)
            pieces = []
            for sp in line["spans"]:
                t = sp["text"]
                # Superscript digits (e.g. "m3/h" rendered as m + small raised 3).
                # Lowered small digits (subscripts, e.g. "inH2O") stay plain.
                if (sp["size"] < 0.85 * main_size and t.strip() in SUPERSCRIPTS
                        and sp["bbox"][1] < main_top - 0.5):
                    t = SUPERSCRIPTS[t.strip()]
                pieces.append(t)
            text = clean_text("".join(pieces))
            if not text:
                continue
            # Use the top of the first full-size span so that a superscript
            # does not shift the row position.
            normal = [sp for sp in spans if sp["size"] >= 0.85 * main_size]
            first = normal[0] if normal else spans[0]
            out.append({
                "x0": line["bbox"][0],
                "y0": first["bbox"][1],
                "x1": line["bbox"][2],
                "text": text,
                "italic": "Italic" in spans[0]["font"],
                "bold": "Bold" in spans[0]["font"],
                "size": spans[0]["size"] if spans[0] in normal else first["size"],
            })
    out.sort(key=lambda l: (round(l["y0"], 1), l["x0"]))
    return out


def find_header(lines, labels):
    """Find the table header row; return (x positions per label, header y).

    ``labels`` is a list of header texts (prefix match), left to right.
    """
    found = {}
    y = None
    for lab in labels:
        for l in lines:
            if l["bold"] and l["size"] < 12 and l["text"].startswith(lab):
                found[lab] = l["x0"]
                y = max(y or 0, l["y0"])
                break
    if len(found) != len(labels):
        return None, None
    return [found[lab] for lab in labels], y


def column_of(x, cols):
    """Index of the column containing x (cols are left edges, ascending)."""
    idx = -1
    for i, cx in enumerate(cols):
        if x >= cx - COL_TOL:
            idx = i
    return idx


def chapter_range(toc, title):
    """Return (first page, last page) (1-based) of a level-1 TOC chapter."""
    for i, (lvl, t, p) in enumerate(toc):
        if lvl == 1 and t.strip().lower() == title.lower():
            for lvl2, _t2, p2 in toc[i + 1:]:
                if lvl2 == 1:
                    return p, p2 - 1
            return p, None
    return None, None


def section_page(toc, title, start=0):
    for lvl, t, p in toc:
        if lvl == 2 and t.strip().lower() == title.lower() and p >= start:
            return p
    return None


def short_id(group, index):
    return "%d.%d" % (int(group), int(index))


def truncate(s, limit=200):
    s = clean_text(s)
    if len(s) <= limit:
        return s
    cut = s[:limit - 3]
    sp = cut.rfind(" ")
    if sp > limit // 2:
        cut = cut[:sp]
    return cut.rstrip(" ,;:") + "..."


def join_wrapped(parts):
    """Join wrapped cell lines; re-join words hyphenated across lines."""
    out = ""
    for p in parts:
        if not out:
            out = p
        elif re.search(r"[a-z]-$", out) and re.match(r"^[a-z]", p):
            out = out + p  # e.g. "Fre-" + "quency"
        else:
            out = out + " " + p
    return clean_text(out)


# ---------------------------------------------------------------------------
# Parameters chapter -> enums
# ---------------------------------------------------------------------------

PARAM_HEADER = ["No.", "Name/Value", "Description", "Def/FbEq16"]


def label_is_clean(label):
    if not label or len(label) > 60:
        return False
    if label == "%":
        return True  # unit selection option
    if label.endswith(".") and len(label.split()) > 4:
        return False  # looks like a sentence, not an option name
    if re.match(r"^[\d.,\-\u2026 %]+$", label):
        return False  # numeric range like "0...100"
    if "\u2026" in label and not re.search(r"\d\s*[A-Za-z]+$", label):
        return False  # value range without a unit, not an option name
    return True


# Glyph-level OCR-like artifacts in the manual's unit names (capital I used
# for lower-case l).
LABEL_FIXUPS = {
    "I/s": "l/s",
    "I/min": "l/min",
    "I/h": "l/h",
    "Ib/gal": "lb/gal",
}

# "For the (available) selections, see parameter 10.24 ..."
SEL_REF_RE = re.compile(
    r"for (?:the )?(?:available )?selections,? (?:and [^,]*, )?see "
    r"(?:parameter|par\.) (\d{2})\.(\d{2,3})", re.I)
# "See parameter 40.16 ..." (used e.g. by group 41 which mirrors group 40)
SEE_REF_RE = re.compile(r"^see (?:parameter|par\.) (\d{2})\.(\d{2,3})\b", re.I)
# "For (the) other selections, see parameter 84.03" (own list is partial)
OTHER_REF_RE = re.compile(
    r"for (?:the )?other (?:available )?selections,? see (?:parameter|par\.) "
    r"(\d{2})\.(\d{2,3})", re.I)


def norm_label(s):
    return re.sub(r"[^a-z0-9]+", "", s.lower())


def is_body(l):
    """Regular 9.3 pt table text (excludes diagrams, headings, footers)."""
    return 9.0 <= l["size"] <= 10.0


# A numeric value range such as "0...100 s" or "-1600.0...1600.0%".
RANGE_RE = re.compile(r"\S\u2026|\u2026\S")


def value_tables(body):
    """Parse embedded "Value | Name | Description" tables.

    Returns a list of (code string, label, code line). Tables whose first
    header is "Bit" are bit fields and are not returned.
    """
    out = []
    bold = [l for l in body if l["bold"]]
    for h in bold:
        if h["text"] != "Value":
            continue
        right = sorted((b for b in bold if abs(b["y0"] - h["y0"]) <= ROW_TOL
                        and b["x0"] > h["x0"]), key=lambda b: b["x0"])
        if not right or not right[0]["text"].startswith("Name"):
            continue
        vx, nx = h["x0"], right[0]["x0"]
        nx_end = right[1]["x0"] if len(right) > 1 else nx + 120
        rows = [l for l in body if is_body(l) and not l["bold"]
                and l["y0"] > h["y0"] + ROW_TOL and abs(l["x0"] - vx) <= COL_TOL]
        names = [l for l in body if is_body(l) and not l["bold"]
                 and l["y0"] > h["y0"] + ROW_TOL and abs(l["x0"] - nx) <= COL_TOL
                 and l["x0"] < nx_end]
        last_y = h["y0"]
        rows.sort(key=lambda l: l["y0"])
        for i, r in enumerate(rows):
            if r["y0"] - last_y > 60 or not INT_RE.match(r["text"]):
                break
            next_y = rows[i + 1]["y0"] if i + 1 < len(rows) else r["y0"] + 40
            parts, ly = [], None
            for n in sorted(names, key=lambda l: l["y0"]):
                if n["y0"] < r["y0"] - ROW_TOL or n["y0"] >= next_y - ROW_TOL:
                    continue
                if ly is None and abs(n["y0"] - r["y0"]) > ROW_TOL:
                    break
                if ly is not None and n["y0"] - ly > WRAP_GAP:
                    break
                parts.append(n["text"])
                ly = n["y0"]
            if parts:
                out.append((str(int(r["text"])), join_wrapped(parts), r))
            last_y = r["y0"]
    return out


def extract_enums(doc, first_page, last_page):
    params = {}
    order = []
    cur = None  # current parameter dict
    gaps = []  # (first pid, last pid) around "..." placeholder rows
    gap_from = None

    for pno in range(first_page, last_page + 1):
        page = doc[pno - 1]
        lines = page_lines(page)
        cols, hdr_y = find_header(lines, PARAM_HEADER)
        if cols is None:
            continue
        body = [l for l in lines if l["y0"] > hdr_y + 5 and l["size"] < 12
                and not (l["bold"] and l["text"] in PARAM_HEADER)]
        for l in body:
            l["col"] = column_of(l["x0"], cols)

        no_col = [l for l in body if l["col"] == 0]
        name_col = [l for l in body if l["col"] == 1 and is_body(l)]
        desc_col = [l for l in body if l["col"] == 2 and is_body(l)]
        def_col = [l for l in body if l["col"] == 3 and is_body(l)]

        # Events on this page in vertical order: parameter starts, group
        # headings and value rows (anchored by an integer code in Def/FbEq16).
        events = []
        for l in no_col:
            m = PARAM_ID_RE.match(l["text"])
            if m and l["italic"]:
                events.append((l["y0"], "param", l, m))
            elif l["bold"] and re.match(r"^\d{2}( |$)", l["text"]):
                events.append((l["y0"], "group", l, None))
            elif l["text"] == "\u2026":
                # Placeholder row between e.g. 52.01 and 52.12.
                events.append((l["y0"], "ellipsis", l, None))
        for l in def_col:
            if INT_RE.match(l["text"]) and not l["italic"]:
                events.append((l["y0"], "code", l, None))
        for l in desc_col:
            events.append((l["y0"], "desc", l, None))
        # A value row: plain Name/Value line at the column edge with a plain
        # Def/FbEq16 entry on the same row (bit tables have no such entry).
        plain_def = [d for d in def_col if not d["italic"]]
        for l in name_col:
            if not l["italic"] and abs(l["x0"] - cols[1]) <= COL_TOL:
                same = [d for d in plain_def if abs(l["y0"] - d["y0"]) <= ROW_TOL]
                if same:
                    # Remember whether the row is coded (bare integer in
                    # Def/FbEq16) or a scaled value range ("1 = 1 s").
                    l["coded"] = bool(INT_RE.match(same[0]["text"]))
                    events.append((l["y0"], "valrow", l, None))
        # Embedded "Value | Name | Description" tables inside a description
        # (used by a few status parameters). "Bit | Name" tables are bit
        # fields and are deliberately ignored.
        for vt_code, vt_label, vt_line in value_tables(body):
            events.append((vt_line["y0"], "vt", vt_line, (vt_code, vt_label)))
        prio = {"group": 0, "param": 1, "ellipsis": 1, "code": 2, "valrow": 3,
                "vt": 3, "desc": 4}
        events.sort(key=lambda e: (e[0], prio[e[1]], e[2]["x0"]))

        param_rows = [e[0] for e in events if e[1] in ("param", "group")]
        code_rows = [e[0] for e in events if e[1] == "code"]

        def cell(start_y, italic, stop_ys, column=None, col_x=None):
            """Collect wrapped lines of one cell starting at start_y."""
            column = name_col if column is None else column
            col_x = cols[1] if col_x is None else col_x
            parts = []
            last_y = None
            for l in column:
                if l["y0"] < start_y - ROW_TOL:
                    continue
                if abs(l["x0"] - col_x) > COL_TOL:
                    if last_y is None:
                        continue
                    break
                if last_y is None:
                    if abs(l["y0"] - start_y) > ROW_TOL:
                        return ""
                else:
                    if l["y0"] - last_y > WRAP_GAP:
                        break
                    if any(abs(l["y0"] - s) <= ROW_TOL for s in stop_ys):
                        break
                if l["italic"] != italic:
                    break
                parts.append(l["text"])
                last_y = l["y0"]
            return join_wrapped(parts)

        for y, kind, l, m in events:
            if kind == "group":
                cur = None
            elif kind == "param":
                pid = short_id(m.group(1), m.group(2))
                if pid not in params:
                    params[pid] = {
                        "name": cell(y, True, param_rows + code_rows),
                        "default": cell(y, True, param_rows + code_rows,
                                        def_col, cols[3]),
                        "enumMap": {}, "desc": [], "alltext": [],
                        "valrows": 0, "has_range": False,
                    }
                    order.append(pid)
                    if gap_from is not None:
                        gaps.append((gap_from, pid))
                        gap_from = None
                cur = params[pid]
            elif kind == "ellipsis":
                gap_from = order[-1] if order else None
                cur = None
            elif cur is None:
                continue
            elif kind == "desc":
                # Only the parameter's own description, not value-row text.
                if cur["valrows"] == 0:
                    cur["desc"].append(l["text"])
                cur["alltext"].append(l["text"])
            elif kind == "valrow":
                cur["valrows"] += 1
                if RANGE_RE.search(l["text"]) and not l["coded"]:
                    cur["has_range"] = True  # numeric range row, e.g. "0...100 s"
            elif kind == "vt":
                vt_code, vt_label = m
                if label_is_clean(vt_label):
                    cur.setdefault("vt", {}).setdefault(vt_code, vt_label)
            elif kind == "code":
                # Skip the parameter's own row (its default may be an integer).
                if any(abs(y - py) <= ROW_TOL for py in param_rows):
                    continue
                label = cell(y, False, param_rows + code_rows)
                label = LABEL_FIXUPS.get(label, label)
                if not label_is_clean(label):
                    continue
                code = str(int(l["text"]))
                cur["enumMap"].setdefault(code, label)

    # Value tables only apply when the parameter has no coded value rows.
    for pid in order:
        p = params[pid]
        if not p["enumMap"] and p.get("vt"):
            p["enumMap"] = dict(p["vt"])

    # Parameters without their own value list that refer to another
    # parameter's selections inherit that list.
    def resolve(pid, seen=()):
        p = params[pid]
        if p.get("resolved") or pid in seen:
            return p["enumMap"]
        p["resolved"] = True
        if p["has_range"]:
            # Numeric parameter; isolated special values ("0.0 s") are not
            # an enumeration.
            p["enumMap"] = {}
            return p["enumMap"]
        alltext = join_wrapped(p["alltext"])
        m = OTHER_REF_RE.search(alltext)
        if m:
            rid = short_id(m.group(1), m.group(2))
            if rid in params and rid != pid:
                merged = dict(resolve(rid, seen + (pid,)))
                merged.update(p["enumMap"])
                p["enumMap"] = merged
            return p["enumMap"]
        if p["enumMap"] or p["valrows"]:
            return p["enumMap"]
        desc = join_wrapped(p["desc"])
        m = SEL_REF_RE.search(desc)
        strict = False
        if not m:
            m = SEE_REF_RE.search(desc)
            strict = True
        if not m:
            return p["enumMap"]
        rid = short_id(m.group(1), m.group(2))
        if rid not in params or rid == pid:
            return p["enumMap"]
        ref_map = resolve(rid, seen + (pid,))
        if not ref_map:
            return p["enumMap"]
        if strict:
            # The default value must be one of the inherited selections.
            labels = {norm_label(v) for v in ref_map.values()}
            if norm_label(p["default"]) not in labels:
                return p["enumMap"]
        p["enumMap"] = dict(ref_map)
        return p["enumMap"]

    for pid in order:
        resolve(pid)

    # Parameters elided by a "..." row (e.g. 52.02...52.11 between 52.01 and
    # 52.12) share the list of the first parameter of the run.
    for first, last in gaps:
        g1, i1 = (int(x) for x in first.split("."))
        g2, i2 = (int(x) for x in last.split("."))
        src = params[first]
        if g1 != g2 or not src["enumMap"]:
            continue
        # Names must be numbered consistently, e.g. "Data I/O 7" (58.107)
        # ... "Data I/O 14" (58.114).
        mname = re.match(r"^(.*?)(\d+)$", src["name"])
        mlast = re.match(r"^(.*?)(\d+)$", params[last]["name"])
        if (not mname or not mlast or mname.group(1) != mlast.group(1)
                or int(mlast.group(2)) - int(mname.group(2)) != i2 - i1):
            continue
        offset = int(mname.group(2)) - i1
        for i in range(i1 + 1, i2 + 1):
            pid = short_id(g1, i)
            if pid not in params:
                params[pid] = {"name": "%s%d" % (mname.group(1), i + offset),
                               "default": src["default"], "enumMap": {},
                               "desc": [], "alltext": [], "valrows": 0,
                               "has_range": False}
                order.append(pid)
            if not params[pid]["enumMap"]:
                params[pid]["enumMap"] = dict(src["enumMap"])
                params[pid]["resolved"] = True

    def code_key(c):
        return int(c)

    result = {}
    for pid in order:
        p = params[pid]
        if p["enumMap"]:
            emap = {c: p["enumMap"][c] for c in sorted(p["enumMap"], key=code_key)}
            result[pid] = {"name": p["name"], "enumMap": emap}

    def sort_key(k):
        g, i = k.split(".")
        return (int(g), int(i))

    return {k: result[k] for k in sorted(result, key=sort_key)}


# ---------------------------------------------------------------------------
# Fault tracing chapter -> events
# ---------------------------------------------------------------------------

NAME_STOP_RE = re.compile(r"\s*(?:\(Editable message text\)|Programmable (?:fault|warning|event)s?\b)",
                          re.I)


def extract_events(doc, ranges):
    """ranges: list of (first_page, last_page, table_kind)."""
    events = {}
    for first, last, table in ranges:
        header = ["Code", "Warning" if table == "warning" else "Fault",
                  "Cause", "What to do"]
        pending = None  # event whose cause text may continue on next page
        for pno in range(first, last + 1):
            lines = page_lines(doc[pno - 1])
            cols, hdr_y = find_header(lines, header)
            if cols is None:
                continue
            body = [l for l in lines if l["y0"] > hdr_y + 5 and l["size"] < 12]
            for l in body:
                l["col"] = column_of(l["x0"], cols)

            starts = [l for l in body if l["col"] == 0 and HEX4_RE.match(l["text"])]
            starts.sort(key=lambda l: l["y0"])
            # Aux code rows sit in the name column, indented, as 4-hex digits.
            aux_rows = [l["y0"] for l in body if l["col"] == 1
                        and l["x0"] > cols[1] + 20
                        and re.match(r"^[0-9A-Fa-f]{4}(\s|$)", l["text"])]

            def cause_text(y_from, y_to):
                stop = min([a for a in aux_rows if y_from - ROW_TOL <= a < y_to]
                           or [y_to])
                parts = [l["text"] for l in body
                         if l["col"] == 2 and abs(l["x0"] - cols[2]) <= COL_TOL
                         and y_from - ROW_TOL <= l["y0"] < stop - ROW_TOL]
                return join_wrapped(parts)

            # Continuation of previous page's last event.
            if pending is not None:
                top = starts[0]["y0"] if starts else 1e9
                if not [a for a in aux_rows if a < top] and len(pending["description"]) < 200:
                    extra = cause_text(hdr_y + 5, top)
                    if extra:
                        pending["description"] = join_wrapped(
                            [pending["description"], extra])
            pending = None

            for i, s in enumerate(starts):
                y = s["y0"]
                y_next = starts[i + 1]["y0"] if i + 1 < len(starts) else 1e9
                # Event name: wrapped lines at the name column left edge.
                parts, last_y = [], None
                for l in body:
                    if l["col"] != 1 or l["y0"] < y - ROW_TOL or l["y0"] >= y_next - ROW_TOL:
                        continue
                    if abs(l["x0"] - cols[1]) > COL_TOL:
                        break
                    if last_y is not None and l["y0"] - last_y > WRAP_GAP:
                        break
                    if NAME_STOP_RE.match(l["text"]):
                        break  # "(Editable message text)", "Programmable fault: ..."
                    parts.append(l["text"])
                    last_y = l["y0"]
                name = NAME_STOP_RE.split(join_wrapped(parts))[0].strip()
                desc = cause_text(y, y_next)
                code = s["text"].upper()
                if table == "fault":
                    kind = "fault"
                elif code.startswith("B"):
                    kind = "pure_event"
                else:
                    kind = "warning"
                key = "0x" + code.lower()
                ev = {"code": key, "kind": kind, "name": name, "description": desc}
                if key not in events:
                    events[key] = ev
                if i == len(starts) - 1:
                    pending = events[key]

    out = []
    for key in sorted(events, key=lambda k: int(k, 16)):
        ev = events[key]
        ev["name"] = clean_text(ev["name"]).rstrip(".")
        ev["description"] = truncate(ev["description"])
        out.append(ev)
    return out


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main(argv):
    if len(argv) != 3:
        sys.stderr.write("usage: %s <fw_manual.pdf> <out_dir>\n" % argv[0])
        return 2
    pdf_path, out_dir = argv[1], argv[2]
    os.makedirs(out_dir, exist_ok=True)
    doc = pymupdf.open(pdf_path)
    toc = doc.get_toc()

    # Parameters chapter: "Parameter listing" section up to the next section.
    p_first, p_last = chapter_range(toc, "Parameters")
    listing = section_page(toc, "Parameter listing", p_first or 0) or p_first
    after = [p for lvl, t, p in toc if lvl == 2 and p > listing and p <= (p_last or 10 ** 6)]
    listing_last = (min(after) - 1) if after else p_last
    # The next section may start mid-page; include that page too.
    if after:
        listing_last = min(after)
    enums = extract_enums(doc, listing, listing_last)

    # Fault tracing chapter: warning and fault message tables.
    f_first, f_last = chapter_range(toc, "Fault tracing")
    w_page = section_page(toc, "Warning messages", f_first)
    flt_page = section_page(toc, "Fault messages", f_first)
    after = [p for lvl, t, p in toc if lvl == 2 and p > flt_page and p <= f_last]
    flt_last = (min(after) - 1) if after else f_last
    ranges = [(w_page, flt_page if flt_page > w_page else w_page, "warning"),
              (flt_page, flt_last, "fault")]
    events = extract_events(doc, ranges)

    with open(os.path.join(out_dir, "fw_enums.json"), "w", encoding="utf-8") as f:
        json.dump(enums, f, indent=1, ensure_ascii=False)
    with open(os.path.join(out_dir, "fw_events.json"), "w", encoding="utf-8") as f:
        json.dump(events, f, indent=1, ensure_ascii=False)

    sys.stderr.write(
        "Parameter listing pages %d-%d: %d enum parameters\n"
        "Warning pages %d-%d, fault pages %d-%d: %d events\n"
        % (listing, listing_last, len(enums), w_page, flt_page, flt_page,
           flt_last, len(events)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
