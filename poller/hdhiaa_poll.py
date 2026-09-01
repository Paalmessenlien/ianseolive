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
import time
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
STATE_FILE = ROOT / "data" / ".hdhiaa_state.json"      # siste inbox-id (ikke i git)
GROUPS_CACHE = ROOT / "data" / ".hdhiaa_groups.json"   # bufret startliste (ikke i git)

GENDER = {1: "Male", 2: "Female"}


def fetch_text(url: str) -> str:
    last = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "ianseolive-poller/1.0"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.read().decode("utf-8", "replace")
        except Exception as exc:
            last = exc
            time.sleep(2 * (attempt + 1))
    raise last


def fetch_json(url: str) -> dict:
    return json.loads(fetch_text(url))


def load_state() -> dict:
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_state(state: dict) -> None:
    STATE_FILE.write_text(json.dumps(state), encoding="utf-8")


def check_live() -> tuple:
    """Er det kommet nye data siden sist? Returnerer (endret, standings|None).

    To signaler, billigste først:
    1. inbox-feeden (~7 KB): nye opplastings-id-er enn state.lastInboxId.
    2. Hvis inbox er tom/uendret (skjer når hdhiaa slår av live-feeden,
       f.eks. i pauser): hent stillingene (~60 KB) og sammenlign innholds-
       hash. De oppdateres også via andre kanaler enn inbox.
    """
    state = load_state()
    if state.get("lastInboxId") is None and not state.get("lastStandingsHash"):
        return True, None, None  # første kjøring: alltid full henting
    inbox = fetch_json(INBOX_URL)
    ids = [i.get("id", 0) for i in inbox.get("items", [])]
    if ids and max(ids) > state.get("lastInboxId", 0):
        return True, None, None
    raw = fetch_text(STANDINGS_URL)
    if hashlib.md5(raw.encode()).hexdigest() != state.get("lastStandingsHash"):
        return True, json.loads(raw), raw
    return False, None, None


def load_groups(standings: dict) -> dict:
    """Startlista (419 KB) endrer seg ikke under stevnet — bruk lokal buffer,
    men hent på nytt hvis bufferen er gammel eller live-scorene viser en
    utøver vi ikke kjenner."""
    known = {l.get("raceApplyId") for c in standings.get("categories", [])
             for l in c.get("leaders", [])}
    try:
        cache = json.loads(GROUPS_CACHE.read_text(encoding="utf-8"))
        age_ok = cache.get("fetched", 0) > datetime.now(timezone.utc).timestamp() - 3600
        ids = {m.get("id") for t in cache["data"].get("teams", []) for m in t.get("members", [])}
        if age_ok and known <= ids:
            return cache["data"]
    except Exception:
        pass
    groups = fetch_json(GROUPS_URL)
    GROUPS_CACHE.write_text(json.dumps({
        "fetched": datetime.now(timezone.utc).timestamp(), "data": groups}))
    return groups


def parse_meta(meta: str) -> tuple:
    """'DAY 1/3 · TARGET 6 · hit' -> ('1', '6')"""
    day = re.search(r"DAY\s+(\d+)", meta or "")
    target = re.search(r"TARGET\s+(\w+)", meta or "")
    return (day.group(1) if day else "", target.group(1) if target else "")


def paused() -> str:
    """Returnerer pause-fristen fra config.json hvis synken er pauset nå."""
    try:
        cfg = json.loads((ROOT / "config.json").read_text(encoding="utf-8"))
        until = (cfg.get("hdhiaa") or {}).get("pausedUntil")
        if until and datetime.now(timezone.utc) < datetime.fromisoformat(until):
            return until
    except Exception:
        pass
    return ""


def main() -> int:
    if (until := paused()):
        print(f"paused until {until}")
        return 0
    live_mode = "--live" in sys.argv
    standings = standings_raw = None
    if live_mode:
        try:
            changed, standings, standings_raw = check_live()
            if not changed:
                print("no new scores")
                return 0
        except Exception as exc:  # ved sjekk-feil: gjør full henting likevel
            print(f"warn: live-check: {exc}", file=sys.stderr)
            standings = standings_raw = None
    race = fetch_json(RACE_URL).get("data", {})
    if standings is None:
        standings_raw = fetch_text(STANDINGS_URL)
        standings = json.loads(standings_raw)
    # hdhiaa skrur av live-feeden i pauser (enabled=false, 0 kategorier) —
    # ikke overskriv gode data med en tom stilling
    if not any(c.get("leaders") for c in standings.get("categories", [])) and OUT_FILE.exists():
        try:
            old = json.loads(OUT_FILE.read_text(encoding="utf-8"))
            if any(r.get("scored") for c in old.get("categories", []) for r in c.get("results", [])):
                print("live-standings tom (hdhiaa-feed av) — beholder forrige data")
                return 0
        except Exception:
            pass
    groups = load_groups(standings)
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
                "shots": [str(s) for s in (l.get("shots") or [])][-12:],
                "photo": l.get("photoUrl") or "",
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
                "shots": s.get("shots", []),
                "photo": s.get("photo", ""),
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
    prev_state = load_state()
    inbox_ids = [i.get("id", 0) for i in inbox.get("items", [])]
    save_state({
        # id-ene kan resettes av hdhiaa — behold alltid høyeste sette
        "lastInboxId": max([prev_state.get("lastInboxId", 0)] + inbox_ids),
        "lastStandingsHash": hashlib.md5(standings_raw.encode()).hexdigest(),
    })
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
