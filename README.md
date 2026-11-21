# ABB 580 Field Auditor

Offline-first Progressive Web App for US HVAC and mechanical commissioning engineers. It audits **ABB ACH580 / ACQ580 / ACS580** drive parameter backups on dry coolers, pumps, AHUs and exhaust fans, right on an Android phone (Chrome on Google Pixel), with no network connection.

**Live app:** https://dmitriireznichenko.github.io/abb-580-auditor/ (install it from Chrome with "Add to Home screen").

> All decoding happens on the device. No file is uploaded anywhere.

## Features

| Tab | What it does |
| --- | --- |
| **Audit** | Load a unit backup (`.dcparamsbak` or a Drive Composer `.pdf`). The app picks the matching Golden Profile automatically (by `07.03` drive rating and `99.10` motor power) and shows a **DRIVE / EQUIPMENT MISMATCH** banner with a one-tap profile switcher when the two don't match. Results come in three parts: the **Identity Card** (serial, rating, firmware, motor and limits quick-check, phase order, BACnet diagnostics with the combined Device Instance ID `51.15 * 10000 + 51.14`, decoded faults and warnings), a **PASS / FAIL** configuration mismatch table, and filtered telemetry behind "Show Live Telemetry & Counters". |
| **Parameters** | A standalone viewer for any backup or PDF. Instant search (`30.17`, `PID`, `dry run`, ...) and filters: All, Modified vs Factory, Diff vs Golden. Exports the Audit Report PDF, the Full Parameters PDF and a CSV, and can share through the Android share sheet. |
| **Fleet Log** | Every audit is logged automatically (IndexedDB). A duplicate IP address or BACnet Device ID on two different units raises a **NETWORK CONFLICT** banner. Exports a Fleet Summary as CSV or PDF. |
| **Profiles** | An unlimited library of Golden Profiles (Dry Cooler, Pump, Fan / AHU, Other). Each profile stores auto-metadata and its own ignored parameters (single ids, ranges such as `28.51-28.57`, or whole groups such as `40.*`). The library can be exported and imported as JSON. You can also extend the parameter dictionary at runtime by merging metadata from any Drive Composer PDF or backup. |

Safety guards:
- `30.17 Maximum current <= 99.06 Motor nominal current`
- **PHASE ORDER MISMATCH — Verify physical rotation!** when `99.16` differs from the Golden Profile
- Firmware differences
- Duplicate network identities

## Supported file formats (reverse-engineering notes)

### `.dcparamsbak`
A ZIP archive containing:
- `parameters.dcparams`: self-describing XML with every parameter, its type, scaling, unit, limits and option lists. There are two dialects:
  - **Drive Composer (PC)**: tags in alphabetical order and reliable factory defaults.
  - **Drivetune (mobile / Bluetooth)**: includes the drive name and serial number. `RawDefaultValue` is just a copy of `RawValue`, so the app takes factory defaults from the bundled dictionary instead.
- Value decoding rules:
  - `Decimal`: uses `<Value>`, displayed with `DisplayDecimals`.
  - Lists and pointers: use `RawValue` plus the option list.
  - `Hex` / `Binary` / `Version` / `StringAscii5` (five 6-bit characters, offset 47) / `Date` (day counter from 1980-01-01) / `TimeOfDay` / `Duration`: decoded from `RawValue`.
- `*.bin`: the control-panel backup blob. Layout: `u32 version`, `u32 count`, then 74-byte TOC records (`u32 offset`, `u32 size`, `u8 id`, `u8 kind`, `char[64] name`). It holds binary value images, the serial number (`BUINFO.DAT`), panel favorites (`ShortParam.cfg`) and the panel drive name (`drivedata.txt`). It does **not** contain parameter definitions or enum labels; those come from the XML. That's why backups from other firmware versions or ACQ580 / ACS580 drives decode automatically. The app extracts the blob's metadata client-side ([`src/lib/bin.ts`](src/lib/bin.ts)).
- An optional side-car `*.xml` with drive family information.

### Drive Composer PDF
Parameter prints from Drive Composer pro ("Microsoft Print to PDF") are parsed with a locally bundled `pdfjs-dist` worker, so no CDN is needed. Column positions are detected per page from the header row. Truncated option labels are resolved through the option lists.

### Dictionaries
- `src/data/abb580_base_dict.json`: 1260 parameters (names, US units, min / max, factory defaults, option lists). It contains **schema only, with no site values**. Built by `scripts/build_base_dict.py` from a Drive Composer print (the Value column is stripped) and enriched with option lists from the ACH580 firmware manual (`scripts/extract_fw_manual.py`).
- `src/data/abb580_events_dict.json`: 227 fault and warning codes with official names and descriptions, built by `scripts/build_events_dict.py`.

## Noise filtering

These are hidden from the PASS / FAIL verdict:
- Live values, counters, logs, override logs (`70.x`), and auto-calculated motor model values (`98.02-98.14`, only while `98.01 = Not selected`).
- Unit-unique identity: IP host part, BACnet IDs and MS/TP address.

The full list is in [`src/lib/noise.ts`](src/lib/noise.ts). BACnet subnet (`51.09`), gateway (`51.10-51.13`) and mapping file version (`51.30`) are audited as configuration.

## Development

```bash
npm ci
npm run dev          # local dev server
npm test             # Vitest (synthetic fixtures)
npm run build        # type-check + production build (PWA)
npm run security:check
```

Tech stack: React 19, Vite, Tailwind CSS v4, and `vite-plugin-pwa` (auto-update, `skipWaiting`, `clientsClaim`). Routing is hash-based, so GitHub Pages never returns a 404. Persistence uses IndexedDB (`idb`), PDF generation uses jsPDF + AutoTable, and ZIP handling uses JSZip.

Deployment: every push to `main` runs the security gate, the tests and the build, then publishes to GitHub Pages ([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)).

### Real-data validation (local only)
Put real backups and PDFs into `.local-fixtures/` (gitignored), or point `ABB_REAL_DATA_DIR` at them. The `tests/realdata.*.test.ts` suites then run against them; in CI they are skipped.

## Security policy (public repository)

- Real backups, PDFs, panel blobs and parsed dumps are **never** committed: `*.dcparamsbak`, `*.dcparams`, `*.pdf`, `*.bin`, `*.xml` and dump files are gitignored.
- Committed tests use **100% synthetic fixtures** ([`tests/fixtures/synthetic.ts`](tests/fixtures/synthetic.ts)) with RFC 5737 documentation IPs (`192.0.2.x`) and fake serial numbers.
- `npm run security:check` fails if any tracked or staged file contains a site identifier pattern, a forbidden file type, or Cyrillic text. CI runs it on every push.
- The UI, reports, code and documentation are English only.

ABB, ACH580, ACQ580, ACS580, Drive Composer and Drivetune are trademarks of ABB. This project is not affiliated with ABB.