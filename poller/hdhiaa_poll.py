#!/usr/bin/env python3
"""Poll hdhiaa.net live results for the World 3D Archery Championships and
write data/hdhiaa.json. Stdlib only.

hdhiaa.net is not ianseo — it exposes small JSON endpoints instead of static
result pages:

  /api/races/{id}                                   competition metadata
  /api/races/{id}/live-standings                    live scores per category (current day)
  /competition/{slug}/groups.json                   full start list (all entries)
  /competition/{id}/{slug}/live-inbox.json          latest score uploads feed
  /competition/{id}/{slug}/results/export.csv       official results, cumulative
  .../export.csv?partial_round={roundId}            official results per day; the
                                                    round ids are read from the
                                                    competition page's day selector

Per-day model: live-standings covers the day being shot ("DAY 2/3" in each
leader's meta) while the CSV covers completed day(s). Each poll merges both
into a persistent day store (data/hdhiaa_days.json, tracked in git) so a day's
scores survive after the live feed rolls over to the next day. data/hdhiaa.json
then carries per-archer `days` plus an aggregate `total`:

{
  competition: {id, name, location, country, startDate, endDate, url},
  generated: iso timestamp,
  totalDays: 3, currentDay: 2, daysAvailable: [1, 2],
  defaultCountry: "NOR",
  countries: [{code, name, athletes}],
  categories: [{title, bow, age, gender, official, updated,
                results: [{pos, name, country, countryName, total, arrows,
                           day, target, group, scored, photo, hits,
                           days: {"1": {pts, arrows, hits, official},
                                  "2": {pts, arrows, shots, live, updated}}}]}]
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
CSV_URL = f"{BASE}/competition/{RACE_ID}/{SLUG}/results/export.csv"
FINAL_URL = f"{BASE}/race/{RACE_ID}/{SLUG}/final-projector.json"
PAGE_URL = f"{BASE}/competition/{RACE_ID}/{SLUG}"
OUT_FILE = ROOT / "data" / "hdhiaa.json"
DAYS_FILE = ROOT / "data" / "hdhiaa_days.json"        # per-dag resultatlager (i git)
STATE_FILE = ROOT / "data" / ".hdhiaa_state.json"     # siste inbox-id (ikke i git)
GROUPS_CACHE = ROOT / "data" / ".hdhiaa_groups.json"  # bufret startliste (ikke i git)

ARROWS_PER_DAY = 28  # èn dags runde i 3D-VM (CSV "Max" 308 = 28×11)

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


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_state() -> dict:
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_state(state: dict) -> None:
    STATE_FILE.write_text(json.dumps(state), encoding="utf-8")


def check_live() -> tuple:
    """Er det kommet nye data siden sist?
    Returnerer (endret, standings|None, standings_raw|None, final_raw|None).

    To signaler, billigste først:
    1. inbox-feeden (~7 KB): nye opplastings-id-er enn state.lastInboxId.
       (Kan være avslått/404 — da hoppes den over.)
    2. Hvis inbox er tom/uendret: hent stillingene + finale-prosjektoren og
       sammenlign innholds-hash. De oppdateres også via andre kanaler enn
       inbox — og finalene oppdateres KUN via projektoren.
    """
    state = load_state()
    if state.get("lastInboxId") is None and not state.get("lastStandingsHash"):
        return True, None, None, None  # første kjøring: alltid full henting
    try:
        inbox = fetch_json(INBOX_URL)
        ids = [i.get("id", 0) for i in inbox.get("items", [])]
        if ids and max(ids) > state.get("lastInboxId", 0):
            return True, None, None, None
    except Exception as exc:
        print(f"warn: inbox-sjekk: {exc}", file=sys.stderr)
    raw = fetch_text(STANDINGS_URL)
    try:
        final_raw = fetch_text(FINAL_URL)
    except Exception as exc:
        print(f"warn: final-sjekk: {exc}", file=sys.stderr)
        final_raw = ""
    if hashlib.md5((raw + final_raw).encode()).hexdigest() != state.get("lastStandingsHash"):
        return True, json.loads(raw), raw, final_raw
    return False, None, None, None


def load_groups(standings: dict) -> dict:
    """Startlista (419 KB) endrer seg ikke under stevnet — bruk lokal buffer,
    men hent på nytt hvis bufferen er gammel eller live-scorene viser en
    utøver vi ikke kjenner. Faller tilbake på foreldet buffer hvis endepunktet
    er nede (bedre enn å stoppe pollen)."""
    known = {l.get("raceApplyId") for c in standings.get("categories", [])
             for l in c.get("leaders", [])}
    cache = None
    try:
        cache = json.loads(GROUPS_CACHE.read_text(encoding="utf-8"))
        age_ok = cache.get("fetched", 0) > datetime.now(timezone.utc).timestamp() - 3600
        ids = {m.get("id") for t in cache["data"].get("teams", []) for m in t.get("members", [])}
        if age_ok and known <= ids:
            return cache["data"]
    except Exception:
        cache = None
    try:
        groups = fetch_json(GROUPS_URL)
        GROUPS_CACHE.write_text(json.dumps({
            "fetched": datetime.now(timezone.utc).timestamp(), "data": groups}))
        return groups
    except Exception as exc:
        if cache is not None:
            print(f"warn: groups: {exc} — bruker foreldet buffer", file=sys.stderr)
            return cache["data"]
        raise


def parse_meta(meta: str) -> tuple:
    """'DAY 1/3 · TARGET 6 · hit' -> ('1', '6')"""
    day = re.search(r"DAY\s+(\d+)", meta or "")
    target = re.search(r"TARGET\s+(\w+)", meta or "")
    return (day.group(1) if day else "", target.group(1) if target else "")


def norm_name(name: str) -> str:
    return re.sub(r"\s+", " ", name or "").strip().casefold()


def akey(title: str, name: str) -> str:
    """Nøkkel i dag-lageret: klasse + normalisert navn (CSV har ingen id-er)."""
    return f"{title}\x1f{norm_name(name)}"


def to_int(s: str) -> int:
    m = re.search(r"\d+", s or "")
    return int(m.group(0)) if m else 0


def parse_results_csv(text: str) -> tuple:
    """Parse results/export.csv (offisiell stilling) ->
    ({sectionTitle: [rows]}, generated). Seksjoner:
      "Buestil (KODE) — Alder — Kjønn"
      "Rank","Name","Country","Club","Gender","11","10","8","5","0","Avg","Perf %","Max","Pts"
    """
    import csv
    import io
    sections, generated = {}, ""
    cur, header = None, None
    for r in csv.reader(io.StringIO(text.lstrip("\ufeff"))):
        if not r:
            continue
        if r[0] == "Generated" and len(r) > 1:
            generated = r[1]
            continue
        if len(r) == 1 and "—" in r[0]:
            cur, header = r[0], None
            sections[cur] = []
            continue
        if cur and r[0] == "Rank":
            header = r
            continue
        if cur and header and re.match(r"^\d+$", r[0] or ""):
            d = dict(zip(header, r))
            hits = {k: to_int(d.get(k, "")) for k in ("11", "10", "8", "5", "0") if k in d}
            sections[cur].append({
                "pos": int(d["Rank"]),
                "name": re.sub(r"\s+", " ", d.get("Name", "")).strip(),
                "country": d.get("Country", ""),
                "total": to_int(d.get("Pts", "")),
                "arrows": sum(hits.values()),
                "hits": hits,
            })
    return sections, generated


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


# ---------- dag-lager ----------

def load_days() -> dict:
    try:
        return json.loads(DAYS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_days(store: dict) -> None:
    store["updated"] = now_iso()
    DAYS_FILE.write_text(json.dumps(store, ensure_ascii=False, indent=1), encoding="utf-8")


def merge_live(store: dict, standings: dict) -> tuple:
    """Flett gjeldende dags live-scorer inn i lageret.
    Returnerer (current_day, total_days, antall flettet)."""
    cur = tot = n = 0
    archers = store.setdefault("archers", {})
    ts = now_iso()
    for cat in standings.get("categories", []):
        title = cat.get("title") or ""
        for l in cat.get("leaders", []):
            m = re.search(r"DAY\s+(\d+)\s*/\s*(\d+)", l.get("meta") or "")
            if not m:
                continue
            d, t = int(m.group(1)), int(m.group(2))
            cur, tot = max(cur, d), max(tot, t)
            rec = archers.setdefault(akey(title, l.get("name")), {"days": {}})
            rec["name"] = re.sub(r"\s+", " ", l.get("name") or "").strip()
            if l.get("raceApplyId"):
                rec["rid"] = l["raceApplyId"]
            entry = {
                "pts": l.get("totalPoints") or 0,
                "arrows": l.get("shotsRecorded") or 0,
                "shots": [str(s) for s in (l.get("shots") or [])],
                "live": True, "official": False, "updated": ts,
            }
            old = rec["days"].get(str(d))
            # offisiell liste for dagen står seg mot live-data med færre piler
            if old and old.get("official") and old.get("arrows", 0) >= entry["arrows"]:
                continue
            rec["days"][str(d)] = entry
            n += 1
    if cur:
        meta = store.setdefault("meta", {})
        meta["currentDay"] = cur
        meta["totalDays"] = max(tot, meta.get("totalDays", 0))
    return cur, tot, n


def guess_single_day(store: dict, sections: dict, current_day: int):
    """Hvilken dag hører en CSV med èn dags piler (28) til? Sammenlign
    poengsummene med lagrede offisielle dager: stort sett lik -> samme dag;
    tydelig forskjellig -> neste dag uten offisiell liste."""
    archers = store.get("archers", {})
    for d in range(1, 10):
        comp = match = 0
        for title, rows in sections.items():
            for row in rows:
                old = archers.get(akey(title, row["name"]), {}).get("days", {}).get(str(d))
                if old and old.get("official"):
                    comp += 1
                    match += old.get("pts") == row["total"]
        if comp < 20:
            continue
        if match / comp >= 0.6:
            return d
        official_days = {int(dd) for rec in archers.values()
                         for dd, v in rec.get("days", {}).items() if v.get("official")}
        for cand in range(1, (current_day or 2)):
            if cand not in official_days:
                return cand
        return (max(official_days) + 1) if official_days else 1
    return 1  # ingen offisielle dager å sammenligne med


def merge_csv(store: dict, sections: dict, generated: str, current_day: int) -> int:
    """Flett offisiell CSV inn i dag-lageret. Returnerer antall oppdaterte rader."""
    if not sections:
        return 0
    arrows = next((r["arrows"] for rows in sections.values() for r in rows if r["arrows"]), 0)
    n_days = arrows // ARROWS_PER_DAY if arrows and arrows % ARROWS_PER_DAY == 0 else 0
    archers = store.setdefault("archers", {})
    updated = 0
    if n_days == 1:
        day_no = guess_single_day(store, sections, current_day)
        if day_no is None:
            print("csv: kunne ikke plassere dagslisten — hopper over", file=sys.stderr)
            return 0
        for title, rows in sections.items():
            for row in rows:
                rec = archers.setdefault(akey(title, row["name"]), {"days": {}})
                rec["name"] = row["name"]
                rec["days"][str(day_no)] = {
                    "pts": row["total"], "arrows": row["arrows"],
                    "hits": row["hits"], "official": True,
                }
                updated += 1
        store.setdefault("meta", {})[f"day{day_no}Csv"] = generated
        print(f"csv: offisiell dag {day_no} ({arrows} piler, {updated} rader)")
    elif n_days > 1:
        # sammenlagtliste t.o.m. dag n_days: fyll manglende enkelt-dag ved
        # subtraksjon når alle andre dager er kjente, ellers lagre totalsummen
        for title, rows in sections.items():
            for row in rows:
                rec = archers.setdefault(akey(title, row["name"]), {"days": {}})
                rec["name"] = row["name"]
                days = rec["days"]
                known = {int(d) for d in days if str(d).isdigit() and int(d) <= n_days}
                missing = [d for d in range(1, n_days + 1) if d not in known]
                if len(missing) == 1:
                    rest = sum(days[str(d)].get("pts", 0) for d in known)
                    days[str(missing[0])] = {
                        "pts": max(0, row["total"] - rest), "arrows": ARROWS_PER_DAY,
                        "official": True,
                    }
                    updated += 1
                elif len(missing) > 1:
                    rec["cum"] = {"through": n_days, "pts": row["total"],
                                  "hits": row["hits"], "official": True}
                    updated += 1
        store.setdefault("meta", {})[f"cum{n_days}Csv"] = generated
        print(f"csv: sammenlagt t.o.m. dag {n_days} ({arrows} piler, {updated} rader)")
    else:
        print(f"csv: uventet pil-antall ({arrows}) — hopper over", file=sys.stderr)
    return updated


def fetch_partial_rounds(store: dict) -> dict:
    """Stevnesiden har en dags-velger med interne runde-id-er
    (<option value="142">1st day</option>). Returnerer {dag(str): id(str)}.
    Mappet bufres i meta og hentes på nytt daglig, eller når live-feeden
    viser en nyere dag enn vi har id for."""
    meta = store.setdefault("meta", {})
    rounds = meta.get("partialRounds") or {}
    cur = int(meta.get("currentDay") or 0)
    fresh = meta.get("partialRoundsFetched", "") == now_iso()[:10]
    if rounds and fresh and max(map(int, rounds), default=0) >= max(1, cur - 1):
        return rounds
    try:
        html = fetch_text(PAGE_URL)
    except Exception as exc:
        print(f"warn: stevneside: {exc}", file=sys.stderr)
        return rounds
    found = {m.group(2): m.group(1) for m in re.finditer(
        r'<option value="(\d+)"[^>]*>\s*(\d+)(?:st|nd|rd|th) day', html)}
    if found:
        if found != rounds:
            print(f"stevneside: dags-runder {found}")
        meta["partialRounds"] = found
        meta["partialRoundsFetched"] = now_iso()[:10]
    return meta.get("partialRounds") or {}


def merge_daily_csvs(store: dict, rounds: dict, current_day: int, live_active: bool) -> int:
    """Hent og flett offisiell CSV per dag (partial_round=<id>). En dag som
    skytes akkurat nå (live) dekkes av live-feeden; ellers hentes listen —
    på nytt en gang i timen slik at score-korrigeringer blir med."""
    archers = store.setdefault("archers", {})
    meta = store.setdefault("meta", {})
    updated = 0
    now = time.time()
    for day_no, pr_id in sorted(rounds.items(), key=lambda kv: int(kv[0])):
        if live_active and int(day_no) >= current_day:
            continue  # dagen skytes nå — live-feeden dekker den
        fetched_key = f"day{day_no}Fetched"
        has_official = any(rec.get("days", {}).get(day_no, {}).get("official")
                           for rec in archers.values())
        if has_official and now - meta.get(fetched_key, 0) < 3600:
            continue
        try:
            sections, generated = parse_results_csv(
                fetch_text(f"{CSV_URL}?partial_round={pr_id}"))
        except Exception as exc:
            print(f"warn: csv dag {day_no}: {exc}", file=sys.stderr)
            continue
        rows_n = 0
        for title, rows in sections.items():
            for row in rows:
                rec = archers.setdefault(akey(title, row["name"]), {"days": {}})
                rec["name"] = row["name"]
                rec["days"][day_no] = {
                    "pts": row["total"], "arrows": row["arrows"],
                    "hits": row["hits"], "official": True,
                }
                rows_n += 1
        if rows_n:
            meta[fetched_key] = now
            meta[f"day{day_no}Csv"] = generated
            meta["lastCsvGenerated"] = generated
            updated += rows_n
            print(f"csv: offisiell dag {day_no} ({rows_n} rader)")
    return updated


def merge_finals(store: dict, final_data: dict) -> int:
    """Flett finale-prosjektoren inn i lageret. Per gruppe (klasse i finalen):
    topp 6 med kval-sum + per-blink-scorer i finalen etter hvert som de
    skytes. Returnerer antall grupper."""
    groups_in = final_data.get("groups") or []
    if not groups_in:
        return 0
    prev = store.get("finals", {}).get("groups", {})
    groups = {}
    ts = now_iso()
    n_changed = 0
    for g in groups_in:
        gid = str(g.get("id"))
        rows = [{
            "rid": r.get("applyId"),
            "name": re.sub(r"\s+", " ", r.get("name") or "").strip(),
            "country": r.get("countryCode") or "",
            "sum": r.get("sum") or 0,
            "targets": r.get("targetScores") or [],
            "finalPts": r.get("finalPts"),
            "total": r.get("total") or 0,
            "rank": r.get("rank") or 0,
        } for r in g.get("rows", [])]
        old = prev.get(gid) or {}
        if old.get("rows") == rows and old.get("complete") == bool(g.get("complete")):
            updated = old.get("updated", ts)
        else:
            updated = ts
            n_changed += 1
        groups[gid] = {
            "id": g.get("id"),
            "title": g.get("sortKey") or g.get("groupTitle") or "",
            "complete": bool(g.get("complete")),
            "updated": updated,
            "rows": rows,
        }
    store["finals"] = {
        "targetCount": final_data.get("targetCount") or 0,
        "groups": groups,
        "updated": ts,
    }
    if n_changed:
        print(f"finaler: {len(groups)} grupper, {n_changed} med nye scorer")
    return len(groups)


def main() -> int:
    if "--force" not in sys.argv and (until := paused()):
        print(f"paused until {until}")
        return 0
    live_mode = "--live" in sys.argv
    standings = standings_raw = final_raw = None
    if live_mode:
        try:
            changed, standings, standings_raw, final_raw = check_live()
            if not changed:
                print("no new scores")
                return 0
        except Exception as exc:  # ved sjekk-feil: gjør full henting likevel
            print(f"warn: live-check: {exc}", file=sys.stderr)
            standings = standings_raw = final_raw = None
    race = fetch_json(RACE_URL).get("data", {})
    if standings is None:
        standings_raw = fetch_text(STANDINGS_URL)
        standings = json.loads(standings_raw)
    if final_raw is None:
        try:
            final_raw = fetch_text(FINAL_URL)
        except Exception as exc:  # finalene er en bonus — ikke stopp pollen
            print(f"warn: final: {exc}", file=sys.stderr)
            final_raw = ""

    store = load_days()
    current_day, total_days, n_live = merge_live(store, standings)
    if not current_day:
        current_day = store.get("meta", {}).get("currentDay", 0)
    try:
        merge_finals(store, json.loads(final_raw) if final_raw else {})
    except Exception as exc:
        print(f"warn: final-parse: {exc}", file=sys.stderr)

    # Offisielle dagsresultater: per-dag CSV via runde-id-ene på stevnesiden
    # (fanger også score-korrigeringer). Fallback uten id-er: sammenlagt-CSV
    # med dag-gjetting. Verken live eller CSV har data, og lageret er tomt →
    # behold forrige gode fil.
    csv_generated = store.get("meta", {}).get("lastCsvGenerated", "")
    rounds = fetch_partial_rounds(store)
    live_active = n_live > 0
    if rounds:
        merge_daily_csvs(store, rounds, current_day, live_active)
    else:
        try:
            official, csv_generated = parse_results_csv(fetch_text(CSV_URL))
            official = {t: rows for t, rows in official.items() if rows}
            merge_csv(store, official, csv_generated, current_day)
        except Exception as exc:
            print(f"warn: csv: {exc}", file=sys.stderr)

    if not store.get("archers"):
        if OUT_FILE.exists():
            try:
                old = json.loads(OUT_FILE.read_text(encoding="utf-8"))
                if any(r.get("scored") for c in old.get("categories", []) for r in c.get("results", [])):
                    print("verken live eller CSV har data — beholder forrige data")
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

    # Latest activity per category from the inbox feed
    updated_by_cat = {}
    for item in inbox.get("items", []):
        cat = item.get("categoryName") or ""
        ts = item.get("receivedAt") or ""
        if cat and ts > updated_by_cat.get(cat, ""):
            updated_by_cat[cat] = ts

    # Live-ekstra per (category, raceApplyId): blink, foto, siste piler
    live_extra = {}
    live_titles = set()
    for cat in standings.get("categories", []):
        for l in cat.get("leaders", []):
            day, target = parse_meta(l.get("meta") or "")
            live_titles.add(cat.get("title"))
            live_extra[(cat.get("title"), l.get("raceApplyId"))] = {
                "day": day, "target": target,
                "shots": [str(s) for s in (l.get("shots") or [])][-12:],
                "photo": l.get("photoUrl") or "",
            }

    # One category per sectionTitle, in the site's own filter order
    order = {s: i for i, s in enumerate(groups.get("filterOptions", {}).get("styles", []))}
    age_order = {a: i for i, a in enumerate(groups.get("filterOptions", {}).get("classes", []))}
    by_section = {}
    for m in members:
        by_section.setdefault(m.get("sectionTitle") or "", []).append(m)

    archers = store.get("archers", {})

    def build_row(name, country, country_name, group, rid):
        rec = archers.get(akey(title, name), {})
        days = rec.get("days", {})
        cum = rec.get("cum") or {}
        ex = live_extra.get((title, rid)) or {}
        total = sum(d.get("pts", 0) for d in days.values())
        if cum.get("through", 0) >= max([int(d) for d in days if str(d).isdigit()] or [0]):
            total = max(total, cum.get("pts", 0))
        hits = {}
        for d in days.values():
            for hk, hv in (d.get("hits") or {}).items():
                hits[hk] = hits.get(hk, 0) + hv
        if not hits and cum.get("hits"):
            hits = cum["hits"]
        row = {
            "name": name,
            "country": country,
            "countryName": country_name,
            "group": group,
            "rid": rid,
            "scored": bool(days) or bool(cum),
            "total": total,
            "arrows": sum(d.get("arrows", 0) for d in days.values()) or cum.get("through", 0) * ARROWS_PER_DAY,
            "day": ex.get("day", ""),
            "target": ex.get("target", ""),
            "shots": ex.get("shots", []),
            "photo": ex.get("photo", ""),
        }
        if hits:
            row["hits"] = hits
        if days:
            row["days"] = {d: days[d] for d in sorted(days, key=lambda x: int(x) if str(x).isdigit() else 99)}
        return row

    categories = []
    for title, ms in by_section.items():
        used_keys = set()
        results = []
        for m in ms:
            used_keys.add(akey(title, m.get("fullName")))
            results.append(build_row(m.get("fullName") or "", m.get("countryCode") or "",
                                     m.get("countryName") or "", m.get("group") or "", m.get("id")))
        # utøvere som bare finnes i lageret (ikke matchet mot startlista)
        for k, rec in archers.items():
            t, _sep, nname = k.partition("\x1f")
            if t != title or k in used_keys:
                continue
            c3 = next((l.get("countryCode") for c in standings.get("categories", [])
                       if c.get("title") == title for l in c.get("leaders", [])
                       if norm_name(l.get("name")) == nname), "")
            results.append(build_row(rec.get("name") or nname,
                                     code_by_name.get(country_names.get(c3, ""), c3) or c3,
                                     country_names.get(c3, ""), "", rec.get("rid")))
        # plassering: sammenlagt poeng desc (delt plass ved likt), uskoredede til slutt
        scored = sorted((r for r in results if r["scored"]), key=lambda r: -r["total"])
        prev_total, prev_pos = None, 0
        for i, r in enumerate(scored, 1):
            prev_pos = prev_pos if r["total"] == prev_total else i
            r["pos"] = prev_pos
            prev_total = r["total"]
        rest = sorted((r for r in results if not r["scored"]), key=lambda r: r["name"])
        for r in rest:
            r["pos"] = 0
        first = ms[0]
        bow_m = re.search(r"\(([^)]+)\)", first.get("category") or "")
        cat_official = title not in live_titles
        categories.append({
            "title": title,
            "bow": bow_m.group(1) if bow_m else "",
            "age": first.get("ageGroup") or "",
            "gender": GENDER.get(first.get("gender"), ""),
            "official": cat_official,
            "updated": csv_generated if cat_official else updated_by_cat.get(title, ""),
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

    meta = store.get("meta", {})
    days_avail = sorted({int(d) for rec in archers.values() for d in rec.get("days", {})
                         if str(d).isdigit()})
    out = {
        "generated": now_iso(),
        "competition": {
            "id": RACE_ID,
            "name": race.get("name") or "World 3D Archery Championships 2026",
            "location": race.get("location") or "",
            "country": race.get("countryName") or "",
            "startDate": race.get("startDate") or "",
            "endDate": race.get("endDate") or "",
            "url": PAGE_URL,
        },
        "totalDays": meta.get("totalDays") or total_days or (max(days_avail) if days_avail else 0),
        "currentDay": current_day or (max(days_avail) if days_avail else 0),
        "daysAvailable": days_avail,
        "liveActive": live_active,
        "defaultCountry": "NOR" if "NOR" in countries else (country_list[0]["code"] if country_list else ""),
        "countries": country_list,
        "categories": categories,
        "finals": {
            "targetCount": store.get("finals", {}).get("targetCount", 0),
            "updated": store.get("finals", {}).get("updated", ""),
            "groups": sorted(store.get("finals", {}).get("groups", {}).values(),
                             key=lambda g: g["title"]),
        },
    }
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    save_days(store)
    n_scored = sum(1 for c in categories for r in c["results"] if r["scored"])
    print(f"wrote {OUT_FILE}: {len(country_list)} countries, "
          f"{len(members)} athletes, {len(categories)} categories, {n_scored} with scores, "
          f"dager {days_avail} (dag {out['currentDay']}/{out['totalDays']}"
          f"{', live' if live_active else ''})")
    prev_state = load_state()
    inbox_ids = [i.get("id", 0) for i in inbox.get("items", [])]
    save_state({
        # id-ene kan resettes av hdhiaa — behold alltid høyeste sette
        "lastInboxId": max([prev_state.get("lastInboxId", 0)] + inbox_ids),
        "lastStandingsHash": hashlib.md5((standings_raw + final_raw).encode()).hexdigest(),
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
