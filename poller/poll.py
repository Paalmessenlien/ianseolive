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
BRACKET_PREFIXES = ("IB", "TB")  # elimination brackets (individual/team)
# Non-distance columns, English and Norwegian ianseo templates
FIXED_COLS = {
    "Pos.", "Athlete", "Country", "Tot.", "X", "10",
    "Pl.", "Skytter", "Skyttere", "Klubb", "Tot. dist.", "Totalt", "10+X", "SO/CT",
}
HEADER_MARKERS = ("Pos.", "Athlete", "Pl.", "Skytter")


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "ianseolive-poller/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", "replace")


def clean(cell: str) -> str:
    cell = re.sub(r"<br\s*/?>", ", ", cell, flags=re.I)
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


def unique_labels(columns: list) -> list:
    """Disambiguate repeated column labels: ['70 m', '70 m'] -> ['70 m', '70 m (2)']"""
    labels, seen = [], {}
    for c in columns:
        seen[c] = seen.get(c, 0) + 1
        labels.append(f"{c} ({seen[c]})" if seen[c] > 1 else c)
    return labels


def _subst_set_points(text: str) -> str:
    """Replace innermost nested tables with a \\x01set1·set2\\x01 marker.

    Bracket pages nest per-set score tables inside participant cells; this
    flattens them so the cell text carries the set scores.
    """
    pat = re.compile(r'<table[^>]*>((?:(?!<table).)*?)</table>', re.S)
    while True:
        m = pat.search(text)
        if not m:
            return text
        if "table-grid" in m.group(0)[:60]:
            # the outer bracket table itself — keep the tag, strip only its body marker
            text = text[: m.start()] + "\x02" + m.group(1) + "\x03" + text[m.end():]
            body = m.group(1)
            # continue searching after the marker
            continue
        inner = m.group(1)
        sets = [s.strip() for s in re.findall(r'td-set-points[^>]*>([^<]*)<', inner)]
        repl = "\x01" + "·".join(sets) + "\x01" if sets else ""
        text = text[: m.start()] + repl + text[m.end():]


def parse_bracket_page(page: str, code: str) -> dict:
    """Parse an ianseo bracket page (IB*/TB*) into rounds of matches."""
    if '<table class="table-grid"' not in page:
        return {}
    page = _subst_set_points(page)
    i = page.find("\x02")
    if i < 0:
        return {}
    tbl = page[page.find("\x02") + 1 : page.find("\x03")]
    title_m = re.search(r'<th colspan="100"[^>]*>(.*?)</th>', tbl, re.S)
    title = clean(title_m.group(1)) if title_m else code
    is_team = code.startswith("TB")

    rows = re.findall(r"<tr[^>]*>(.*?)</tr>", tbl, re.S)
    if len(rows) < 2:
        return {}

    def row_cells(r: str) -> list:
        out, col = [], 0
        for m in re.finditer(r"<(td|th)([^>]*)>(.*?)</\1>", r, re.S):
            attrs, inner = m.group(2), m.group(3)
            span = int(re.search(r'colspan="(\d+)"', attrs).group(1)) if "colspan" in attrs else 1
            cls_m = re.search(r'class="([^"]*)"', attrs)
            out.append({"col": col, "span": span, "cls": cls_m.group(1) if cls_m else "", "html": inner})
            col += span
        return out

    # header row -> round column ranges (span from colspan)
    rounds = []
    for c in row_cells(rows[1] if "colspan=\"100\"" in rows[0] else rows[0]):
        label = clean(re.sub(r"<[^>]+>", "", c["html"]))
        if label:
            rounds.append({"name": label, "start": c["col"], "end": c["col"] + c["span"]})
    if not rounds:
        return {}

    def cell_text(c: dict) -> tuple:
        sets_m = re.search(r"\x01([^\x01]*)\x01", c["html"])
        sets = sets_m.group(1).split("·") if sets_m and sets_m.group(1) else []
        return clean(c["html"].replace("\x01", "").replace("·", " ") if sets_m else c["html"]), sets

    entries = {r["name"]: [] for r in rounds}
    for r in rows[2:]:
        cells = row_cells(r)
        for rd in rounds:
            band = [c for c in cells if rd["start"] <= c["col"] < rd["end"]]
            if not band:
                continue
            label = next((clean(c["html"]) for c in band if c["cls"] == "w" and clean(c["html"])), None)
            if label:
                entries[rd["name"]].append({"label": label})
                continue
            c_cells = [c for c in band if "c data-cell" in c["cls"]]
            short = next((clean(c["html"]) for c in band if c["cls"] == "t b data-cell" and clean(c["html"])), "")
            full = next((clean(c["html"]) for c in band if c["cls"] == "t b r data-cell" and clean(c["html"])), "")
            members = next((clean(c["html"]) for c in band if "comp" in c["cls"] and clean(c["html"])), "")
            texts = [cell_text(c) for c in c_cells]
            vals = [t for t, _ in texts]
            if is_team:
                if not short:
                    continue
                name = full or short
                score = vals[-1] if vals else ""
            else:
                if not vals:
                    continue
                if vals and re.match(r"^\d+$", vals[0]) and len(vals) >= 2:
                    vals = vals[1:]  # seed
                if not vals:
                    continue
                name, score = (vals[-2] if len(vals) >= 2 else ""), vals[-1]
            # shoot-off value: plain numeric cell right after the score cell
            so = ""
            if c_cells:
                sc = c_cells[-1]
                nxt = next((c for c in cells if c["col"] == sc["col"] + 1), None)
                if nxt and "data-cell" not in nxt["cls"]:
                    t = clean(nxt["html"])
                    if re.match(r"^\d+$", t):
                        so = t
            if not name and "T#" not in score:
                continue  # spacer row
            tm = re.search(r"T#\s*(\w+)\s*(?:[,|]\s*([\d-]+\s+[\d:]+))?", score)
            entries[rd["name"]].append(
                {
                    "label": None,
                    "name": name,
                    "club": short,
                    "members": members,
                    "score": "" if ("T#" in score or score == "Bye") else score,
                    "bye": score == "Bye",
                    "so": so,
                    "target": tm.group(1) if tm else "",
                    "when": tm.group(2) if tm and tm.group(2) else "",
                }
            )

    # later rounds lack club info for individuals — map from earlier rounds
    if not is_team:
        nameclub = {}
        for rd in rounds:
            for e in entries[rd["name"]]:
                if e.get("name") and e.get("club"):
                    nameclub[e["name"]] = e["club"]
        for rd in rounds:
            for e in entries[rd["name"]]:
                if e.get("name") and not e.get("club"):
                    e["club"] = nameclub.get(e["name"], "")

    # pair participants into matches, round by round
    out_rounds = []
    for rd in rounds:
        ents = entries[rd["name"]]
        matches, pending, label = [], [], ""
        final_n = 0
        for e in ents:
            if e["label"]:
                label = e["label"]
                continue
            if e["bye"]:
                continue
            pending.append(e)
            if len(pending) == 2:
                if rd["name"] == "Finals":
                    final_n += 1
                    if not label:
                        label = "Finale" if final_n == 1 else "Bronse"
                matches.append({"label": label, "a": pending[0], "b": pending[1]})
                pending, label = [], ""
        if matches:
            out_rounds.append({"name": rd["name"], "matches": matches})
    if not out_rounds:
        return {}
    return {"name": f"{title} (lag)" if is_team else title, "team": is_team, "rounds": out_rounds}


def parse_rank_page(page: str, code: str) -> dict:
    """Parse a qualification ranking page (individual or team) into a class entry."""
    rows = parse_rows(page)
    title, status = "", ""
    header_idx = None
    for i, cells in enumerate(rows):
        if len(cells) == 1 and not title:
            m = re.search(r"\[(.*?)\]\s*$", cells[0])
            status = m.group(1) if m else ""
            title = re.sub(r"\s*\[.*?\]\s*$", "", cells[0])
        if any(m_ in cells for m_ in HEADER_MARKERS) and len(cells) >= 3:
            header_idx = i
            break
    if header_idx is None:
        return {}
    columns = rows[header_idx]
    labels = unique_labels(columns)
    dist_idx = [i for i, c in enumerate(columns) if c and c not in FIXED_COLS]
    dist_labels = [labels[i] for i in dist_idx]
    is_team = code.startswith("TQ")

    status_up = status.upper()
    official = "OFFICIAL" in status_up or "OFFISIELL" in status_up
    m = re.search(r"(?:After|Etter) (\d+) (?:Arrows|piler)", status, re.I)
    progress = int(m.group(1)) if m else None
    # totalArrows is the full round length; ianseo's "Etter N piler" is progress.
    # Qualification rounds are 36 arrows per distance; teams are 3 archers.
    total_arrows = 216 if is_team else 36 * max(1, len(dist_idx))

    def first(row: dict, *keys: str) -> str:
        for k in keys:
            if row.get(k):
                return row[k]
        return ""

    field = []
    for cells in rows[header_idx + 1:]:
        if len(cells) != len(columns):
            continue  # subtotal rows, mobile duplicate rows, etc.
        row = dict(zip(columns, cells))
        if is_team:
            club_short, club_name = split_club(first(row, "Klubb", "Country"))
            name = first(row, "Skyttere") or club_name
        else:
            name = first(row, "Athlete", "Skytter")
            club_short, _ = split_club(first(row, "Country", "Klubb"))
        if not name:
            continue
        dist = {labels[i]: cells[i] for i in dist_idx}
        if official:
            arrows = total_arrows
        elif progress is not None:
            arrows = progress
        else:
            # estimate progress from how many distance columns have a real score
            filled = sum(1 for v in dist.values() if re.match(r"^[1-9]", v or ""))
            per = total_arrows / max(1, len(dist_idx))
            arrows = int(round(filled * per))
        field.append(
            {
                "club": club_short,
                "name": name,
                "pos": to_int(first(row, "Pos.", "Pl.")),
                "total": to_int(first(row, "Tot.", "Tot. dist.", "Totalt")),
                "arrows": arrows,
                "tens": to_int(first(row, "10", "10+X")),
                "xs": to_int(row.get("X", "")),
                "dist": dist,
            }
        )
    field.sort(key=lambda f: f["pos"] or 9999)
    if is_team:
        # label rows as "Lag" (numbered when a club has several teams);
        # keep the archer names in a separate members field
        counts = {}
        for f in field:
            counts[f["club"]] = counts.get(f["club"], 0) + 1
        seen = {}
        for f in field:
            f["members"] = f["name"]
            seen[f["club"]] = seen.get(f["club"], 0) + 1
            f["name"] = (
                f"Lag {seen[f['club']]}" if counts[f["club"]] > 1 else "Lag"
            )
    return {
        "name": f"{title} (lag)" if is_team else title,
        "team": is_team,
        "official": official,
        "totalArrows": total_arrows,
        "distances": dist_labels,
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
    brackets = []
    for code in sorted(files):
        if code in SKIP_CODES or code in ("ENA", "ENC", "ENE", "ENS"):
            continue
        is_rank = code.startswith(RANK_PREFIXES)
        is_bracket = code.startswith(BRACKET_PREFIXES)
        if not (is_rank or is_bracket):
            continue
        try:
            page = fetch(f"{TOURDATA_URL}/{code}.php")
        except Exception as exc:  # keep polling even if one file fails
            print(f"warn: {code}: {exc}", file=sys.stderr)
            continue
        if is_rank:
            cls = parse_rank_page(page, code)
            if cls and cls["field"]:
                cls["code"] = code
                classes.append(cls)
        else:
            br = parse_bracket_page(page, code)
            if br:
                br["code"] = code
                br["updated"] = files.get(code, "")
                brackets.append(br)

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
        "brackets": brackets,
    }

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(
        f"wrote {OUT_FILE}: {len(clubs)} clubs, "
        f"{sum(len(r) for r in roster.values())} roster entries, "
        f"{len(classes)} classes, {len(brackets)} brackets"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
