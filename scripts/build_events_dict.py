#!/usr/bin/env python3
"""Convert fw_events.json (from scripts/extract_fw_manual.py) into the app's
src/data/abb580_events_dict.json lookup format.

Usage: python scripts/build_events_dict.py <fw_events.json> <out.json>
"""
import datetime
import json
import sys


def main():
    src, out = sys.argv[1], sys.argv[2]
    events = json.load(open(src, encoding="utf-8"))
    table = {}
    for e in sorted(events, key=lambda x: int(x["code"], 16)):
        code = "0x%04x" % int(e["code"], 16)
        table[code] = {"kind": e["kind"], "name": e["name"].strip(), "description": e.get("description", "").strip()}
    data = {
        "meta": {
            "description": "ABB ACH580 fault, warning and pure event codes (official names, short cause summary).",
            "source": "ACH580 firmware manual, Fault tracing chapter (Warning messages + Fault messages tables)",
            "generated": datetime.date.today().isoformat(),
            "count": len(table),
        },
        "events": table,
    }
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print("wrote %s: %d events" % (out, len(table)), file=sys.stderr)


if __name__ == "__main__":
    main()
