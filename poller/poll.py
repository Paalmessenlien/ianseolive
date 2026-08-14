#!/usr/bin/env python3
"""Poll ianseo.net public result pages for one tournament and write data/results.json.

Stdlib only. Fetches the tournament Details page to discover uploaded result
files, downloads each .php result page, parses the HTML tables and stores
everything as JSON for the static frontend to filter/display.
"""
import html
import json
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG = json.loads((ROOT / "config.json").read_text(encoding="utf-8"))
TO_ID = CONFIG["toId"]
YEAR = CONFIG["year"]
DETAILS_URL = f"https://ianseo.net/Details.php?toId={TO_ID}"
TOURDATA_URL = f"https://ianseo.net/TourData/{YEAR}/{TO_ID}"
OUT_FILE = ROOT / "data" / "results.json"

# File codes that are not archer-result pages
SKIP_CODES = {"STC", "STE", "FOP", "SCHEDULE"}
ROSTER_CODE = "ENC"  # entries grouped by club


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "ianseolive-poller/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", "replace")


def clean(cell: str) -> str:
    cell = re.sub(r"<[^>]+>", "", cell)
    cell = html.unescape(cell).replace("\xa0", " ")
    return re.sub(r"\s+", " ", cell).strip()


def parse_rows(page: str) -> list:
    """Return table rows as lists of cleaned cell strings."""
    rows = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", page, re.S | re.I):
        cells = [clean(c) for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, re.S | re.I)]
        if any(cells):
            rows.append(cells)
    return rows


def discover_files(details_page: str) -> dict:
    """Map file code -> upload timestamp (from the pdf ?time= param, may be '')."""
    files = {}
    for code in re.findall(rf"/TourData/{YEAR}/{TO_ID}/([A-Za-z0-9]+)\.php", details_page):
        files.setdefault(code, "")
    for code, t in re.findall(
        rf"/TourData/{YEAR}/{TO_ID}/([A-Za-z0-9]+)\.pdf\?time=([^\"&]+)", details_page
    ):
        files[code] = urllib.parse.unquote_plus(t)
    return files


def parse_result_page(page: str) -> dict:
    """Parse a ranking/bracket page into {title, status, columns, rows}."""
    rows = parse_rows(page)
    title, status = "", ""
    header_idx = None
    for i, cells in enumerate(rows):
        if len(cells) == 1 and not title:
            m = re.search(r"\[(.*?)\]\s*$", cells[0])
            status = m.group(1) if m else ""
            title = re.sub(r"\s*\[.*?\]\s*$", "", cells[0])
        if ("Pos." in cells or "Athlete" in cells) and len(cells) >= 3:
            header_idx = i
            break
    if header_idx is None:
        return {"title": title, "status": status, "columns": [], "rows": []}
    columns = [c or f"col{n}" for n, c in enumerate(rows[header_idx])]
    data = []
    for cells in rows[header_idx + 1:]:
        if len(cells) != len(columns):
            continue  # subtotal rows, mobile duplicate rows, etc.
        row = dict(zip(columns, cells))
        if row.get("Athlete"):
            data.append(row)
    return {"title": title, "status": status, "columns": columns, "rows": data}


def parse_roster(page: str) -> dict:
    """Parse ENC.php (entries grouped by club) -> {club: [{name, target, class, pool}]}"""
    roster = {}
    club = None
    for cells in parse_rows(page):
        if len(cells) == 1 and " - " in cells[0]:
            club = cells[0]
            roster.setdefault(club, [])
        elif club and len(cells) >= 3 and cells[0] != "Skytter":
            if not cells[1] or cells[2].lower().startswith("vip"):
                continue  # officials/team leaders, not archers
            roster[club].append(
                {
                    "name": cells[0],
                    "target": cells[1],
                    "class": cells[2],
                    "pool": cells[3] if len(cells) > 3 else "",
                }
            )
    return roster


def main() -> int:
    details = fetch(DETAILS_URL)
    files = discover_files(details)

    out = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "tournament": {
            "toId": TO_ID,
            "name": CONFIG["tournamentName"],
            "detailsUrl": DETAILS_URL,
        },
        "defaultClub": CONFIG["defaultClub"],
        "files": files,
        "clubs": [],
        "roster": {},
        "events": [],
    }

    if ROSTER_CODE in files:
        out["roster"] = parse_roster(fetch(f"{TOURDATA_URL}/{ROSTER_CODE}.php"))
        out["clubs"] = sorted(out["roster"].keys())

    for code in sorted(files):
        if code in SKIP_CODES or code in ("ENA", "ENC", "ENE", "ENS"):
            continue
        try:
            page = fetch(f"{TOURDATA_URL}/{code}.php")
        except Exception as exc:  # keep polling even if one file fails
            print(f"warn: {code}: {exc}", file=sys.stderr)
            continue
        event = parse_result_page(page)
        event["code"] = code
        event["updated"] = files[code]
        if event["rows"]:
            out["events"].append(event)

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {OUT_FILE}: {len(out['clubs'])} clubs, {len(out['events'])} events")
    return 0


if __name__ == "__main__":
    sys.exit(main())
