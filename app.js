/* Ianseolive — implementasjon av «Ianseo Live»-designet.
 * Leser data/results.json (produsert av poller/poll.py) og tegner hele
 * appen i #frame. Vanilla JS, ingen avhengigheter.
 */

const CLR = {
  fg: '#06303F', paper: '#F8F6F2', surface: '#fff', muted: '#6E6A63',
  border: '#DDE4E8', accent: '#00AEDA', action: '#00789B', signal: '#C4762E',
};

const DATA_URL = new URLSearchParams(location.search).get('data') || 'data/results.json';
const REFRESH_DATA_MS = 120_000; // henter data.json på nytt
const TICK_MS = 30_000;          // oppdaterer «oppdatert X min siden»

let DATA = { tournament: {}, clubs: [], roster: {}, classes: [], generated: '' };

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* privat modus */ } },
};

const state = {
  tab: 'klubb',
  club: store.get('ianseolive-club', null),
  athlete: null,
  classView: null,
  bracketView: null,
  matchView: null,
  picker: false,
  search: '',
  refreshing: false,
  follows: store.get('ianseolive-follows', []),
  followMatches: store.get('ianseolive-follow-matches', []),
  notify: store.get('ianseolive-notify', true),
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const style = (o) => Object.entries(o).map(([k, v]) =>
  k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()) + ':' + v).join(';');

/* ---------- data-logikk (portert fra designets support.js) ---------- */

function clubRows() {
  const out = [];
  for (const c of DATA.classes || [])
    for (const f of c.field || [])
      if (f.club === state.club && !c.team)
        out.push(Object.assign({ cls: c.name, totalArrows: c.totalArrows || 72,
          updated: (DATA.files || {})[c.code] || '' }, f));
  // ferskest data øverst — de som er helt ferdige samles i bunnen
  const done = (r) => (r.arrows >= r.totalArrows ? 1 : 0);
  return out.sort((a, b) =>
    done(a) - done(b) ||
    String(b.updated).localeCompare(String(a.updated)) ||
    a.pos - b.pos || b.total - a.total);
}

function shortCls(n) {
  return String(n || '').replace('Tradisjonell', 'Trad.').replace('Under ', 'U')
    .replace(' Open Class', '').replace('Visual Impaired ', '');
}

function clubMeta(short) {
  return (DATA.clubs || []).find((c) => c.short === short) || { short, name: '' };
}

function ageMin() {
  const gen = Date.parse(DATA.generated || '');
  if (isNaN(gen)) return 0;
  return Math.max(0, Math.floor((Date.now() - gen) / 60000));
}

/* ---------- stil-hjelpere (fra designet) ---------- */

function rankStyle(pos, mine) {
  const ring = pos === 1 ? CLR.signal : pos <= 3 ? CLR.accent : '#c9c4bb';
  return style({
    flex: 'none', display: 'grid', 'place-items': 'center', width: '34px', height: '34px',
    'border-radius': '9999px', border: '2px solid ' + ring, background: mine ? CLR.paper : 'transparent',
    font: '600 14px "Inter",sans-serif', 'font-variant-numeric': 'tabular-nums',
    color: pos <= 3 ? CLR.fg : CLR.muted,
  });
}

function liveStyle(live, onDark) {
  return live
    ? style({ display: 'inline-flex', 'align-items': 'center', flex: 'none', background: CLR.accent,
        color: CLR.fg, border: '2px solid ' + (onDark ? CLR.paper : CLR.fg), 'border-radius': '9999px',
        padding: '3px 10px', font: '600 10.5px "Inter",sans-serif', 'letter-spacing': '0.12em',
        'text-transform': 'uppercase' })
    : style({ display: 'inline-flex', 'align-items': 'center', flex: 'none', background: 'transparent',
        color: onDark ? CLR.border : CLR.muted, border: '2px solid ' + (onDark ? '#2b5b6b' : CLR.border),
        'border-radius': '9999px', padding: '3px 10px', font: '600 10.5px "Inter",sans-serif',
        'letter-spacing': '0.12em', 'text-transform': 'uppercase' });
}

function tabStyle(id) {
  const on = state.tab === id;
  return style({ display: 'flex', 'flex-direction': 'column', 'align-items': 'center', gap: '4px',
    padding: '8px 2px 7px', border: '2px solid ' + (on ? CLR.paper : 'transparent'),
    'border-radius': '14px', background: on ? CLR.accent : 'transparent',
    color: on ? CLR.fg : CLR.border, font: '600 10.5px "Inter",sans-serif', 'letter-spacing': '0.04em',
    cursor: 'pointer', transition: 'background-color .2s cubic-bezier(0.34,1.56,0.64,1)' });
}

/* ---------- SVG-ikoner (fra designet) ---------- */

const SVG = {
  chevronDown: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="m6 9 6 6 6-6"/></svg>',
  chevronRight: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#00789B" stroke-width="2.5" stroke-linecap="round" style="flex:none"><path d="m9 6 6 6-6 6"/></svg>',
  chevronLeft: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="m15 18-6-6 6-6"/></svg>',
  arrowRight: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#00789B" stroke-width="3" stroke-linecap="round"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>',
  refresh: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-3.2-6.9"/><path d="M21 3v6h-6"/></svg>',
  close: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  target: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4"/></svg>',
  list: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
  grid: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg>',
  medal: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="15" r="5"/><path d="m8.5 10.5-4-7h5l2.5 4 2.5-4h5l-4 7"/></svg>',
  dots: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>',
};

/* ---------- del-visninger ---------- */

function vHeader() {
  const t = DATA.tournament || {};
  const tMeta = [t.place, t.round].filter(Boolean).join(' · ');
  return `
  <div style="flex:none;background:${CLR.fg};color:#fff;padding:14px 18px 12px">
    <div style="display:flex;align-items:center;gap:10px">
      <img src="assets/logo-lbsk.png" alt="LBSK" style="height:26px;width:auto;flex:none">
      <div style="display:flex;flex-direction:column;gap:2px;min-width:0">
        <span style="font-family:'Spectral',Georgia,serif;font-weight:600;font-size:19px;line-height:1.1;letter-spacing:-0.005em;white-space:nowrap">${esc(t.name)}</span>
        <span style="font-size:11px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:${CLR.border};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(tMeta)}</span>
      </div>
      <button data-action="open-picker" style="margin-left:auto;flex:none;display:inline-flex;align-items:center;gap:7px;background:${CLR.accent};color:${CLR.fg};border:2px solid ${CLR.paper};border-radius:9999px;padding:8px 13px;min-height:40px;font-size:12.5px;font-weight:700;letter-spacing:0.06em;cursor:pointer">${esc(state.club || '…')}${SVG.chevronDown}</button>
    </div>
  </div>`;
}

function vStrip() {
  const age = ageMin();
  const updatedText = state.refreshing ? 'Henter fra ianseo…' : age === 0 ? 'Oppdatert nå' : `Oppdatert ${age} min siden`;
  const nextText = state.refreshing ? '' : age >= 5 ? 'neste snart' : `neste om ${Math.max(1, 5 - age)} min`;
  const bar = style({ display: 'block', height: '100%', width: Math.min(100, age * 20) + '%',
    background: age >= 4 ? CLR.signal : CLR.action, transition: 'width .4s ease-out' });
  return `
  <div style="flex:none;background:#fff;border-bottom:2px solid ${CLR.fg};padding:9px 18px 10px">
    <div style="display:flex;align-items:center;gap:9px">
      <span style="flex:none;width:10px;height:10px;border-radius:50%;background:${CLR.signal};border:2px solid ${CLR.fg};animation:amber-pulse 2.6s ease-out infinite"></span>
      <span style="font-size:13px;font-weight:600;color:${CLR.fg};white-space:nowrap">${esc(updatedText)}</span>
      <span style="font-size:12px;color:${CLR.muted};margin-left:auto;white-space:nowrap">${esc(nextText)}</span>
    </div>
    <div style="margin-top:8px;height:4px;border-radius:9999px;background:${CLR.border};overflow:hidden"><span style="${bar}"></span></div>
  </div>`;
}

function vFollowCard(f, cl) {
  const live = f.arrows < f.totalArrows;
  const bar = style({ display: 'block', height: '100%',
    width: Math.round(f.arrows / f.totalArrows * 100) + '%', background: live ? CLR.accent : CLR.signal });
  return `
  <div style="position:relative;background:${CLR.fg};border:2px solid ${CLR.fg};border-radius:24px;padding:18px 18px 16px;overflow:hidden">
    <div style="position:absolute;right:-38px;top:-42px;width:132px;height:132px;border-radius:50%;background:#0b3d4e"></div>
    <div style="position:relative;display:flex;align-items:center;gap:8px;margin-bottom:12px">
      <span style="font-size:11px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:${CLR.border}">Følger</span>
      <span style="color:${CLR.accent};font-size:14px">ᛇ</span>
      <span style="${liveStyle(live, true)}">${live ? 'Skyter nå' : 'Ferdig'}</span>
    </div>
    <div style="position:relative;display:flex;align-items:flex-end;gap:14px">
      <div style="min-width:0;flex:1">
        <p style="margin:0 0 4px;font-family:'Spectral',Georgia,serif;font-weight:600;font-size:23px;line-height:1.16;color:#fff">${esc(f.name)}</p>
        <p style="margin:0;font-size:12.5px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:${CLR.accent}">${esc(shortCls(f.cls))}</p>
      </div>
      <div style="flex:none;text-align:right">
        <span style="display:block;font-family:'Spectral',Georgia,serif;font-weight:700;font-size:40px;line-height:1;color:#fff;font-variant-numeric:tabular-nums">${f.total}</span>
        <span style="display:block;margin-top:3px;font-size:12px;color:${CLR.border}">${f.arrows} av ${f.totalArrows} piler</span>
      </div>
    </div>
    <div style="position:relative;margin:14px 0 13px;height:5px;border-radius:9999px;background:rgba(221,228,232,.28);overflow:hidden"><span style="${bar}"></span></div>
    <div style="position:relative;display:flex;align-items:center;gap:10px">
      <span style="display:inline-grid;place-items:center;min-width:44px;height:34px;padding:0 10px;border-radius:9999px;border:2px solid ${CLR.signal};color:#fff;font-size:14px;font-weight:700;font-variant-numeric:tabular-nums">#${f.pos}</span>
      <span style="font-size:13px;color:${CLR.border}">av ${(cl.field || []).length} i klassen${live ? ' · serie ' + Math.ceil(f.arrows / 6) : ' · ferdig'}</span>
      <button data-action="open-athlete" data-cls="${esc(f.cls)}" data-name="${esc(f.name)}" style="margin-left:auto;display:inline-flex;align-items:center;gap:8px;background:#fff;color:${CLR.fg};border:2px solid ${CLR.accent};border-radius:9999px;padding:9px 15px;min-height:44px;font-size:14px;font-weight:700;cursor:pointer">Pil for pil${SVG.arrowRight}</button>
    </div>
  </div>`;
}

function vClubRow(r) {
  const live = r.arrows < r.totalArrows;
  const meta = live ? `skyter · ${r.arrows}/${r.totalArrows}` : `${r.tens} tiere`;
  const metaSt = style({ display: 'block', 'margin-top': '4px', font: '600 11px "Inter",sans-serif',
    'letter-spacing': '0.06em', color: live ? CLR.action : CLR.muted });
  return `
  <button data-action="open-athlete" data-cls="${esc(r.cls)}" data-name="${esc(r.name)}" style="display:flex;align-items:center;gap:12px;width:100%;padding:14px 4px;background:none;border:0;border-bottom:2px solid #e8e3da;cursor:pointer">
    <span style="${rankStyle(r.pos, true)}">${r.pos}</span>
    <span style="flex:1;min-width:0;text-align:left">
      <span style="display:block;font-family:'Spectral',Georgia,serif;font-weight:600;font-size:17px;line-height:1.2;color:${CLR.fg};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.name)}</span>
      <span style="display:block;margin-top:3px;font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:${CLR.muted};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(shortCls(r.cls))}</span>
    </span>
    <span style="flex:none;text-align:right">
      <span style="display:block;font-family:'Spectral',Georgia,serif;font-weight:600;font-size:21px;line-height:1;color:${CLR.fg};font-variant-numeric:tabular-nums">${r.total}</span>
      <span style="${metaSt}">${esc(meta)}</span>
    </span>
  </button>`;
}

function vTabKlubb() {
  const rowsRaw = clubRows();
  const followed = rowsRaw.filter((r) => state.follows.includes(r.name));
  const cards = followed.map((f) =>
    vFollowCard(f, (DATA.classes || []).find((c) => c.name === f.cls) || { field: [] })).join('');
  const rowsNote = rowsRaw.length ? `${rowsRaw.length} i publiserte filer` : '0 i publiserte filer';
  const list = rowsRaw.length
    ? `<div style="display:flex;flex-direction:column;gap:0">${rowsRaw.map(vClubRow).join('')}</div>`
    : `<div style="background:#fff;border:2px solid ${CLR.fg};border-radius:24px;padding:22px 20px;box-shadow:8px 8px 0 0 ${CLR.border}">
        <p style="margin:0 0 10px;font-size:12.5px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:${CLR.action}">Ingen resultatfiler ennå</p>
        <p style="margin:0 0 14px;font-size:15.5px;line-height:1.6;color:${CLR.muted}">Ianseo viser bare filene arrangøren har lastet opp. Akkurat nå finnes startlister og målfordeling — poeng kommer etter hver serie.</p>
        <button data-action="go-start" style="display:inline-flex;align-items:center;gap:9px;background:${CLR.action};color:#fff;border:2px solid ${CLR.fg};border-radius:9999px;padding:12px 22px;min-height:48px;font-size:15px;font-weight:700;cursor:pointer;box-shadow:4px 4px 0 0 ${CLR.fg}">Se startliste og mål</button>
      </div>`;
  return `
  <div style="display:flex;flex-direction:column;gap:22px">
    ${vMedalSection()}
    ${cards}
    ${vFollowedMatches()}
    ${vFinalsSection()}
    <div>
      <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:10px">
        <p style="margin:0;font-size:12.5px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:${CLR.action}">Klubbens skyttere</p>
        <span style="margin-left:auto;font-size:12.5px;color:${CLR.muted};font-variant-numeric:tabular-nums">${esc(rowsNote)}</span>
      </div>
      ${list}
    </div>
  </div>`;
}

function vTabKlasser() {
  const names = (DATA.classes || [])
    .filter((c) => (c.field || []).some((f) => f.club === state.club))
    .map((c) => c.name);
  const items = names.map((name) => {
    const cl = (DATA.classes || []).find((c) => c.name === name) || { field: [] };
    const mine = (cl.field || []).filter((f) => f.club === state.club);
    const best = Math.min(...mine.map((f) => f.pos));
    const badge = style({ flex: 'none', display: 'grid', 'place-items': 'center', 'min-width': '42px',
      height: '32px', padding: '0 9px', 'border-radius': '9999px',
      border: '2px solid ' + (best === 1 ? CLR.signal : CLR.border),
      font: '700 13px "Inter",sans-serif', 'font-variant-numeric': 'tabular-nums', color: CLR.fg });
    return `
    <button data-action="open-class" data-cls="${esc(name)}" style="display:flex;align-items:center;gap:13px;width:100%;text-align:left;background:#fff;border:2px solid ${CLR.fg};border-radius:16px;padding:14px 15px;cursor:pointer;box-shadow:4px 4px 0 0 ${CLR.border}">
      <span style="flex:1;min-width:0">
        <span style="display:block;font-family:'Spectral',Georgia,serif;font-weight:600;font-size:17px;line-height:1.2;color:${CLR.fg}">${esc(name)}</span>
        <span style="display:block;margin-top:4px;font-size:12.5px;color:${CLR.muted}">${(cl.field || []).length} skyttere · ${mine.length} fra ${esc(state.club)}</span>
      </span>
      <span style="${badge}">#${best}</span>
      ${SVG.chevronRight}
    </button>`;
  }).join('');
  return `
  <div>
    <p style="margin:0 0 12px;font-size:12.5px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:${CLR.action}">Klasser med ${esc(state.club)}</p>
    <div style="display:flex;flex-direction:column;gap:10px">
      ${items || '<p style="font-size:14px;color:' + CLR.muted + '">Ingen klasser med publiserte resultater ennå.</p>'}
    </div>
  </div>`;
}

function vTabStart() {
  const rosterArr = (DATA.roster || {})[state.club] || [];
  const pools = [...new Set(rosterArr.map((a) => a.pool))].sort();
  const groups = pools.map((p) => {
    const items = rosterArr.filter((a) => a.pool === p)
      .sort((a, b) => a.target.localeCompare(b.target, 'nb', { numeric: true }));
    const rows = items.map((a) => `
      <div style="display:flex;align-items:center;gap:13px;padding:12px 4px;border-bottom:2px solid #e8e3da">
        <span style="flex:none;display:grid;place-items:center;min-width:46px;height:36px;padding:0 9px;border-radius:8px;border:2px solid ${CLR.fg};background:${CLR.paper};font-size:14px;font-weight:700;font-variant-numeric:tabular-nums">${esc(a.target)}</span>
        <span style="flex:1;min-width:0">
          <span style="display:block;font-family:'Spectral',Georgia,serif;font-weight:600;font-size:16.5px;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.name)}</span>
          <span style="display:block;margin-top:3px;font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:${CLR.muted}">${esc(shortCls(a.class))}</span>
        </span>
      </div>`).join('');
    return `
    <div>
      <div style="display:flex;align-items:center;gap:9px;margin-bottom:8px">
        <span style="font-size:12.5px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:${CLR.action}">${esc(p)}</span>
        <span style="color:${CLR.action};font-size:14px">ᛇ</span>
        <span style="font-size:12.5px;color:${CLR.muted}">${items.length} skyttere</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:0">${rows}</div>
    </div>`;
  }).join('');
  return `
  <div style="display:flex;flex-direction:column;gap:20px">
    <p style="margin:0;font-size:15.5px;line-height:1.6;color:${CLR.muted}">Startliste hentet fra ianseos <span style="font-weight:600;color:${CLR.fg}">ENC</span> — påmeldte gruppert etter klubb. Målnummer og pulje er arrangørens.</p>
    ${groups || '<p style="font-size:14px;color:' + CLR.muted + '">Ingen startliste for klubben ennå.</p>'}
  </div>`;
}

function vTabMer() {
  const t = DATA.tournament || {};
  const generatedLabel = String(DATA.generated || '').replace('T', ' ').replace('Z', '') + ' UTC';
  const track = style({ flex: 'none', display: 'flex', 'align-items': 'center', width: '54px',
    height: '32px', padding: '2px', 'border-radius': '9999px', border: '2px solid ' + CLR.fg,
    background: state.notify ? CLR.accent : CLR.paper,
    'justify-content': state.notify ? 'flex-end' : 'flex-start',
    transition: 'background-color .2s ease-out' });
  const knob = style({ display: 'block', width: '24px', height: '24px', 'border-radius': '9999px',
    background: CLR.surface, border: '2px solid ' + CLR.fg });
  const notifyNote = state.notify
    ? 'Varselet kommer når hentingen finner nye tall — ikke i det øyeblikket pilen treffer.'
    : 'Av. Du må selv åpne appen for å se nye serier.';
  const dot = (bg) => `<span style="flex:none;width:9px;height:9px;margin-top:5px;border-radius:50%;background:${bg};border:2px solid ${CLR.fg}"></span>`;
  return `
  <div style="display:flex;flex-direction:column;gap:14px">
    <div style="background:#fff;border:2px solid ${CLR.fg};border-radius:16px;padding:16px;box-shadow:4px 4px 0 0 ${CLR.border}">
      <p style="margin:0 0 6px;font-size:12.5px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:${CLR.action}">Klubb jeg følger</p>
      <p style="margin:0 0 13px;font-family:'Spectral',Georgia,serif;font-weight:600;font-size:19px;line-height:1.2">${esc(clubMeta(state.club).name)}</p>
      <button data-action="open-picker" style="display:inline-flex;align-items:center;gap:9px;background:transparent;color:${CLR.fg};border:2px solid ${CLR.fg};border-radius:9999px;padding:11px 20px;min-height:48px;font-size:15px;font-weight:700;cursor:pointer">Bytt klubb</button>
    </div>
    <div style="background:#fff;border:2px solid ${CLR.fg};border-radius:16px;padding:16px;box-shadow:4px 4px 0 0 ${CLR.border}">
      <p style="margin:0 0 6px;font-size:12.5px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:${CLR.action}">Slik oppdateres tallene</p>
      <p style="margin:0 0 12px;font-size:15.5px;line-height:1.6;color:${CLR.muted}">Ianseo har ingen åpen API, så en jobb henter turneringssiden hvert tiende minutt og lagrer det som endres. Appen er derfor <span style="font-weight:600;color:${CLR.fg}">nesten sanntid</span> — ikke pil for pil.</p>
      <ul style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:9px">
        <li style="display:flex;gap:11px;font-size:14px;color:${CLR.fg}">${dot(CLR.accent)}Sist hentet: ${esc(generatedLabel)}</li>
        <li style="display:flex;gap:11px;font-size:14px;color:${CLR.fg}">${dot(CLR.signal)}Turnerings-ID ${esc(t.toId || '28659')} · kode ${esc(t.code || '')}</li>
        <li style="display:flex;gap:11px;font-size:14px;color:${CLR.fg}">${dot(CLR.action)}<a href="${esc(t.detailsUrl || '#')}" target="_blank" rel="noopener">Kilde: ianseo.net</a></li>
      </ul>
    </div>
    <div style="background:#fff;border:2px solid ${CLR.fg};border-radius:16px;padding:16px;box-shadow:4px 4px 0 0 ${CLR.border}">
      <p style="margin:0 0 12px;font-size:12.5px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:${CLR.action}">Varsler</p>
      <button data-action="toggle-notify" style="display:flex;align-items:center;gap:13px;width:100%;text-align:left;background:none;border:0;padding:0;cursor:pointer">
        <span style="flex:1;font-size:15.5px;line-height:1.5;color:${CLR.fg}">Si fra når skytteren jeg følger har ny serie</span>
        <span style="${track}"><span style="${knob}"></span></span>
      </button>
      <p style="margin:12px 0 0;font-size:13px;line-height:1.55;color:${CLR.muted}">${notifyNote}</p>
    </div>
    <p style="margin:6px 0 0;font-size:13px;line-height:1.6;color:${CLR.muted}">ᛇ er eihwaz, barlind — treet buene ble laget av. Den brukes som skilletegn, aldri som pynt.</p>
  </div>`;
}

function vTabBar() {
  const tab = (id, icon, label) =>
    `<button data-action="tab" data-tab="${id}" style="${tabStyle(id)}">${icon}${label}</button>`;
  return `
  <div style="flex:none;display:grid;grid-template-columns:repeat(5,1fr);gap:4px;background:${CLR.fg};border-top:2px solid ${CLR.fg};padding:8px 10px 12px">
    ${tab('klubb', SVG.target, 'Klubben')}
    ${tab('klasser', SVG.list, 'Klasser')}
    ${tab('finale', SVG.medal, 'Finale')}
    ${tab('start', SVG.grid, 'Startliste')}
    ${tab('mer', SVG.dots, 'Mer')}
  </div>`;
}

function vAthleteSheet() {
  const a = state.athlete;
  const cl = (DATA.classes || []).find((c) => c.name === a.cls) || { field: [] };
  const totalArrows = a.totalArrows || cl.totalArrows || 72;
  const live = a.arrows < totalArrows;
  const isFollowing = state.follows.includes(a.name);
  const followBtn = style({ 'margin-left': 'auto', flex: 'none', display: 'inline-flex',
    'align-items': 'center', gap: '7px', 'min-height': '38px', padding: '0 15px',
    'border-radius': '9999px', border: '2px solid ' + CLR.accent,
    background: isFollowing ? CLR.accent : 'transparent',
    color: isFollowing ? CLR.fg : '#fff', font: '700 13.5px "Inter",sans-serif', cursor: 'pointer' });

  const stats = [
    { k: 'Plass', v: `${a.pos}/${(cl.field || []).length}` },
    { k: 'Snitt pr. pil', v: a.arrows ? (a.total / a.arrows).toFixed(2) : '–' },
    { k: '10 + X', v: `${a.tens}+${a.xs}` },
  ].map((s) => `
    <div style="background:#fff;border:2px solid ${CLR.fg};border-radius:16px;padding:12px 11px">
      <span style="display:block;font-family:'Spectral',Georgia,serif;font-weight:600;font-size:24px;line-height:1;color:${CLR.action};font-variant-numeric:tabular-nums">${esc(s.v)}</span>
      <span style="display:block;margin-top:6px;font-size:10.5px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:${CLR.muted}">${esc(s.k)}</span>
    </div>`).join('');

  // Pil-for-pil finnes ikke i ianseos opplastede filer — vis serier hvis de
  // finnes i dataene, ellers sum per distanse.
  let scoreSection;
  if (Array.isArray(a.ends) && a.ends.length) {
    let run = 0;
    const endRows = a.ends.map((end, i) => {
      const sum = end.reduce((x, y) => x + y, 0);
      run += sum;
      const arrows = end.map((v) => `<span style="flex:1;display:grid;place-items:center;height:30px;border-radius:8px;border:2px solid ${v === 10 ? CLR.signal : v === 9 ? CLR.accent : '#d9d4cb'};background:${CLR.surface};font:600 13.5px 'Inter',sans-serif;font-variant-numeric:tabular-nums;color:${v <= 5 ? CLR.muted : CLR.fg}">${v}</span>`).join('');
      return `
      <div style="display:flex;align-items:center;gap:8px;padding:9px 0;border-bottom:2px solid #e8e3da">
        <span style="flex:none;width:20px;font-size:12px;font-weight:600;color:${CLR.muted};font-variant-numeric:tabular-nums">${i + 1}</span>
        <span style="flex:1;display:flex;gap:5px">${arrows}</span>
        <span style="flex:none;width:26px;text-align:right;font-size:14px;font-weight:700;font-variant-numeric:tabular-nums">${sum}</span>
        <span style="flex:none;width:36px;text-align:right;font-size:13px;color:${CLR.muted};font-variant-numeric:tabular-nums">${run}</span>
      </div>`;
    }).join('');
    scoreSection = `
    <p style="margin:0 0 10px;font-size:12.5px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:${CLR.action}">Serie for serie</p>
    <div style="display:flex;flex-direction:column;gap:0">${endRows}</div>`;
  } else {
    const distEntries = Object.entries(a.dist || {});
    const distRows = distEntries.map(([label, val], i) => {
      const m = /^(\d+)\s*\/\s*(\d+)?$/.exec((val || '').trim());
      const score = m ? m[1] : val;
      const distRank = m && m[2] ? `nr. ${m[2]} på distansen` : '';
      return `
      <div style="display:flex;align-items:center;gap:8px;padding:9px 0;border-bottom:2px solid #e8e3da">
        <span style="flex:none;width:20px;font-size:12px;font-weight:600;color:${CLR.muted};font-variant-numeric:tabular-nums">${i + 1}</span>
        <span style="flex:1;display:flex;gap:5px">
          <span style="flex:1;display:grid;place-items:center;height:30px;border-radius:8px;border:2px solid ${CLR.accent};background:${CLR.surface};font:600 13.5px 'Inter',sans-serif;font-variant-numeric:tabular-nums;color:${CLR.fg}">${esc(label)}</span>
        </span>
        <span style="flex:none;width:36px;text-align:right;font-size:14px;font-weight:700;font-variant-numeric:tabular-nums">${esc(score)}</span>
        <span style="flex:none;width:70px;text-align:right;font-size:12px;color:${CLR.muted};font-variant-numeric:tabular-nums">${esc(distRank)}</span>
      </div>`;
    }).join('');
    scoreSection = distEntries.length ? `
    <p style="margin:0 0 10px;font-size:12.5px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:${CLR.action}">Per distanse</p>
    <div style="display:flex;flex-direction:column;gap:0">${distRows}</div>` : '';
  }

  const hasScores = (a.ends && a.ends.length) || Object.keys(a.dist || {}).length > 0;
  const note = hasScores || a.members
    ? (live
      ? `Runden pågår. Nye tall kommer inn ved neste henting fra ianseo — normalt innen fem minutter.`
      : `Hele runden er publisert. Eliminering settes opp når klassen er ferdig.`)
    : `Ingen poeng publisert ennå — mål og pulje er fra startlisten.`;

  const finalsItems = athleteFinalMatches(a.name);
  const finalsSection = finalsItems.length ? `
      <p style="margin:0 0 10px;font-size:12.5px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:${CLR.action}">Finaler og eliminering</p>
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:20px">${finalsItems.map(vMatchCard).join('')}</div>` : '';

  return `
  <div style="position:absolute;inset:0;background:${CLR.paper};display:flex;flex-direction:column;animation:sheet-up .34s cubic-bezier(0.34,1.56,0.64,1)">
    <div style="flex:none;background:${CLR.fg};color:#fff;padding:14px 18px 20px;position:relative;overflow:hidden">
      <div style="position:absolute;right:-52px;top:-30px;width:170px;height:220px;border-radius:50% 50% 16px 16px / 30% 30% 16px 16px;background:#4a5a5b"></div>
      <div style="position:relative;display:flex;align-items:center;gap:12px;margin-bottom:16px">
        <button data-action="close-athlete" style="flex:none;display:grid;place-items:center;width:38px;height:38px;border-radius:9999px;border:2px solid ${CLR.accent};background:transparent;color:#fff;cursor:pointer;padding:0">${SVG.chevronLeft}</button>
        <span style="font-size:11px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:${CLR.border}">${esc(clubMeta(a.club).name)}</span>
        <button data-action="toggle-follow" style="${followBtn}">${isFollowing ? 'Følger ᛇ' : 'Følg'}</button>
      </div>
      <p style="position:relative;margin:0 0 6px;font-family:'Spectral',Georgia,serif;font-weight:600;font-size:27px;line-height:1.14;color:#fff">${esc(a.name)}</p>
      <p style="position:relative;margin:0;font-size:12.5px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:${CLR.accent}">${esc(a.cls)}</p>
      ${a.members ? `<p style="position:relative;margin:6px 0 0;font-size:13px;color:${CLR.border}">${esc(a.members)}</p>` : ''}
      <div style="position:relative;display:flex;align-items:flex-end;gap:18px;margin-top:18px">
        <div><span style="display:block;font-family:'Spectral',Georgia,serif;font-weight:700;font-size:46px;line-height:1;font-variant-numeric:tabular-nums">${a.total || '–'}</span><span style="display:block;margin-top:4px;font-size:12px;color:${CLR.border}">${a.arrows} av ${totalArrows} piler</span></div>
        <div style="margin-left:auto;text-align:right;display:flex;flex-direction:column;gap:7px">
          <span style="${liveStyle(live, true)}">${live ? 'Skyter nå' : 'Ferdig'}</span>
          <span style="font-size:13px;color:${CLR.border}">Mål ${esc(a.target || '–')} · ${esc(a.pool || '')}</span>
        </div>
      </div>
    </div>
    <div style="flex:1;min-height:0;overflow-y:auto;padding:16px 18px 26px">
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin-bottom:20px">${stats}</div>
      ${finalsSection}
      ${scoreSection}
      <p style="margin:14px 0 0;font-size:13px;line-height:1.6;color:${CLR.muted}">${esc(note)}</p>
    </div>
  </div>`;
}

function vClassSheet() {
  const name = state.classView;
  const cl = (DATA.classes || []).find((c) => c.name === name) || { field: [] };
  const totalArrows = cl.totalArrows || 72;
  const waiting = (cl.field || []).filter((f) => f.arrows < totalArrows).length;
  const note = waiting
    ? `${waiting} av ${(cl.field || []).length} skyttere er midt i runden. Rekkefølgen er foreløpig.`
    : 'Hele klassen er ferdig med kvalifiseringen.';
  const rows = (cl.field || []).map((f) => {
    const mine = f.club === state.club;
    const rowSt = style({ display: 'flex', 'align-items': 'center', gap: '10px', width: '100%',
      padding: '11px 4px 11px ' + (mine ? '10px' : '4px'), background: mine ? CLR.surface : 'none',
      border: '0', 'border-bottom': '2px solid #e8e3da',
      'border-left': mine ? '2px solid ' + CLR.accent : '0', cursor: 'pointer' });
    return `
    <button data-action="open-athlete" data-cls="${esc(name)}" data-name="${esc(f.name)}" data-club="${esc(f.club)}" style="${rowSt}">
      <span style="${rankStyle(f.pos, mine)}">${f.pos}</span>
      <span style="flex:1;min-width:0;text-align:left">
        <span style="display:block;font-family:'Spectral',Georgia,serif;font-weight:600;font-size:16px;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.name)}</span>
        <span style="display:block;margin-top:2px;font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:${CLR.muted}">${esc(clubMeta(f.club).name)}</span>
      </span>
      <span style="flex:none;width:46px;text-align:right;font-size:16px;font-weight:700;font-variant-numeric:tabular-nums">${f.total}</span>
      <span style="flex:none;width:34px;text-align:right;font-size:13px;color:${CLR.muted};font-variant-numeric:tabular-nums">${f.tens}+${f.xs}</span>
    </button>`;
  }).join('');
  return `
  <div style="position:absolute;inset:0;background:${CLR.paper};display:flex;flex-direction:column;animation:sheet-up .34s cubic-bezier(0.34,1.56,0.64,1)">
    <div style="flex:none;background:${CLR.fg};color:#fff;padding:14px 18px 16px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <button data-action="close-class" style="flex:none;display:grid;place-items:center;width:38px;height:38px;border-radius:9999px;border:2px solid ${CLR.accent};background:transparent;color:#fff;cursor:pointer;padding:0">${SVG.chevronLeft}</button>
        <span style="font-size:11px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:${CLR.border}">Kvalifisering</span>
      </div>
      <p style="margin:0;font-family:'Spectral',Georgia,serif;font-weight:600;font-size:23px;line-height:1.16">${esc(name)}</p>
    </div>
    <div style="flex:1;min-height:0;overflow-y:auto;padding:14px 18px 26px">
      <div style="display:flex;align-items:center;gap:10px;padding:0 4px 8px;border-bottom:2px solid ${CLR.fg};font-size:11px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:${CLR.muted}">
        <span style="width:34px">Pl.</span><span style="flex:1">Skytter</span><span style="width:46px;text-align:right">Sum</span><span style="width:34px;text-align:right">10+X</span>
      </div>
      ${rows}
      <p style="margin:14px 0 0;font-size:13px;line-height:1.6;color:${CLR.muted}">${esc(note)}</p>
    </div>
  </div>`;
}

/* ---------- finale/brackets ---------- */

const ROUND_NAMES = { '1/16': '1/16-finaler', '1/8': '1/8-finaler', '1/4': 'Kvartfinaler',
  '1/2': 'Semifinaler', Finals: 'Finaler' };

function bracketMine(br) {
  let n = 0;
  for (const r of br.rounds || [])
    for (const m of r.matches)
      for (const p of [m.a, m.b])
        if (p.club === state.club) n++;
  return n;
}

function matchWinner(m) {
  const sa = parseInt(m.a.score), sb = parseInt(m.b.score);
  if (isNaN(sa) || isNaN(sb)) return null;
  if (sa !== sb) return sa > sb ? 'a' : 'b';
  const oa = parseInt(m.a.so), ob = parseInt(m.b.so);
  if (!isNaN(oa) && !isNaN(ob) && oa !== ob) return oa > ob ? 'a' : 'b';
  return null;
}

function fmtWhen(w) {
  const m = /^(\d+)-(\d+)-\d+\s+(.*)$/.exec(w || '');
  return m ? `${parseInt(m[1], 10)}.${parseInt(m[2], 10)} · ${m[3]}` : w;
}

function matchTime(m) {
  const t = /^(\d+)-(\d+)-(\d+)\s+(\d+):(\d+)/.exec(((m.a && m.a.when) || (m.b && m.b.when) || '').trim());
  return t ? new Date(+t[3], +t[2] - 1, +t[1], +t[4], +t[5]).getTime() : null;
}

function matchStatus(m) {
  if (matchWinner(m)) return 'done';
  if ([m.a, m.b].some((p) => p.score || (p.sets || []).length)) return 'live';
  const t = matchTime(m);
  if (t && Date.now() >= t && Date.now() <= t + 30 * 60000) return 'live';
  return 'upcoming';
}

function vSets(p) {
  const sets = p.sets || [];
  if (!sets.length) return '';
  return `<span style="display:block;margin-top:2px;font-size:11.5px;font-weight:600;color:${CLR.muted};font-variant-numeric:tabular-nums;letter-spacing:0.04em">${sets.map(esc).join(' · ')}</span>`;
}

/* Medaljer og finaleplasseringer for valgt klubb, fra Finals-rundene:
 * Finale-vinner = gull, taper = sølv; bronsekamp-vinner = bronse, taper = 4. */
function clubPlacements() {
  const out = [];
  for (const br of DATA.brackets || []) {
    const r = (br.rounds || []).find((x) => x.name === 'Finals');
    if (!r) continue;
    for (const m of r.matches) {
      const w = matchWinner(m);
      if (!w) continue;
      const win = w === 'a' ? m.a : m.b;
      const los = w === 'a' ? m.b : m.a;
      const add = (p, place) => {
        if (p.club === state.club && p.name) {
          const o = p === win ? los : win;
          const res = `${p.score}${p.so ? ` (${p.so})` : ''}–${o.score}${o.so ? ` (${o.so})` : ''}`;
          out.push({ place, name: p.name, cls: br.name, team: br.team, res });
        }
      };
      if (m.label === 'Bronse') { add(win, 3); add(los, 4); }
      else { add(win, 1); add(los, 2); }
    }
  }
  return out.sort((x, y) => x.place - y.place || x.name.localeCompare(y.name));
}

function vMedalSection() {
  const items = clubPlacements();
  if (!items.length) return '';
  const tally = [1, 2, 3].map((p) => items.filter((i) => i.place === p).length);
  const MEDAL_CLR = { 1: '#C4762E', 2: '#9aa5ab', 3: '#8c5a33', 4: '#c9c4bb' };
  const MEDAL_TXT = { 1: 'Gull', 2: 'Sølv', 3: 'Bronse', 4: '4. plass' };
  const tallyHtml = [1, 2, 3].map((p) => `
    <div style="flex:1;text-align:center">
      <span style="display:block;font-family:'Spectral',Georgia,serif;font-weight:700;font-size:32px;line-height:1;color:${tally[p - 1] ? MEDAL_CLR[p] : 'rgba(255,255,255,.35)'};font-variant-numeric:tabular-nums">${tally[p - 1]}</span>
      <span style="display:block;margin-top:5px;font-size:10.5px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:${CLR.border}">${MEDAL_TXT[p]}</span>
    </div>`).join('');
  const rows = items.map((i) => `
    <div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-top:2px solid rgba(221,228,232,.18)">
      <span style="flex:none;display:grid;place-items:center;width:30px;height:30px;border-radius:9999px;border:2px solid ${MEDAL_CLR[i.place]};color:#fff;font-size:13px;font-weight:700;font-variant-numeric:tabular-nums">${i.place}</span>
      <span style="flex:1;min-width:0">
        <span style="display:block;font-size:15px;font-weight:600;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(i.name)}${i.team ? ' (lag)' : ''}</span>
        <span style="display:block;margin-top:2px;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${CLR.border};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(shortCls(i.cls))}</span>
      </span>
      <span style="flex:none;text-align:right">
        <span style="display:block;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${MEDAL_CLR[i.place]}">${MEDAL_TXT[i.place]}</span>
        <span style="display:block;margin-top:2px;font-size:12px;color:${CLR.border};font-variant-numeric:tabular-nums">${esc(i.res)}</span>
      </span>
    </div>`).join('');
  return `
  <div style="background:${CLR.fg};border:2px solid ${CLR.fg};border-radius:24px;padding:18px 18px 12px;overflow:hidden">
    <p style="margin:0 0 12px;font-size:11px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:${CLR.border}">Medaljer og plasseringer</p>
    <div style="display:flex;gap:8px;margin-bottom:10px">${tallyHtml}</div>
    ${rows}
  </div>`;
}

/* Finale-/elimineringskamper: live først, deretter kommende på
 * starttid, og ferdige (nyeste først) i bunnen. */
function sortFinalMatches(out) {
  const rank = { live: 0, upcoming: 1, done: 2 };
  return out.sort((x, y) =>
    rank[x.status] - rank[y.status] ||
    (x.status === 'done' ? (y.t || 0) - (x.t || 0) : (x.t || 9e15) - (y.t || 9e15)));
}

/* Stabil nok kamp-id: bracketkode + rundenavn + indeks i runden. */
function matchId(br, round, idx) {
  return br.code + '|' + round + '|' + idx;
}

function findMatch(id) {
  const [code, round, idx] = String(id || '').split('|');
  const br = (DATA.brackets || []).find((b) => b.code === code);
  if (!br) return null;
  const r = (br.rounds || []).find((x) => x.name === round);
  const m = r && r.matches[+idx];
  return m ? { id, br, round: r.name, m, status: matchStatus(m), t: matchTime(m) } : null;
}

function clubFinalMatches() {
  const out = [];
  for (const br of DATA.brackets || [])
    for (const r of br.rounds || [])
      r.matches.forEach((m, mi) => {
        if ([m.a, m.b].some((p) => p.club === state.club && p.name))
          out.push({ id: matchId(br, r.name, mi), br, round: r.name, m, status: matchStatus(m), t: matchTime(m) });
      });
  return sortFinalMatches(out);
}

/* Kamper der skytteren selv deltar — direkte, eller som medlem av et lag. */
function athleteFinalMatches(name) {
  const norm = (s) => String(s || '').trim().toUpperCase();
  const n = norm(name);
  const hit = (p) => norm(p.name) === n ||
    (p.members || '').split(',').map((s) => norm(s)).includes(n);
  const out = [];
  for (const br of DATA.brackets || [])
    for (const r of br.rounds || [])
      r.matches.forEach((m, mi) => {
        if ([m.a, m.b].some((p) => p.name && hit(p)))
          out.push({ id: matchId(br, r.name, mi), br, round: r.name, m, status: matchStatus(m), t: matchTime(m) });
      });
  return sortFinalMatches(out);
}

/* Kamper brukeren følger, uavhengig av klubb. */
function followedMatchItems() {
  return sortFinalMatches(state.followMatches.map(findMatch).filter(Boolean));
}

function vMatchCard({ id, br, round, m, status }) {
  const winner = matchWinner(m);
  const when = m.a.when || m.b.when;
  const updated = String(br.updated || '').slice(11, 16);
  const followed = state.followMatches.includes(id);
  const row = (p, side) => {
    const won = winner === side;
    const lost = winner && !won;
    return `
    <div style="display:flex;align-items:center;gap:8px;padding:5px 0">
      <span style="flex:1;min-width:0">
        <span style="display:block;font-size:15px;font-weight:${won ? '700' : lost ? '400' : '600'};color:${lost ? CLR.muted : CLR.fg};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name || '–')}</span>
        ${vSets(p)}
      </span>
      <span style="flex:none;min-width:30px;text-align:right;font-size:16px;font-weight:700;font-variant-numeric:tabular-nums;color:${won ? CLR.action : lost ? CLR.muted : CLR.fg}">${p.score ? esc(p.score) + (p.so ? `<span style="font-size:11px;color:${CLR.muted}"> (${esc(p.so)})</span>` : '') : p.target ? `<span style="font-size:12px;font-weight:600;color:${CLR.muted}">T# ${esc(p.target)}</span>` : ''}</span>
    </div>`;
  };
  const badge = status === 'live'
    ? `<span style="flex:none;display:inline-flex;align-items:center;background:${CLR.signal};color:#fff;border:2px solid ${CLR.fg};border-radius:9999px;padding:3px 10px;font:700 10.5px &quot;Inter&quot;,sans-serif;letter-spacing:0.12em;text-transform:uppercase;animation:amber-pulse 2s infinite">Live</span>`
    : status === 'done'
      ? `<span style="flex:none;display:inline-flex;align-items:center;background:transparent;color:${CLR.muted};border:2px solid ${CLR.border};border-radius:9999px;padding:3px 10px;font:600 10.5px &quot;Inter&quot;,sans-serif;letter-spacing:0.12em;text-transform:uppercase">Ferdig</span>`
      : '';
  const roundLabel = m.label ? (m.label === 'Bronse' ? 'Bronsefinale' : m.label) : (ROUND_NAMES[round] || round);
  const meta = [roundLabel, when ? fmtWhen(when) : '', status === 'live' && updated ? `oppdatert ${updated}` : '']
    .filter(Boolean).join(' · ');
  return `
  <button data-action="open-match" data-id="${esc(id)}" style="display:block;width:100%;text-align:left;background:#fff;border:2px solid ${CLR.fg};border-radius:16px;padding:12px 14px;cursor:pointer;box-shadow:4px 4px 0 0 ${status === 'live' ? CLR.signal : CLR.border};${status === 'done' ? 'opacity:0.75;' : ''}">
    <span style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
      ${followed ? `<span style="flex:none;color:${CLR.signal};font-size:14px">ᛇ</span>` : ''}
      <span style="flex:1;min-width:0;font-family:'Spectral',Georgia,serif;font-weight:600;font-size:15.5px;color:${CLR.fg};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(shortCls(br.name))}</span>
      ${badge}
    </span>
    <span style="display:block;margin-bottom:4px;font-size:10.5px;font-weight:${status === 'live' ? '700' : '600'};letter-spacing:0.1em;text-transform:uppercase;color:${status === 'live' ? CLR.signal : CLR.muted}">${esc(meta)}</span>
    ${row(m.a, 'a')}
    <span style="display:block;border-top:2px solid #e8e3da"></span>
    ${row(m.b, 'b')}
  </button>`;
}

function vMatchSheet() {
  const f = findMatch(state.matchView);
  if (!f) return '';
  const { br, round, m, status } = f;
  const winner = matchWinner(m);
  const when = m.a.when || m.b.when;
  const updated = String(br.updated || '').slice(11, 16);
  const isFollowing = state.followMatches.includes(state.matchView);
  const followBtn = style({ 'margin-left': 'auto', flex: 'none', display: 'inline-flex',
    'align-items': 'center', gap: '7px', 'min-height': '38px', padding: '0 15px',
    'border-radius': '9999px', border: '2px solid ' + CLR.accent,
    background: isFollowing ? CLR.accent : 'transparent',
    color: isFollowing ? CLR.fg : '#fff', font: '700 13.5px "Inter",sans-serif', cursor: 'pointer' });
  const roundLabel = m.label ? (m.label === 'Bronse' ? 'Bronsefinale' : m.label) : (ROUND_NAMES[round] || round);
  const meta = [roundLabel, when ? fmtWhen(when) : '', m.a.target ? `T# ${m.a.target}–${m.b.target}` : '']
    .filter(Boolean).join(' · ');
  const statusLine = status === 'live'
    ? `<span style="${liveStyle(true, false)};animation:amber-pulse 2s infinite">Live</span><span style="font-size:12.5px;color:${CLR.muted}">oppdateres automatisk${updated ? ` · sist ${updated}` : ''}</span>`
    : status === 'done'
      ? `<span style="${liveStyle(false, false)}">Ferdig</span>${winner ? `<span style="font-size:13px;font-weight:700;color:${CLR.action}">Vinner: ${esc((winner === 'a' ? m.a : m.b).name)}</span>` : ''}`
      : `<span style="${liveStyle(false, false)}">Venter</span><span style="font-size:12.5px;color:${CLR.muted}">${when ? 'Starter ' + esc(fmtWhen(when)) : 'Ikke startet ennå'}</span>`;
  const prow = (p, side) => {
    const won = winner === side;
    const lost = winner && !won;
    return `
    <div style="display:flex;align-items:center;gap:12px;padding:14px 4px">
      <span style="flex:1;min-width:0">
        <span style="display:block;font-family:'Spectral',Georgia,serif;font-weight:600;font-size:19px;line-height:1.2;color:${lost ? CLR.muted : CLR.fg};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name || '–')}</span>
        ${p.club && !br.team ? `<span style="display:block;margin-top:3px;font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:${CLR.muted}">${esc(clubMeta(p.club).name || p.club)}</span>` : ''}
        ${p.members ? `<span style="display:block;margin-top:3px;font-size:12px;color:${CLR.muted}">${esc(p.members)}</span>` : ''}
      </span>
      <span style="flex:none;font-family:'Spectral',Georgia,serif;font-weight:700;font-size:38px;line-height:1;font-variant-numeric:tabular-nums;color:${won ? CLR.action : lost ? CLR.muted : CLR.fg}">${p.score ? esc(p.score) : '–'}${p.so ? `<span style="font-size:15px;color:${CLR.muted}"> (${esc(p.so)})</span>` : ''}</span>
    </div>`;
  };
  // sett-for-sett: én rad per ende, vinneren av enden i uthevet skrift
  const nSets = Math.max((m.a.sets || []).length, (m.b.sets || []).length);
  let setTable = '';
  if (nSets) {
    const rows = [];
    for (let i = 0; i < nSets; i++) {
      const av = (m.a.sets || [])[i], bv = (m.b.sets || [])[i];
      const aWon = av !== undefined && bv !== undefined && parseInt(av) > parseInt(bv);
      const bWon = av !== undefined && bv !== undefined && parseInt(bv) > parseInt(av);
      rows.push(`
      <div style="display:flex;align-items:center;gap:8px;padding:7px 4px;border-bottom:2px solid #e8e3da">
        <span style="flex:1;text-align:right;font-size:15px;font-weight:${aWon ? '800' : '500'};font-variant-numeric:tabular-nums;color:${aWon ? CLR.fg : CLR.muted}">${av !== undefined ? esc(av) : '–'}</span>
        <span style="flex:none;width:52px;text-align:center;white-space:nowrap;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${CLR.muted}">ende ${i + 1}</span>
        <span style="flex:1;text-align:left;font-size:15px;font-weight:${bWon ? '800' : '500'};font-variant-numeric:tabular-nums;color:${bWon ? CLR.fg : CLR.muted}">${bv !== undefined ? esc(bv) : '–'}</span>
      </div>`);
    }
    setTable = `
    <p style="margin:20px 0 8px;font-size:12.5px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:${CLR.action}">Sett for sett</p>
    <div style="background:#fff;border:2px solid ${CLR.fg};border-radius:16px;padding:6px 12px">
      <div style="display:flex;gap:8px;padding:7px 4px;border-bottom:2px solid ${CLR.fg};font-size:10.5px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${CLR.muted}">
        <span style="flex:1;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(m.a.name || '–')}</span>
        <span style="flex:none;width:52px"></span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(m.b.name || '–')}</span>
      </div>
      ${rows.join('')}
    </div>`;
  }
  return `
  <div style="position:absolute;inset:0;background:${CLR.paper};display:flex;flex-direction:column;animation:sheet-up .34s cubic-bezier(0.34,1.56,0.64,1)">
    <div style="flex:none;background:${CLR.fg};color:#fff;padding:14px 18px 16px">
      <div style="position:relative;display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <button data-action="close-match" style="flex:none;display:grid;place-items:center;width:38px;height:38px;border-radius:9999px;border:2px solid ${CLR.accent};background:transparent;color:#fff;cursor:pointer;padding:0">${SVG.chevronLeft}</button>
        <span style="font-size:11px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:${CLR.border}">Eliminering</span>
        <button data-action="toggle-follow-match" style="${followBtn}">${isFollowing ? 'Følger ᛇ' : 'Følg'}</button>
      </div>
      <p style="margin:0;font-family:'Spectral',Georgia,serif;font-weight:600;font-size:23px;line-height:1.16">${esc(br.name)}</p>
      <p style="margin:6px 0 0;font-size:12px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:${CLR.accent}">${esc(meta)}</p>
    </div>
    <div style="flex:1;min-height:0;overflow-y:auto;padding:16px 18px 26px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">${statusLine}</div>
      <div style="background:#fff;border:2px solid ${CLR.fg};border-radius:16px;padding:4px 14px;box-shadow:4px 4px 0 0 ${status === 'live' ? CLR.signal : CLR.border}">
        ${prow(m.a, 'a')}
        <div style="border-top:2px solid #e8e3da"></div>
        ${prow(m.b, 'b')}
      </div>
      ${setTable}
      <button data-action="open-match-bracket" data-code="${esc(br.code)}" style="display:inline-flex;align-items:center;gap:9px;margin-top:20px;background:${CLR.action};color:#fff;border:2px solid ${CLR.fg};border-radius:9999px;padding:12px 22px;min-height:48px;font-size:15px;font-weight:700;cursor:pointer;box-shadow:4px 4px 0 0 ${CLR.fg}">Hele bracket-treet${SVG.arrowRight}</button>
    </div>
  </div>`;
}

function vFinalsSection() {
  const items = clubFinalMatches().filter((x) => !state.followMatches.includes(x.id));
  if (!items.length) return '';
  return `
  <div>
    <p style="margin:0 0 12px;font-size:12.5px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:${CLR.action}">Finaler og eliminering</p>
    <div style="display:flex;flex-direction:column;gap:10px">${items.map(vMatchCard).join('')}</div>
  </div>`;
}

/* Fulgte kamper øverst på klubbforsiden — også kamper uten klubbtilknytning. */
function vFollowedMatches() {
  const items = followedMatchItems();
  if (!items.length) return '';
  return `
  <div>
    <p style="margin:0 0 12px;font-size:12.5px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:${CLR.action}">Fulgte kamper</p>
    <div style="display:flex;flex-direction:column;gap:10px">${items.map(vMatchCard).join('')}</div>
  </div>`;
}

function vTabFinale() {
  const brackets = (DATA.brackets || [])
    .map((br) => ({ br, mine: bracketMine(br) }))
    .sort((x, y) => (y.mine > 0) - (x.mine > 0) || String(y.br.updated).localeCompare(String(x.br.updated)));
  const items = brackets.map(({ br, mine }) => {
    const nMatches = (br.rounds || []).reduce((n, r) => n + r.matches.length, 0);
    const badge = style({ flex: 'none', display: 'grid', 'place-items': 'center', 'min-width': '42px',
      height: '32px', padding: '0 9px', 'border-radius': '9999px',
      border: '2px solid ' + (mine ? CLR.accent : CLR.border),
      font: '700 13px "Inter",sans-serif', 'font-variant-numeric': 'tabular-nums', color: CLR.fg });
    return `
    <button data-action="open-bracket" data-code="${esc(br.code)}" style="display:flex;align-items:center;gap:13px;width:100%;text-align:left;background:#fff;border:2px solid ${CLR.fg};border-radius:16px;padding:14px 15px;cursor:pointer;box-shadow:4px 4px 0 0 ${CLR.border}">
      <span style="flex:1;min-width:0">
        <span style="display:block;font-family:'Spectral',Georgia,serif;font-weight:600;font-size:17px;line-height:1.2;color:${CLR.fg}">${esc(br.name)}</span>
        <span style="display:block;margin-top:4px;font-size:12.5px;color:${CLR.muted}">${nMatches} ${nMatches === 1 ? 'kamp' : 'kamper'}${mine ? ` · ${mine} fra ${esc(state.club)}` : ''}</span>
      </span>
      ${mine ? `<span style="${badge}">${mine}</span>` : ''}
      ${SVG.chevronRight}
    </button>`;
  }).join('');
  return `
  <div>
    <p style="margin:0 0 12px;font-size:12.5px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:${CLR.action}">Eliminering og finaler</p>
    <div style="display:flex;flex-direction:column;gap:10px">
      ${items || '<p style="font-size:14px;color:' + CLR.muted + '">Ingen brackets publisert ennå.</p>'}
    </div>
  </div>`;
}

function vBracketSheet() {
  const br = (DATA.brackets || []).find((b) => b.code === state.bracketView) || { rounds: [] };
  const sections = (br.rounds || []).map((r) => {
    const cards = r.matches.map((m, mi) => {
      const winner = matchWinner(m);
      const mine = [m.a, m.b].some((p) => p.club === state.club);
      const when = m.a.when || m.b.when;
      const row = (p, side) => {
        const won = winner === side;
        const lost = winner && !won;
        return `
        <div style="display:flex;align-items:center;gap:8px;padding:8px 0">
          <span style="flex:1;min-width:0">
            <span style="display:block;font-size:15px;font-weight:${won ? '700' : lost ? '400' : '600'};color:${lost ? CLR.muted : CLR.fg};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name || '–')}</span>
            ${vSets(p)}
          </span>
          ${!br.team && p.club ? `<span style="flex:none;font-size:11px;font-weight:600;letter-spacing:0.08em;color:${CLR.muted}">${esc(p.club)}</span>` : ''}
          <span style="flex:none;min-width:30px;text-align:right;font-size:16px;font-weight:700;font-variant-numeric:tabular-nums;color:${won ? CLR.action : lost ? CLR.muted : CLR.fg}">${p.score ? esc(p.score) + (p.so ? `<span style="font-size:11px;color:${CLR.muted}"> (${esc(p.so)})</span>` : '') : p.target ? `<span style="font-size:12px;font-weight:600;color:${CLR.muted}">T# ${esc(p.target)}</span>` : ''}</span>
        </div>`;
      };
      return `
      <button data-action="open-match" data-id="${esc(matchId(br, r.name, mi))}" style="display:block;width:100%;text-align:left;background:${mine ? CLR.surface : '#fff'};border:2px solid ${CLR.fg};border-radius:14px;padding:8px 12px;cursor:pointer;${mine ? 'border-left:6px solid ' + CLR.accent + ';' : ''}">
        ${m.label ? `<p style="margin:2px 0 0;font-size:10.5px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${CLR.action}">${esc(m.label === 'Bronse' ? 'Bronsefinale' : m.label)}${when ? ` · ${esc(fmtWhen(when))}` : ''}</p>` : when ? `<p style="margin:2px 0 0;font-size:10.5px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:${CLR.muted}">${esc(fmtWhen(when))}</p>` : ''}
        ${row(m.a, 'a')}
        <div style="border-top:2px solid #e8e3da"></div>
        ${row(m.b, 'b')}
      </button>`;
    }).join('');
    return `
    <p style="margin:18px 0 8px;font-size:12.5px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:${CLR.action}">${esc(ROUND_NAMES[r.name] || r.name)}</p>
    <div style="display:flex;flex-direction:column;gap:8px">${cards}</div>`;
  }).join('');
  return `
  <div style="position:absolute;inset:0;background:${CLR.paper};display:flex;flex-direction:column;animation:sheet-up .34s cubic-bezier(0.34,1.56,0.64,1)">
    <div style="flex:none;background:${CLR.fg};color:#fff;padding:14px 18px 16px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <button data-action="close-bracket" style="flex:none;display:grid;place-items:center;width:38px;height:38px;border-radius:9999px;border:2px solid ${CLR.accent};background:transparent;color:#fff;cursor:pointer;padding:0">${SVG.chevronLeft}</button>
        <span style="font-size:11px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:${CLR.border}">Eliminering</span>
      </div>
      <p style="margin:0;font-family:'Spectral',Georgia,serif;font-weight:600;font-size:23px;line-height:1.16">${esc(br.name || '')}</p>
    </div>
    <div style="flex:1;min-height:0;overflow-y:auto;padding:14px 18px 26px">${sections}</div>
  </div>`;
}

function vPickerList() {
  const q = state.search.trim().toLowerCase();
  return (DATA.clubs || [])
    .filter((c) => !q || (c.short + ' ' + c.name).toLowerCase().includes(q))
    .map((c) => {
      const on = c.short === state.club;
      const st = style({ display: 'flex', 'align-items': 'center', gap: '10px', width: '100%',
        padding: '13px 12px', background: on ? CLR.surface : 'none',
        border: '2px solid ' + (on ? CLR.fg : 'transparent'), 'border-radius': '14px', cursor: 'pointer' });
      const count = ((DATA.roster || {})[c.short] || []).length;
      return `
      <button data-action="pick-club" data-short="${esc(c.short)}" style="${st}">
        <span style="flex:none;font-size:12px;font-weight:700;letter-spacing:0.08em;color:${CLR.action};width:52px;text-align:left">${esc(c.short)}</span>
        <span style="flex:1;min-width:0;text-align:left;font-size:14.5px;line-height:1.35;color:${CLR.fg}">${esc(c.name)}</span>
        <span style="flex:none;font-size:12.5px;color:${CLR.muted};font-variant-numeric:tabular-nums">${count}</span>
      </button>`;
    }).join('');
}

function vPicker() {
  return `
  <div style="position:absolute;inset:0;background:rgba(6,48,63,.55);display:flex;flex-direction:column;justify-content:flex-end">
    <div style="background:${CLR.paper};border-top:2px solid ${CLR.fg};border-radius:24px 24px 0 0;max-height:82%;display:flex;flex-direction:column;animation:sheet-up .3s cubic-bezier(0.34,1.56,0.64,1)">
      <div style="flex:none;padding:16px 18px 12px;border-bottom:2px solid ${CLR.fg}">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
          <p style="margin:0;font-size:12.5px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:${CLR.action}">Velg klubb · ${(DATA.clubs || []).length} påmeldte</p>
          <button data-action="close-picker" style="margin-left:auto;flex:none;display:grid;place-items:center;width:36px;height:36px;border-radius:9999px;border:2px solid ${CLR.fg};background:#fff;color:${CLR.fg};cursor:pointer;padding:0">${SVG.close}</button>
        </div>
        <input id="club-search" value="${esc(state.search)}" placeholder="Søk klubb" style="width:100%;box-sizing:border-box;font-family:'Inter',sans-serif;font-size:16px;color:${CLR.fg};background:#fff;border:2px solid ${CLR.fg};border-radius:16px;padding:12px 14px;min-height:48px">
      </div>
      <div id="club-list" style="flex:1;min-height:0;overflow-y:auto;padding:6px 18px 22px">${vPickerList()}</div>
    </div>
  </div>`;
}

/* ---------- render ---------- */

function render() {
  const tabView = { klubb: vTabKlubb, klasser: vTabKlasser, finale: vTabFinale, start: vTabStart, mer: vTabMer }[state.tab];
  const sheets = (state.matchView ? vMatchSheet() : '') +
    (state.athlete ? vAthleteSheet() : '') +
    (!state.athlete && state.classView ? vClassSheet() : '') +
    (!state.athlete && !state.classView && state.bracketView ? vBracketSheet() : '') +
    (state.picker ? vPicker() : '');
  document.getElementById('frame').innerHTML =
    vHeader() + vStrip() +
    `<div style="flex:1;min-height:0;overflow-y:auto;padding:18px 18px 26px">${tabView()}</div>` +
    vTabBar() + sheets;
}

/* ---------- tilstand ---------- */

function setState(patch) {
  Object.assign(state, patch);
  render();
}

function openAthlete(cls, name, club) {
  const cl = (DATA.classes || []).find((c) => c.name === cls);
  const f = cl && (cl.field || []).find((x) => x.name === name && (!club || x.club === club));
  if (f) {
    setState({ athlete: Object.assign({ cls: cls, totalArrows: cl.totalArrows || 72 }, f), classView: null });
    return;
  }
  // utøver uten publiserte poeng — vis info fra startlisten
  const r = ((DATA.roster || {})[state.club] || []).find((x) => x.name === name);
  if (r) {
    setState({
      athlete: { cls: r.class, name: r.name, club: state.club, pos: 0, total: 0, arrows: 0,
        tens: 0, xs: 0, target: r.target, pool: r.pool, dist: {}, totalArrows: 72 },
      classView: null,
    });
  }
}

async function loadData() {
  const r = await fetch(`${DATA_URL}?_=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  DATA = await r.json();
  if (!state.club || !(DATA.clubs || []).some((c) => c.short === state.club)) {
    state.club = DATA.defaultClub || ((DATA.clubs || [])[0] || {}).short || null;
  }
}

async function refreshData() {
  if (state.refreshing) return;
  setState({ refreshing: true });
  try { await loadData(); } catch { /* behold gamle data */ }
  setState({ refreshing: false });
}

/* ---------- hendelser ---------- */

document.getElementById('frame').addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  if (a === 'tab') setState({ tab: el.dataset.tab });
  else if (a === 'go-start') setState({ tab: 'start' });
  else if (a === 'open-picker') setState({ picker: true });
  else if (a === 'close-picker') setState({ picker: false, search: '' });
  else if (a === 'pick-club') {
    store.set('ianseolive-club', el.dataset.short);
    setState({ club: el.dataset.short, picker: false, search: '', athlete: null, classView: null });
  }
  else if (a === 'open-athlete') openAthlete(el.dataset.cls, el.dataset.name, el.dataset.club);
  else if (a === 'close-athlete') setState({ athlete: null });
  else if (a === 'open-class') setState({ classView: el.dataset.cls });
  else if (a === 'close-class') setState({ classView: null });
  else if (a === 'open-bracket') setState({ bracketView: el.dataset.code });
  else if (a === 'close-bracket') setState({ bracketView: null });
  else if (a === 'open-match') setState({ matchView: el.dataset.id });
  else if (a === 'close-match') setState({ matchView: null });
  else if (a === 'open-match-bracket') setState({ bracketView: el.dataset.code, matchView: null });
  else if (a === 'toggle-follow-match') {
    const id = state.matchView;
    if (!id) return;
    state.followMatches = state.followMatches.includes(id)
      ? state.followMatches.filter((x) => x !== id)
      : state.followMatches.concat(id);
    store.set('ianseolive-follow-matches', state.followMatches);
    render();
  }
  else if (a === 'toggle-follow') {
    const n = state.athlete && state.athlete.name;
    if (!n) return;
    state.follows = state.follows.includes(n)
      ? state.follows.filter((x) => x !== n)
      : state.follows.concat(n);
    store.set('ianseolive-follows', state.follows);
    render();
  }
  else if (a === 'toggle-notify') {
    state.notify = !state.notify;
    store.set('ianseolive-notify', state.notify);
    render();
  }
});

// søk i klubbvelgeren uten full re-render (beholder fokus)
document.getElementById('frame').addEventListener('input', (e) => {
  if (e.target.id !== 'club-search') return;
  state.search = e.target.value;
  document.getElementById('club-list').innerHTML = vPickerList();
});

/* ---------- oppstart ---------- */

(async function boot() {
  const caption = document.getElementById('caption-bottom');
  try {
    await loadData();
  } catch (err) {
    document.getElementById('frame').innerHTML =
      `<div style="padding:24px;font-size:15px;line-height:1.6;color:${CLR.muted}">Kunne ikke laste data (${esc(err.message)}). Polleren har kanskje ikke kjørt ennå.</div>`;
    return;
  }
  const t = DATA.tournament || {};
  caption.innerHTML = `Data fra <a href="${esc(t.detailsUrl || '#')}" target="_blank" rel="noopener">ianseo toId ${esc(t.toId || '28659')}</a> — hentes hvert 5. minutt mens stevnet pågår.`;
  render();
  setInterval(render, TICK_MS);
  setInterval(refreshData, REFRESH_DATA_MS);
})();
