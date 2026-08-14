# ianseolive

Live-ish results follower for archery tournaments published on
[ianseo.net](https://ianseo.net) — currently tracking **NM Skive 2026**
(`Details.php?toId=28659`).

## How it works

ianseo.net has no CORS-enabled API, so the polling happens server-side:

1. **GitHub Actions** (`.github/workflows/poll.yml`) runs `poller/poll.py`
   every 10 minutes. The script fetches the tournament's Details page,
   discovers uploaded result files (`/TourData/{year}/{toId}/{CODE}.php`),
   parses the HTML tables, and commits `data/results.json` when anything
   changed.
2. **GitHub Pages** serves the static frontend (`index.html` + `app.js`),
   which reads `data/results.json`, lets you pick a club, and shows that
   club's archers in every published result file plus the club roster.

Result-file codes used by ianseo: `IQ{event}` qualification ranks,
`IE` eliminations, `IF` final ranks, `IB` brackets, `TQ/TF/TB` team
equivalents, `ENA/ENC/ENE/ENS` start lists (`ENC` = by club, used for the
roster).

## Configuration

`config.json`:

| key | meaning |
|---|---|
| `toId` | ianseo tournament id (from `Details.php?toId=…`) |
| `year` | tournament year (part of the TourData URL) |
| `tournamentName` | display name |
| `tournamentCode` | ianseo short code (see `TourList.php`) |
| `defaultClub` | club preselected in the UI (exact ianseo spelling) |

The club can also be switched in the UI; the choice is stored in the
browser's localStorage.

## Setup on a fresh fork

1. Edit `config.json`.
2. Push to GitHub, then enable **Settings → Pages → Deploy from branch →
   main / (root)**.
3. **Actions → Poll ianseo results → Run workflow** to fetch the first
   data set (or wait for the schedule).

To follow a different tournament, change `toId`, `year` and names in
`config.json` — that's it.

## Notes / limits

- Update latency = workflow interval (10 min) + GitHub's scheduler jitter.
  The schedule can be tightened or the workflow triggered manually.
- Only files the organizer has uploaded are shown. Before/early in the
  tournament this may be start lists only.
- True arrow-by-arrow live data exists on `info.ianseo.net/{code}/` for
  tournaments with the paid ISK-NG live service; this tournament is not
  (currently) one of them.
