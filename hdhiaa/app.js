/* HDH-IAA Live — underside for hdhiaa.net-stevner (ikke ianseo/WA).
 * Leser data/hdhiaa.json (produsert av poller/hdhiaa_poll.py) og tegner
 * appen i #frame. Samme designspråk og sorteringslogikk som hovedsiden:
 * land-picker i stedet for klubb-picker, ferskest aktivitet øverst.
 * Vanilla JS, ingen avhengigheter.
 */

const CLR = {
  fg: '#06303F', paper: '#F8F6F2', surface: '#fff', muted: '#6E6A63',
  border: '#DDE4E8', accent: '#00AEDA', action: '#00789B', signal: '#C4762E',
};

const DATA_URL = new URLSearchParams(location.search).get('data') || '../data/hdhiaa.json';
const REFRESH_DATA_MS = 120_000; // henter hdhiaa.json på nytt
const TICK_MS = 30_000;          // oppdaterer «oppdatert X min siden»

let DATA = { competition: {}, countries: [], categories: [], generated: '' };

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* privat modus */ } },
};

const state = {
  country: store.get('ianseolive-hdhiaa-country', null),
  catView: null,   // tittel på åpen klasse-sheet
  picker: false,
  search: '',
  refreshing: false,
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const style = (o) => Object.entries(o).map(([k, v]) =>
  k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()) + ':' + v).join(';');

/* ---------- data-logikk ---------- */

const ALL_COUNTRIES = 'ALLE';      // pseudo-land: vis alt uten landsfilter
const allCountries = () => state.country === ALL_COUNTRIES;

function countryMeta(code) {
  if (code === ALL_COUNTRIES) return { code, name: 'Alle land', athletes: 0 };
  return (DATA.countries || []).find((c) => c.code === code) || { code, name: code, athletes: 0 };
}

// Klasser sortert på fersk aktivitet — de med nyest data øverst
function sortedCategories() {
  return [...(DATA.categories || [])].sort((a, b) =>
    String(b.updated).localeCompare(String(a.updated)) || a.title.localeCompare(b.title));
}

function catRows(cat) {
  const rows = (cat.results || []).filter((r) => allCountries() || r.country === state.country);
  // «Alle land» viser kun de med score; et valgt land viser også de som ikke har startet
  return allCountries() ? rows.filter((r) => r.scored) : rows;
}

// pallposisjoner (pos 1–3 blant de som har score) for valgt land
function podiumRows() {
  const out = [];
  for (const c of DATA.categories || [])
    for (const r of c.results || [])
      if (r.scored && r.pos >= 1 && r.pos <= 3 && (allCountries() || r.country === state.country))
        out.push(Object.assign({ cat: c }, r));
  return out.sort((a, b) => a.pos - b.pos || a.cat.title.localeCompare(b.cat.title));
}

function medalTable() {
  const t = {};
  for (const c of DATA.categories || [])
    for (const r of c.results || [])
      if (r.scored && r.pos >= 1 && r.pos <= 3) {
        const e = t[r.country] || (t[r.country] = { code: r.country, name: r.countryName, g: 0, s: 0, b: 0 });
        if (r.pos === 1) e.g++; else if (r.pos === 2) e.s++; else e.b++;
      }
  return Object.values(t).sort((a, b) => b.g - a.g || b.s - a.s || b.b - a.b || a.name.localeCompare(b.name));
}

function eventOver() {
  const end = Date.parse(DATA.competition.endDate || '');
  return !isNaN(end) && Date.now() > end + 36e5 * 20; // dagen etter siste stevnedag
}

function ageMin() {
  const gen = Date.parse(DATA.generated || '');
  if (isNaN(gen)) return 0;
  return Math.max(0, Math.floor((Date.now() - gen) / 60000));
}

function shortCat(title) {
  const m = String(title || '').match(/^(.+?\([^)]+\))\s+—\s+(.+?)\s+—\s+(Male|Female)$/);
  if (!m) return title;
  const age = m[2].replace(' (55 years of age or older)', ' 55+')
    .replace(' (21-54 years)', '').replace(' (18-20 years)', ' 18–20')
    .replace(' (15-17 years)', '').replace(' (13-14 years)', '').replace(' (10-12 years)', '');
  return `${m[1]} · ${age} · ${m[3] === 'Male' ? 'Herrer' : 'Damer'}`;
}

function fmtDateRange() {
  const c = DATA.competition || {};
  const s = Date.parse(c.startDate || ''), e = Date.parse(c.endDate || '');
  if (isNaN(s) || isNaN(e)) return '';
  const mn = ['januar','februar','mars','april','mai','juni','juli','august','september','oktober','november','desember'];
  const ds = new Date(s), de = new Date(e);
  const same = ds.getMonth() === de.getMonth();
  return `${ds.getDate()}.–${de.getDate()}. ${mn[de.getMonth()]} ${de.getFullYear()}` +
    (same ? '' : ` (${mn[ds.getMonth()]}–${mn[de.getMonth()]})`);
}

/* ---------- stil-hjelpere (samme idiom som hovedappen) ---------- */

function rankStyle(pos, mine) {
  const ring = pos === 1 ? CLR.signal : pos <= 3 ? CLR.accent : '#c9c4bb';
  return style({
    flex: 'none', display: 'grid', 'place-items': 'center', width: '34px', height: '34px',
    'border-radius': '9999px', border: '2px solid ' + ring, background: mine ? CLR.paper : 'transparent',
    font: '600 14px "Inter",sans-serif', 'font-variant-numeric': 'tabular-nums',
    color: pos <= 3 ? CLR.fg : CLR.muted,
  });
}

function chipStyle(on) {
  return style({ display: 'inline-flex', 'align-items': 'center', gap: '6px', padding: '7px 12px',
    'border-radius': '9999px', border: '2px solid ' + (on ? CLR.fg : CLR.border),
    background: on ? CLR.accent : CLR.surface, color: CLR.fg,
    font: '600 12.5px "Inter",sans-serif', cursor: 'pointer' });
}

const SVG = {
  chevronDown: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="m6 9 6 6 6-6"/></svg>',
  chevronRight: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#00789B" stroke-width="2.5" stroke-linecap="round" style="flex:none"><path d="m9 6 6 6-6 6"/></svg>',
  chevronLeft: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="m15 18-6-6 6-6"/></svg>',
  close: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  globe: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.9 5.7 3.9 9S14.5 18.4 12 21c-2.5-2.6-3.9-5.7-3.9-9S9.5 5.6 12 3Z"/></svg>',
  trophy: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8m-4-4v4M7 4h10v6a5 5 0 0 1-10 0V4Z"/><path d="M7 6H4a1 1 0 0 0-1 1c0 2.2 1.8 4 4 4m10-6h3a1 1 0 0 1 1 1c0 2.2-1.8 4-4 4"/></svg>',
};

/* ---------- views ---------- */

function vHeader() {
  const c = DATA.competition || {};
  const meta = countryMeta(state.country || DATA.defaultCountry);
  return `<header style="${style({ background: CLR.fg, color: CLR.paper, padding: '18px 18px 16px',
    'border-bottom': '2px solid ' + CLR.fg })}">
    <div style="${style({ display: 'flex', 'justify-content': 'space-between', 'align-items': 'center', gap: '8px' })}">
      <a href="../" style="${style({ display: 'inline-flex', 'align-items': 'center', gap: '4px', color: CLR.border,
        font: '600 12px "Inter",sans-serif', 'text-decoration': 'none' })}">${SVG.chevronLeft} Ianseolive</a>
      <span style="${style({ font: '600 10.5px "Inter",sans-serif', 'letter-spacing': '0.12em',
        'text-transform': 'uppercase', color: CLR.accent })}">HDH-IAA · 3D</span>
    </div>
    <h1 style="${style({ margin: '10px 0 2px', font: '700 21px "Spectral",serif', 'line-height': '1.2' })}">${esc(c.name || 'HDH-IAA')}</h1>
    <p style="${style({ margin: '0 0 12px', font: '400 12.5px "Inter",sans-serif', color: CLR.border })}">
      ${esc(fmtDateRange())}${c.location ? ' · ' + esc(c.location.split(',')[1] ? c.location.split(',').slice(-2).join(',').trim() : c.location) : ''}</p>
    <button data-action="picker" style="${chipStyle(false)};${style({ background: 'transparent', color: CLR.paper,
      border: '2px solid ' + CLR.accent, width: '100%', 'justify-content': 'space-between' })}">
      <span style="${style({ display: 'inline-flex', 'align-items': 'center', gap: '7px' })}">${SVG.globe}
        <strong>${esc(meta.code)}</strong>&nbsp;${esc(meta.name)}</span>
      ${SVG.chevronDown}
    </button>
  </header>`;
}

function vSummary() {
  const podium = podiumRows();
  const athletes = allCountries()
    ? (DATA.countries || []).reduce((n, c) => n + c.athletes, 0)
    : countryMeta(state.country).athletes;
  const g = podium.filter((r) => r.pos === 1).length;
  const s = podium.filter((r) => r.pos === 2).length;
  const b = podium.filter((r) => r.pos === 3).length;
  const label = eventOver() ? 'Medaljer' : 'Pallposisjoner nå';
  const medal = (n, col, txt) => `<span style="${style({ display: 'inline-flex', 'align-items': 'center',
      gap: '5px', marginRight: '12px', font: '600 13px "Inter",sans-serif', color: CLR.fg })}">
    <span style="${style({ width: '12px', height: '12px', 'border-radius': '9999px', background: col, display: 'inline-block' })}"></span>${n} ${txt}</span>`;
  return `<section style="${style({ padding: '14px 18px', background: CLR.surface, 'border-bottom': '2px solid ' + CLR.fg })}">
    <div style="${style({ display: 'flex', 'justify-content': 'space-between', 'align-items': 'baseline' })}">
      <h2 style="${style({ margin: 0, font: '700 15px "Spectral",serif' })}">${SVG.trophy} ${label}</h2>
      <span style="${style({ font: '400 12px "Inter",sans-serif', color: CLR.muted })}">${athletes} utøvere</span>
    </div>
    <p style="${style({ margin: '8px 0 0' })}">${medal(g, '#E3B23C', 'gull')}${medal(s, '#B9C4C9', 'sølv')}${medal(b, CLR.signal, 'bronse')}</p>
  </section>`;
}

function vAvatar(r, size) {
  const ini = esc(r.name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase());
  const base = { width: size + 'px', height: size + 'px', 'border-radius': '9999px', flex: 'none' };
  const fb = `<span style="${style(Object.assign({}, base, { display: 'grid', 'place-items': 'center',
    background: CLR.border, font: '600 11px "Inter",sans-serif', color: CLR.fg }))}">${ini}</span>`;
  if (!r.photo) return fb;
  return `<span style="${style(Object.assign({}, base, { position: 'relative', display: 'inline-block' }))}">${fb}<img
    src="${esc(r.photo)}" loading="lazy" alt="" onerror="this.remove()"
    style="${style({ position: 'absolute', inset: '0', width: '100%', height: '100%',
      'object-fit': 'cover', 'border-radius': '9999px', border: '1px solid ' + CLR.border })}"></span>`;
}

function vShots(shots) {
  if (!shots || !shots.length) return '';
  const col = (s) => s === '11' ? CLR.signal : s === '10' ? CLR.fg : s === '0' ? '#B23A2E' : CLR.muted;
  return `<span style="${style({ display: 'flex', 'flex-wrap': 'wrap', gap: '3px', 'margin-top': '4px' })}">${shots.map((s) =>
    `<span style="${style({ 'min-width': '18px', 'text-align': 'center', padding: '1px 3px',
      'border-radius': '5px', border: '1px solid ' + CLR.border, background: CLR.paper,
      font: '600 10.5px "Inter",sans-serif', 'font-variant-numeric': 'tabular-nums', color: col(String(s)) })}">${esc(s)}</span>`).join('')}</span>`;
}

function vRow(r, cat, mine, showCode, detail) {
  const sub = r.scored
    ? [r.day && `dag ${r.day}`, r.target && `blink ${r.target}`, `${r.arrows} ${r.arrows === 1 ? 'pil' : 'piler'}`].filter(Boolean).join(' · ')
    : (r.group ? `gruppe ${r.group} · ikke startet` : 'ikke startet');
  const code = (showCode || allCountries())
    ? `<span style="${style({ font: '600 11px "Inter",sans-serif', color: CLR.muted })}">&nbsp;${esc(r.country)}</span>` : '';
  return `<div style="${style({ display: 'flex', 'align-items': 'center', gap: '10px', padding: '9px 0',
      'border-top': '1px solid ' + CLR.border, background: mine ? CLR.paper : 'transparent',
      margin: mine ? '0 -6px' : '0', 'padding-left': mine ? '6px' : '0', 'padding-right': mine ? '6px' : '0',
      'border-radius': mine ? '10px' : '0' })}">
    <span style="${rankStyle(r.scored ? r.pos : 0, mine)}">${r.scored ? r.pos : '–'}</span>
    ${detail ? vAvatar(r, 30) : ''}
    <span style="${style({ flex: '1 1 auto', 'min-width': '0' })}">
      <span style="${style({ display: 'block', font: '600 13.5px "Inter",sans-serif', 'white-space': 'nowrap',
        overflow: 'hidden', 'text-overflow': 'ellipsis' })}">${esc(r.name)}${code}</span>
      <span style="${style({ display: 'block', font: '400 11.5px "Inter",sans-serif', color: CLR.muted })}">${esc(sub)}</span>
      ${detail && r.hits ? `<span style="${style({ display: 'block', 'margin-top': '4px', font: '600 10.5px "Inter",sans-serif',
        color: CLR.muted, 'font-variant-numeric': 'tabular-nums' })}">${['11', '10', '8', '5', '0']
        .filter((k) => r.hits[k]).map((k) => `${k}×${r.hits[k]}`).join(' · ')}</span>` : ''}
      ${detail ? vShots(r.shots) : ''}
    </span>
    ${r.scored ? `<span style="${style({ 'text-align': 'right', flex: 'none' })}">
      <span style="${style({ display: 'block', font: '700 16px "Inter",sans-serif', 'font-variant-numeric': 'tabular-nums' })}">${r.total}</span>
      <span style="${style({ display: 'block', font: '400 10.5px "Inter",sans-serif', color: CLR.muted, 'text-transform': 'uppercase', 'letter-spacing': '0.08em' })}">poeng</span>
    </span>` : ''}
  </div>`;
}

function vCatCard(cat) {
  const rows = catRows(cat);
  if (!rows.length) return '';
  const shown = allCountries() ? rows.filter((r) => r.scored).slice(0, 3) : rows;
  const more = allCountries() && rows.filter((r) => r.scored).length > 3;
  // «pågår nå»: siste score i klassen er under 20 minutter gammel
  // (aldri for offisielle dagslister — de er ferdige)
  const updMs = Date.parse((cat.updated || '').replace(' ', 'T'));
  const live = !cat.official && !isNaN(updMs) && (Date.now() - updMs) < 20 * 60000;
  const updated = cat.official
    ? `<span style="${style({ display: 'inline-block', 'margin-top': '3px', padding: '2px 8px',
        'border-radius': '9999px', border: '1.5px solid ' + CLR.action, color: CLR.action,
        font: '600 10px "Inter",sans-serif', 'letter-spacing': '0.1em', 'text-transform': 'uppercase' })}">Offisiell dagsliste</span>`
    : cat.updated
    ? `<span style="${style({ display: 'inline-flex', 'align-items': 'center', gap: '6px',
        font: '400 11px "Inter",sans-serif', color: CLR.muted, 'white-space': 'nowrap' })}">${live
        ? `<span style="${style({ width: '8px', height: '8px', 'border-radius': '9999px', background: CLR.signal,
            display: 'inline-block', animation: 'amber-pulse 1.6s infinite' })}"></span><strong style="color:${CLR.signal}">LIVE</strong>`
        : ''} sist score ${esc(cat.updated.slice(11, 16))}</span>`
    : '';
  return `<section data-action="cat" data-cat="${esc(cat.title)}" style="${style({ background: CLR.surface,
      border: '2px solid ' + CLR.fg, 'border-radius': '18px', padding: '12px 14px 8px', cursor: 'pointer',
      'box-shadow': '4px 4px 0 0 ' + CLR.border })}">
    <div style="${style({ display: 'flex', 'align-items': 'center', gap: '8px' })}">
      <div style="${style({ flex: '1 1 auto', 'min-width': '0' })}">
        <h3 style="${style({ margin: 0, font: '700 14px "Spectral",serif' })}">${esc(shortCat(cat.title))}</h3>
        ${updated}
      </div>
      ${SVG.chevronRight}
    </div>
    ${shown.map((r) => vRow(r, cat, false)).join('')}
    ${more ? `<p style="${style({ margin: '6px 0 8px', font: '600 11.5px "Inter",sans-serif', color: CLR.action })}">Vis alle ${rows.filter((r) => r.scored).length} →</p>` : '<div style="height:4px"></div>'}
  </section>`;
}

function vMedalTable() {
  const t = medalTable();
  if (!t.length) return '';
  return `<section style="${style({ background: CLR.surface, border: '2px solid ' + CLR.fg, 'border-radius': '18px',
      padding: '12px 14px', 'box-shadow': '4px 4px 0 0 ' + CLR.border })}">
    <h3 style="${style({ margin: '0 0 8px', font: '700 14px "Spectral",serif' })}">${SVG.trophy} Medaljestatistikk ${eventOver() ? '' : '(stilling nå)'}</h3>
    ${t.map((e, i) => `<div style="${style({ display: 'flex', 'align-items': 'center', gap: '10px',
        padding: '6px 0', 'border-top': i ? '1px solid ' + CLR.border : 'none' })}">
      <span style="${style({ flex: '1', font: '600 13px "Inter",sans-serif' })}">${esc(e.name)}</span>
      <span style="${style({ font: '600 12.5px "Inter",sans-serif', 'font-variant-numeric': 'tabular-nums' })}">
        <span style="color:#B8860B">●</span> ${e.g} &nbsp;<span style="color:#8a9aa3">●</span> ${e.s} &nbsp;<span style="color:${CLR.signal}">●</span> ${e.b}</span>
    </div>`).join('')}
  </section>`;
}

function vMain() {
  const cats = sortedCategories().filter((c) => catRows(c).length);
  const cards = cats.map(vCatCard).join('');
  return `<main style="${style({ flex: '1 1 auto', 'overflow-y': 'auto', padding: '14px 14px 20px',
      display: 'flex', 'flex-direction': 'column', gap: '12px' })}">
    ${vSummary()}
    ${allCountries() ? vMedalTable() : ''}
    ${cards || `<p style="${style({ color: CLR.muted, font: '400 13px "Inter",sans-serif', 'text-align': 'center', padding: '30px 10px' })}">Ingen resultater ennå for ${esc(countryMeta(state.country).name)}.</p>`}
    <p style="${style({ margin: '4px 0 0', 'text-align': 'center', font: '400 11.5px "Inter",sans-serif', color: CLR.muted })}">
      Data fra <a href="${esc(DATA.competition.url || 'https://hdhiaa.net')}">hdhiaa.net</a> · hentet for ${ageMin()} min siden ·
      live-synk hvert 2. minutt når det skytes · ${state.refreshing ? 'oppdaterer …' : ''}</p>
  </main>`;
}

/* ---------- sheets ---------- */

function vPicker() {
  const q = state.search.trim().toLowerCase();
  const list = [{ code: ALL_COUNTRIES, name: 'Alle land', athletes: 0 }]
    .concat(DATA.countries || [])
    .filter((c) => !q || c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q));
  return sheet(`Velg land`, `
    <input data-input="search" value="${esc(state.search)}" placeholder="Søk land …" style="${style({
      width: '100%', 'box-sizing': 'border-box', padding: '10px 12px', border: '2px solid ' + CLR.fg,
      'border-radius': '12px', font: '400 14px "Inter",sans-serif', 'margin-bottom': '10px', background: CLR.paper })}">
    ${list.map((c) => `
      <button data-action="pick" data-code="${esc(c.code)}" style="${style({ display: 'flex', width: '100%',
        'align-items': 'center', gap: '10px', padding: '11px 10px', border: 'none', cursor: 'pointer',
        background: c.code === state.country ? CLR.paper : 'transparent', 'border-radius': '12px',
        'border-bottom': '1px solid ' + CLR.border, 'text-align': 'left' })}">
        <span style="${style({ flex: 'none', width: '46px', font: '700 13px "Inter",sans-serif', color: CLR.action })}">${c.code === ALL_COUNTRIES ? 'ALLE' : esc(c.code)}</span>
        <span style="${style({ flex: '1', font: '600 13.5px "Inter",sans-serif', color: CLR.fg })}">${esc(c.name)}</span>
        ${c.athletes ? `<span style="${style({ font: '400 11.5px "Inter",sans-serif', color: CLR.muted })}">${c.athletes} utøvere</span>` : ''}
      </button>`).join('')}`);
}

function vCatSheet() {
  const cat = (DATA.categories || []).find((c) => c.title === state.catView);
  if (!cat) return '';
  const rows = (cat.results || []);
  return sheet(esc(shortCat(cat.title)), `
    <p style="${style({ margin: '0 0 8px', font: '400 12px "Inter",sans-serif', color: CLR.muted })}">
      ${esc(cat.title)}${cat.official
        ? ' · offisiell dagsliste, generert ' + esc((cat.updated || '').slice(5, 16))
        : cat.updated ? ' · siste score ' + esc(cat.updated.slice(5, 16)) : ''}</p>
    ${rows.map((r) => vRow(r, cat, !allCountries() && r.country === state.country, true, true)).join('')
      || `<p style="${style({ color: CLR.muted })}">Ingen påmeldte funnet.</p>`}`);
}

function sheet(title, body) {
  return `<div data-action="close-sheet" style="${style({ position: 'absolute', inset: '0', background: 'rgba(6,48,63,.45)',
      display: 'flex', 'align-items': 'flex-end', 'z-index': '20' })}">
    <div data-sheet style="${style({ background: CLR.surface, width: '100%', 'max-height': '82%', 'overflow-y': 'auto',
      'border-radius': '22px 22px 0 0', border: '2px solid ' + CLR.fg, 'border-bottom': 'none',
      padding: '14px 16px 22px', animation: 'sheet-up .25s cubic-bezier(0.34,1.3,0.64,1)' })}">
      <div style="${style({ display: 'flex', 'justify-content': 'space-between', 'align-items': 'center', 'margin-bottom': '10px' })}">
        <h2 style="${style({ margin: 0, font: '700 17px "Spectral",serif' })}">${title}</h2>
        <button data-action="close-sheet" style="${style({ border: '2px solid ' + CLR.fg, background: CLR.paper,
          'border-radius': '9999px', width: '32px', height: '32px', cursor: 'pointer', display: 'grid',
          'place-items': 'center', color: CLR.fg })}">${SVG.close}</button>
      </div>
      ${body}
    </div>
  </div>`;
}

/* ---------- render & events ---------- */

function render() {
  const frame = document.getElementById('frame');
  frame.innerHTML = vHeader() + vMain()
    + (state.catView ? vCatSheet() : state.picker || !state.country ? vPicker() : '');
}

document.getElementById('frame').addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  if (a === 'picker') { state.picker = true; state.search = ''; }
  else if (a === 'pick') {
    state.country = el.dataset.code;
    store.set('ianseolive-hdhiaa-country', state.country);
    state.picker = false;
  }
  else if (a === 'cat') { state.catView = el.dataset.cat; }
  else if (a === 'close-sheet' && !e.target.closest('[data-sheet]') || a === 'close-sheet' && e.target.closest('button')) {
    state.catView = null; state.picker = false;
  }
  render();
});

document.getElementById('frame').addEventListener('input', (e) => {
  if (e.target.dataset.input === 'search') { state.search = e.target.value; render();
    const inp = document.querySelector('[data-input="search"]');
    if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } }
});

async function load() {
  try {
    const resp = await fetch(DATA_URL + (DATA_URL.includes('?') ? '&' : '?') + 't=' + Date.now());
    if (resp.ok) DATA = await resp.json();
  } catch { /* beholder gamle data */ }
}

(async function boot() {
  const caption = document.getElementById('caption-bottom');
  await load();
  const c = DATA.competition || {};
  document.title = (c.name || 'HDH-IAA') + ' · Live';
  document.getElementById('caption-top').innerHTML = `ᛇ&nbsp;&nbsp;HDH-IAA Live · ${esc(c.name || '')}`;
  caption.innerHTML = `Resultater fra <a href="${esc(c.url || 'https://hdhiaa.net')}">hdhiaa.net</a>`
    + ' · live-synk hvert 2. minutt når det skytes · <a href="../">Ianseolive</a>';
  if (!state.country) state.country = DATA.defaultCountry || ALL_COUNTRIES;
  if (!store.get('ianseolive-hdhiaa-country', null)) state.picker = true;
  render();
  setInterval(async () => { state.refreshing = true; render(); await load(); state.refreshing = false; render(); }, REFRESH_DATA_MS);
  setInterval(render, TICK_MS);
})();
