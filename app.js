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
  picker: false,
  search: '',
  refreshing: false,
  follows: store.get('ianseolive-follows', []),
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
        out.push(Object.assign({ cls: c.name, totalArrows: c.totalArrows || 72 }, f));
  return out.sort((a, b) => a.pos - b.pos || b.total - a.total);
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
  const nextText = state.refreshing ? '' : age >= 10 ? 'neste snart' : `neste om ${Math.max(1, 10 - age)} min`;
  const bar = style({ display: 'block', height: '100%', width: Math.min(100, age * 10) + '%',
    background: age >= 9 ? CLR.signal : CLR.action, transition: 'width .4s ease-out' });
  const spin = style({ display: 'grid', 'place-items': 'center',
    animation: state.refreshing ? 'spin .9s linear infinite' : 'none' });
  return `
  <div style="flex:none;background:#fff;border-bottom:2px solid ${CLR.fg};padding:9px 18px 10px">
    <div style="display:flex;align-items:center;gap:9px">
      <span style="flex:none;width:10px;height:10px;border-radius:50%;background:${CLR.signal};border:2px solid ${CLR.fg};animation:amber-pulse 2.6s ease-out infinite"></span>
      <span style="font-size:13px;font-weight:600;color:${CLR.fg};white-space:nowrap">${esc(updatedText)}</span>
      <span style="font-size:12px;color:${CLR.muted};margin-left:auto;white-space:nowrap">${esc(nextText)}</span>
      <button data-action="refresh" style="flex:none;display:grid;place-items:center;width:34px;height:34px;border-radius:9999px;border:2px solid ${CLR.fg};background:${CLR.paper};color:${CLR.action};cursor:pointer;padding:0"><span style="${spin}">${SVG.refresh}</span></button>
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
    ${cards}
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
  const rowsRaw = clubRows();
  const names = [...new Set(rowsRaw.map((r) => r.cls))];
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
  <div style="flex:none;display:grid;grid-template-columns:repeat(4,1fr);gap:4px;background:${CLR.fg};border-top:2px solid ${CLR.fg};padding:8px 10px 12px">
    ${tab('klubb', SVG.target, 'Klubben')}
    ${tab('klasser', SVG.list, 'Klasser')}
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
  const note = hasScores
    ? (live
      ? `Runden pågår. Nye tall kommer inn ved neste henting fra ianseo — normalt innen ti minutter.`
      : `Hele runden er publisert. Eliminering settes opp når klassen er ferdig.`)
    : `Ingen poeng publisert ennå — mål og pulje er fra startlisten.`;

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
    <button data-action="open-athlete" data-cls="${esc(name)}" data-name="${esc(f.name)}" style="${rowSt}">
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
  const tabView = { klubb: vTabKlubb, klasser: vTabKlasser, start: vTabStart, mer: vTabMer }[state.tab];
  const sheets = (state.athlete ? vAthleteSheet() : '') +
    (!state.athlete && state.classView ? vClassSheet() : '') +
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

function openAthlete(cls, name) {
  const cl = (DATA.classes || []).find((c) => c.name === cls);
  const f = cl && (cl.field || []).find((x) => x.name === name);
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
  else if (a === 'open-athlete') openAthlete(el.dataset.cls, el.dataset.name);
  else if (a === 'close-athlete') setState({ athlete: null });
  else if (a === 'open-class') setState({ classView: el.dataset.cls });
  else if (a === 'close-class') setState({ classView: null });
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
  else if (a === 'refresh') refreshData();
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
  caption.innerHTML = `Data fra <a href="${esc(t.detailsUrl || '#')}" target="_blank" rel="noopener">ianseo toId ${esc(t.toId || '28659')}</a> — hentes hvert 10. minutt mens stevnet pågår.`;
  render();
  setInterval(render, TICK_MS);
  setInterval(refreshData, REFRESH_DATA_MS);
})();
