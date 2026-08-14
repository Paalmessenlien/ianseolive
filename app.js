/* ianseolive frontend: renders data/results.json produced by poller/poll.py */

const REFRESH_MS = 60_000;
const norm = (s) => (s || "").replace(/\s+/g, " ").trim();

async function loadJson(url) {
  const r = await fetch(`${url}?_=${Date.now()}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

/* Find the column in an event whose values are club names. */
function clubColumn(event, clubs) {
  const set = new Set(clubs.map(norm));
  let best = null, bestHits = 0;
  for (const col of event.columns) {
    if (["Pos.", "Athlete", "Tot."].includes(col)) continue;
    const hits = event.rows.filter((r) => set.has(norm(r[col]))).length;
    if (hits > bestHits) { best = col; bestHits = hits; }
  }
  return bestHits > 0 ? best : null;
}

function renderEvent(event, club, clubs) {
  const col = clubColumn(event, clubs);
  const rows = col ? event.rows.filter((r) => norm(r[col]) === norm(club)) : [];
  const div = document.createElement("div");
  div.className = "event";
  const status = event.status ? ` <span class="status">[${event.status}]</span>` : "";
  div.innerHTML = `<h3>${event.title || event.code}${status}</h3>`;
  if (!col) {
    div.innerHTML += `<p class="muted">No club data in this file yet.</p>`;
  } else if (rows.length === 0) {
    div.innerHTML += `<p class="muted">No archers from ${club} yet.</p>`;
  } else {
    // keep real columns; drop generated "colN" columns when they hold no data
    const cols = event.columns.filter(
      (c) => c && (!c.startsWith("col") || rows.some((r) => norm(r[c]) !== ""))
    );
    let html = "<table><thead><tr>" + cols.map((c) => `<th>${c}</th>`).join("") + "</tr></thead><tbody>";
    for (const r of rows) {
      html += "<tr>" + cols.map((c) => `<td>${r[c] ?? ""}</td>`).join("") + "</tr>";
    }
    div.innerHTML += html + "</tbody></table>";
  }
  return div;
}

function renderRoster(roster, club) {
  const body = document.getElementById("roster-body");
  const archers = roster[club] || [];
  if (archers.length === 0) {
    body.innerHTML = `<p class="muted">No roster entries for ${club}.</p>`;
    return;
  }
  let html = "<table><thead><tr><th>Name</th><th>Target</th><th>Class</th><th>Pool</th></tr></thead><tbody>";
  for (const a of archers) {
    html += `<tr><td>${a.name}</td><td>${a.target}</td><td>${a.class}</td><td>${a.pool}</td></tr>`;
  }
  body.innerHTML = html + "</tbody></table>";
}

async function refresh() {
  const statusLine = document.getElementById("status-line");
  try {
    const data = await loadJson("data/results.json");
    const select = document.getElementById("club-select");
    const saved = localStorage.getItem("ianseolive-club");
    const wanted = select.value || saved || data.defaultClub;

    if (select.options.length === 0) {
      for (const c of data.clubs) {
        const o = document.createElement("option");
        o.value = o.textContent = c;
        select.appendChild(o);
      }
      select.addEventListener("change", () => {
        localStorage.setItem("ianseolive-club", select.value);
        refresh();
      });
    }
    select.value = data.clubs.includes(wanted) ? wanted : data.defaultClub;
    const club = select.value;
    localStorage.setItem("ianseolive-club", club);

    document.getElementById("tournament-name").textContent = data.tournament.name;
    document.getElementById("source-link").href = data.tournament.detailsUrl;
    document.getElementById("last-updated").textContent = `data: ${data.generated} UTC`;

    const eventsDiv = document.getElementById("events");
    eventsDiv.innerHTML = "";
    if (data.events.length === 0) {
      statusLine.textContent = "No result files published yet — the tournament uploads them as scoring progresses.";
    } else {
      statusLine.textContent = `${data.events.length} result file(s) published.`;
      for (const ev of data.events) eventsDiv.appendChild(renderEvent(ev, club, data.clubs));
    }
    renderRoster(data.roster, club);
  } catch (err) {
    statusLine.textContent = `Could not load data (${err.message}). The poller may not have run yet.`;
  }
}

refresh();
setInterval(refresh, REFRESH_MS);
