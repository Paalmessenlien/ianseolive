# ianseolive

Live-ish results follower for archery tournaments published on
[ianseo.net](https://ianseo.net) — currently tracking **NM Skive 2026**
(`Details.php?toId=28659`). The frontend implements the «Ianseo Live»
design (see `design/Ianseo Live.html` for the original design bundle).

## How it works

ianseo.net has no CORS-enabled API, so the polling happens server-side:

1. **Cron on admin.lillehammerbueskyttere.no** (user `ianseo`) runs
   `poller/local_poll.sh` every 5 minutes. The script fetches the
   tournament's Details page, discovers uploaded result files
   (`/TourData/{year}/{toId}/{CODE}.php`), parses the HTML tables, and
   commits `data/results.json` when anything changed (push via a repo
   deploy key). **GitHub Actions** (`.github/workflows/poll.yml`) runs
   the same `poller/poll.py` every 5 minutes as a fallback — its
   schedule is delayed up to ~30 min under load, so the server cron is
   the primary path.
2. **GitHub Pages** serves the static app (`index.html` + `app.js` +
   `style.css`), which reads `data/results.json` and renders a
   mobile-first «app»: club selector, club scores, classes, start list,
   athlete sheets. Club, followed archers and notification toggle persist
   in localStorage.

Result-file codes used by ianseo: `IQ{event}` qualification ranks,
`IE` eliminations, `IF` final ranks, `IB` brackets, `TQ/TF/TB` team
equivalents, `ENA/ENC/ENE/ENS` start lists (`ENC` = by club, used for the
roster). The poller currently turns the `IQ*`/`TQ*` pages into per-class
fields with position, total, estimated arrow count, 10s and Xs.

## Configuration

`config.json`:

| key | meaning |
|---|---|
| `toId` | ianseo tournament id (from `Details.php?toId=…`) |
| `year` | tournament year (part of the TourData URL) |
| `tournamentName` | display name |
| `tournamentCode` | ianseo short code (see `TourList.php`) |
| `tournamentPlace` / `tournamentRound` | subtitle line in the header |
| `defaultClub` | club short code preselected in the UI (e.g. `LILLH`) |

`app.js` accepts `?data=<url>` to render an alternate data file (useful
for demos/previews).

## Setup on a fresh fork

1. Edit `config.json`.
2. Push to GitHub, then enable **Settings → Pages → Deploy from branch →
   main / (root)**.
3. **Actions → Poll ianseo results → Run workflow** to fetch the first
   data set (or wait for the schedule).

## Notes / limits

- Update latency = workflow interval (5 min) + GitHub's scheduler jitter.
- Only files the organizer has uploaded are shown. Before/early in the
  tournament this may be start lists only; arrow counts during the round
  are estimates derived from which distance columns have scores.
- Arrow-by-arrow detail is not present in ianseo's uploaded files, so the
  athlete sheet shows per-distance totals (it renders serie-for-serie
  automatically if `ends` data ever becomes available).
- True live data exists on `info.ianseo.net/{code}/` for tournaments with
  the paid ISK-NG live service; this tournament is not (currently) one of
  them.
