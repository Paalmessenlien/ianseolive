#!/usr/bin/env python3
"""Poll hdhiaa.net live results for the World 3D Archery Championships and
write data/hdhiaa.json. Stdlib only.

hdhiaa.net is not ianseo — it exposes small JSON endpoints instead of static
result pages:

  /api/races/{id}                                   competition metadata
  /api/races/{id}/live-standings                    live scores per category
  /competition/{slug}/groups.json                   full start list (all entries)
  /competition/{id}/{slug}/live-inbox.json          latest score uploads feed

The start list member id matches live-standings raceApplyId, and the category
title matches the start list sectionTitle, so scores join exactly onto
participants. Output schema:

{
  competition: {id, name, location, country, startDate, endDate, url},
  generated: iso timestamp,
  defaultCountry: "NOR",
  countries: [{code, name, athletes}],
  categories: [{title, bow, age, gender, updated,
                results: [{pos, name, country, countryName, total, arrows,
                           day, target, group, scored}]}]
}
"""
import hashlib
import json
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RACE_ID = 4
SLUG = "world-3d-archery-championships-2026"
BASE = "https://hdhiaa.net"
RACE_URL = f"{BASE}/api/races/{RACE_ID}"
STANDINGS_URL = f"{BASE}/api/races/{RACE_ID}/live-standings"
GROUPS_URL = f"{BASE}/competition/{SLUG}/groups.json"
INBOX_URL = f"{BASE}/competition/{RACE_ID}/{SLUG}/live-inbox.json"
PAGE_URL = f"{BASE}/competition/{RACE_ID}/{SLUG}"
OUT_FILE = ROOT / "data" / "hdhiaa.json"

GENDER = {1: "Male", 2: "Female"}


def fetch_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "ianseolive-poller/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8", "replace"))


def parse_meta(meta: str) -> tuple:
    """'DAY 1/3 · TARGET 6 · hit' -> ('1', '6')"""
    day = re.search(r"DAY\s+(\d+)", meta or "")
    target = re.search(r"TARGET\s+(\w+)", meta or "")
    return (day.group(1) if day else "", target.group(1) if target else "")


def main() -> int:
    race = fetch_json(RACE_URL).get("data", {})
    groups = fetch_json(GROUPS_URL)
    standings = fetch_json(STANDINGS_URL)
    try:
        inbox = fetch_json(INBOX_URL)
    except Exception as exc:  # feed er pynt — ikke la den stoppe pollen
        print(f"warn: inbox: {exc}", file=sys.stderr)
        inbox = {}

    country_names = groups.get("countryNames", {})

    # Flat start list; member id joins to live-standings raceApplyId.
    members = []
    for team in groups.get("teams", []):
        for m in team.get("members", []):
            m = dict(m)
            m["group"] = team.get("groupName") or ""
            members.append(m)

    # countryName -> 3-letter code, from the start list itself
    code_by_name = {}
    for m in members:
        code_by_name.setdefault(m.get("countryName") or "", m.get("countryCode") or "")

    def code3(two_letter: str) -> str:
        name = country_names.get(two_letter, "")
        return code_by_name.get(name, two_letter)

    # Latest activity per category from the inbox feed
    updated_by_cat = {}
    for item in inbox.get("items", []):
        cat = item.get("categoryName") or ""
        ts = item.get("receivedAt") or ""
        if cat and ts > updated_by_cat.get(cat, ""):
            updated_by_cat[cat] = ts

    # Scores per (category, raceApplyId)
    scores = {}
    for cat in standings.get("categories", []):
        for l in cat.get("leaders", []):
            day, target = parse_meta(l.get("meta") or "")
            scores[(cat.get("title"), l.get("raceApplyId"))] = {
                "total": l.get("totalPoints") or 0,
                "arrows": l.get("shotsRecorded") or 0,
                "day": day,
                "target": target,
            }

    # One category per sectionTitle, in the site's own filter order
    order = {s: i for i, s in enumerate(groups.get("filterOptions", {}).get("styles", []))}
    age_order = {a: i for i, a in enumerate(groups.get("filterOptions", {}).get("classes", []))}
    by_section = {}
    for m in members:
        by_section.setdefault(m.get("sectionTitle") or "", []).append(m)

    categories = []
    for title, ms in by_section.items():
        results = []
        for m in ms:
            s = scores.get((title, m.get("id"))) or {}
            results.append({
                "name": m.get("fullName") or "",
                "country": m.get("countryCode") or "",
                "countryName": m.get("countryName") or "",
                "group": m.get("group") or "",
                "scored": bool(s),
                "total": s.get("total", 0),
                "arrows": s.get("arrows", 0),
                "day": s.get("day", ""),
                "target": s.get("target", ""),
            })
        # plassering: poeng desc (delt plass ved likt), uskoredede til slutt
        scored = sorted((r for r in results if r["scored"]),
                        key=lambda r: -r["total"])
        prev_total, prev_pos = None, 0
        for i, r in enumerate(scored, 1):
            prev_pos = prev_pos if r["total"] == prev_total else i
            r["pos"] = prev_pos
            prev_total = r["total"]
        rest = sorted((r for r in results if not r["scored"]),
                      key=lambda r: r["name"])
        for r in rest:
            r["pos"] = 0
        first = ms[0]
        bow_m = re.search(r"\(([^)]+)\)", first.get("category") or "")
        categories.append({
            "title": title,
            "bow": bow_m.group(1) if bow_m else "",
            "age": first.get("ageGroup") or "",
            "gender": GENDER.get(first.get("gender"), ""),
            "updated": updated_by_cat.get(title, ""),
            "results": scored + rest,
        })
    categories.sort(key=lambda c: (order.get(next(
        (s for s in order if c["title"].startswith(s)), ""), 99),
        age_order.get(c["age"], 99), c["gender"] != "Male", c["title"]))

    countries = {}
    for m in members:
        c = countries.setdefault(m["countryCode"], {
            "code": m["countryCode"], "name": m.get("countryName") or "", "athletes": 0})
        c["athletes"] += 1
    country_list = sorted(countries.values(), key=lambda c: c["name"])

    out = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "competition": {
            "id": RACE_ID,
            "name": race.get("name") or "World 3D Archery Championships 2026",
            "location": race.get("location") or "",
            "country": race.get("countryName") or "",
            "startDate": race.get("startDate") or "",
            "endDate": race.get("endDate") or "",
            "url": PAGE_URL,
        },
        "defaultCountry": "NOR" if "NOR" in countries else (country_list[0]["code"] if country_list else ""),
        "countries": country_list,
        "categories": categories,
    }
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    n_scored = sum(1 for c in categories for r in c["results"] if r["scored"])
    print(f"wrote {OUT_FILE}: {len(country_list)} countries, "
          f"{len(members)} athletes, {len(categories)} categories, {n_scored} with scores")
    bust_asset_cache()
    return 0


def bust_asset_cache() -> None:
    """Pin hdhiaa/app.js and ../style.css in hdhiaa/index.html to a content
    hash (?v=...) — same trick as poll.py does for the main page."""
    index = ROOT / "hdhiaa" / "index.html"
    if not index.exists():
        return
    h = hashlib.md5()
    for p in (ROOT / "hdhiaa" / "app.js", ROOT / "style.css"):
        if p.exists():
            h.update(p.read_bytes())
    v = h.hexdigest()[:8]
    old = index.read_text(encoding="utf-8")
    new = re.sub(r'(app\.js|style\.css)(\?v=[0-9a-f]+)?', rf"\1?v={v}", old)
    if new != old:
        index.write_text(new, encoding="utf-8")
        print(f"hdhiaa/index.html: asset version -> {v}")


if __name__ == "__main__":
    sys.exit(main())
