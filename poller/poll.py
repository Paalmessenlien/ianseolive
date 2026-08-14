#!/usr/bin/env python3
"""Poll ianseo.net public result pages for one tournament and write data/results.json.

Stdlib only. Fetches the tournament Details page to discover uploaded result
files, downloads each .php result page, parses the HTML tables and stores
everything as JSON in the schema the frontend (the "Ianseo Live" design)
expects:

{
  tournament: {name, code, detailsUrl, place, round},
  generated: iso timestamp,
  defaultClub: "LILLH",
  clubs: [{short, name}],
  roster: {SHORT: [{name, target, class, pool}]},
  classes: [{name, official, totalArrows, distances: [labels],
             field: [{club, name, pos, total, arrows, tens, xs, target, pool,
                      dist: {label: "score/ rank"}}]}],
  files: {CODE: upload timestamp}
}
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
RANK_PREFIXES = ("IQ", "TQ")  # qualification rankings (individual/team)
FIXED_COLS = {"Pos.", "Athlete", "Country", "Tot.", "X", "10"}


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


def split_club(full: str) -> tuple:
    """'LILLH - LILLEHAMMER BUESKYTTERKLUBB' -> ('LILLH', 'LILLEHAMMER BUESKYTTERKLUBB')"""
    parts = full.split(" - ", 1)
    return parts[0].strip(), (parts[1].strip() if len(parts) > 1 else parts[0].strip())


def to_int(s: str) -> int:
    m = re.search(r"\d+", s or "")
    return int(m.group(0)) if m else 0


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


def parse_rank_page(page: str) -> dict:
    """Parse a qualification ranking page into a class entry."""
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
        return {}
    columns = rows[header_idx]
    dist_cols = [c for c in columns if c and c not in FIXED_COLS and not c.startswith("col")]

    official = "OFFICIAL" in status.upper()
    m = re.search(r"After (\d+) Arrows", status, re.I)
    total_arrows = int(m.group(1)) if m else 72

    field = []
    for cells in rows[header_idx + 1:]:
        if len(cells) != len(columns):
            continue  # subtotal rows, mobile duplicate rows, etc.
        row = dict(zip(columns, cells))
        if not row.get("Athlete"):
            continue
        club_short, _ = split_club(row.get("Country", ""))
        dist = {c: row.get(c, "") for c in dist_cols}
        if official:
            arrows = total_arrows
        else:
            # estimate progress from how many distance columns have a score
            filled = sum(1 for v in dist.values() if re.match(r"^\d", v or ""))
            per = total_arrows / max(1, len(dist_cols))
            arrows = int(round(filled * per))
        field.append(
            {
                "club": club_short,
                "name": row["Athlete"],
                "pos": to_int(row.get("Pos.", "")),
                "total": to_int(row.get("Tot.", "")),
                "arrows": arrows,
                "tens": to_int(row.get("10", "")),
                "xs": to_int(row.get("X", "")),
                "dist": dist,
            }
        )
    field.sort(key=lambda f: f["pos"] or 9999)
    return {
        "name": title,
        "official": official,
        "totalArrows": total_arrows,
        "distances": dist_cols,
        "field": field,
    }


def parse_roster(page: str) -> dict:
    """Parse ENC.php (entries grouped by club) -> {short: [{name, target, class, pool}]}"""
    roster = {}
    club = None
    for cells in parse_rows(page):
        if len(cells) == 1 and " - " in cells[0]:
            club, _ = split_club(cells[0])
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

    roster = {}
    club_full_names = []
    if ROSTER_CODE in files:
        enc = fetch(f"{TOURDATA_URL}/{ROSTER_CODE}.php")
        roster = parse_roster(enc)
        club_full_names = [c[0] for c in parse_rows(enc) if len(c) == 1 and " - " in c[0]]

    classes = []
    for code in sorted(files):
        if code in SKIP_CODES or code in ("ENA", "ENC", "ENE", "ENS"):
            continue
        if not code.startswith(RANK_PREFIXES):
            continue
        try:
            page = fetch(f"{TOURDATA_URL}/{code}.php")
        except Exception as exc:  # keep polling even if one file fails
            print(f"warn: {code}: {exc}", file=sys.stderr)
            continue
        cls = parse_rank_page(page)
        if cls and cls["field"]:
            cls["code"] = code
            classes.append(cls)

    # join roster info (target/pool) onto result rows
    for cls in classes:
        for f in cls["field"]:
            for a in roster.get(f["club"], []):
                if a["name"] == f["name"]:
                    f["target"] = a["target"]
                    f["pool"] = a["pool"]
                    break
            f.setdefault("target", "")
            f.setdefault("pool", "")

    if not club_full_names:
        seen = {f["club"] for c in classes for f in c["field"]} | set(roster)
        club_full_names = sorted(seen)
    clubs = [dict(zip(("short", "name"), split_club(c))) for c in club_full_names]
    clubs.sort(key=lambda c: c["name"])

    out = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "tournament": {
            "toId": TO_ID,
            "name": CONFIG["tournamentName"],
            "code": CONFIG["tournamentCode"],
            "detailsUrl": DETAILS_URL,
            "place": CONFIG.get("tournamentPlace", ""),
            "round": CONFIG.get("tournamentRound", ""),
        },
        "defaultClub": CONFIG["defaultClub"],
        "files": files,
        "clubs": clubs,
        "roster": roster,
        "classes": classes,
    }

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(
        f"wrote {OUT_FILE}: {len(clubs)} clubs, "
        f"{sum(len(r) for r in roster.values())} roster entries, {len(classes)} classes"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
