'use strict';

/* ============================================================
   Storage
   ============================================================ */
const STORAGE_KEY = 'familyCycles.v1';
const DEFAULT_CYCLE = 28;
const PERIOD_DAYS = 5;          // only start dates are logged; each period is drawn this long
const MIN_CYCLE = 15;          // shorter gaps are ignored when averaging
const MAX_CYCLE = 60;          // longer gaps (e.g. a skipped month) are ignored
const CYCLES_TO_AVERAGE = 6;

function defaultData() {
  return {
    version: 1,
    people: [
      { id: 'p1', name: 'Me', color: '#e0445f' },
      { id: 'p2', name: 'Daughter 1', color: '#8e5bd6' },
      { id: 'p3', name: 'Daughter 2', color: '#2a9d8f' },
    ],
    periods: [],
    lastBackup: null,
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && Array.isArray(d.people) && Array.isArray(d.periods)) return d;
    }
  } catch (e) { /* fall through to defaults */ }
  return defaultData();
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

let data = load();
let ui = { personId: data.people[0]?.id, view: 'cycle' };
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY + '.ui') || '{}');
  if (data.people.some(p => p.id === saved.personId)) ui.personId = saved.personId;
} catch (e) {}

function saveUi() {
  try { localStorage.setItem(STORAGE_KEY + '.ui', JSON.stringify({ personId: ui.personId })); } catch (e) {}
}

// Ask the browser not to evict our data under storage pressure.
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

/* ============================================================
   Dates — stored as "YYYY-MM-DD", computed as whole day numbers
   ============================================================ */
function toDay(s) {
  const [y, m, d] = s.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}
function todayStr() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}
function todayDay() { return toDay(todayStr()); }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmt(day, withYear) {
  const d = new Date(day * 86400000);
  const s = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return withYear ? `${s}, ${d.getUTCFullYear()}` : s;
}
function plural(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }

/* ============================================================
   Cycle maths
   ============================================================ */
function periodsOf(personId) {
  return data.periods
    .filter(p => p.personId === personId)
    .sort((a, b) => a.start.localeCompare(b.start));
}

function average(nums) {
  return nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : null;
}

/** Everything the screens need to know about one person. */
function statsFor(personId) {
  const list = periodsOf(personId);
  const today = todayDay();
  const starts = list.map(p => toDay(p.start));

  const cycleLens = [];
  for (let i = 1; i < starts.length; i++) cycleLens.push(starts[i] - starts[i - 1]);
  const validCycles = cycleLens.filter(n => n >= MIN_CYCLE && n <= MAX_CYCLE).slice(-CYCLES_TO_AVERAGE);

  const avgCycle = average(validCycles) ?? DEFAULT_CYCLE;
  const isEstimate = validCycles.length === 0;

  const s = {
    list, avgCycle, isEstimate, validCycles,
    hasData: list.length > 0,
  };
  if (!s.hasData) return s;

  const last = list[list.length - 1];
  const lastStart = toDay(last.start);
  s.last = last;
  s.lastStart = lastStart;
  s.dayOfCycle = today - lastStart + 1;          // may be <= 0 if a future date was logged
  s.nextStart = lastStart + avgCycle;
  s.daysUntil = s.nextStart - today;
  s.late = s.daysUntil < 0 ? -s.daysUntil : 0;
  s.onPeriod = s.dayOfCycle >= 1 && s.dayOfCycle <= PERIOD_DAYS;
  return s;
}

function statusText(s) {
  if (!s.hasData) return 'No data';
  if (s.onPeriod) return `Period day ${s.dayOfCycle}`;
  if (s.late) return `${s.late}d late`;
  if (s.daysUntil === 0) return 'Due today';
  return `Period in ${s.daysUntil}d`;
}

/* ============================================================
   Rendering helpers
   ============================================================ */
const $ = sel => document.querySelector(sel);
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) e.append(c);
  return e;
}
function person() { return data.people.find(p => p.id === ui.personId) || data.people[0]; }

function render() {
  const p = person();
  if (p) {
    ui.personId = p.id;
    document.body.style.setProperty('--pc', p.color);
  }
  renderTabs();
  document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== 'view-' + ui.view; });
  document.querySelectorAll('.bottom-bar button').forEach(b => b.classList.toggle('active', b.dataset.view === ui.view));
  $('#personTabs').hidden = ui.view === 'settings';
  if (ui.view === 'cycle') renderCycle();
  if (ui.view === 'history') renderHistory();
  if (ui.view === 'settings') renderSettings();
}

function renderTabs() {
  const nav = $('#personTabs');
  nav.replaceChildren(...data.people.map(p => {
    const s = statsFor(p.id);
    const soon = s.hasData && (s.onPeriod || s.late || s.daysUntil <= 3);
    return el('button', {
      class: 'person-tab' + (p.id === ui.personId ? ' active' : '') + (soon ? ' soon' : ''),
      style: `--pc:${p.color}`,
      onclick: () => { ui.personId = p.id; saveUi(); render(); },
    },
      el('span', { class: 'avatar', style: `background:${p.color}` }, (p.name.trim()[0] || '?').toUpperCase()),
      el('span', { class: 'name' }, p.name),
      el('span', { class: 'status' }, statusText(s)),
    );
  }));
}

/* ---------- Cycle ring ---------- */
const SVG_NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}, text) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
}

function renderCycle() {
  const p = person();
  const s = statsFor(p.id);
  const size = 320, c = size / 2, R = 132;
  const root = svg('svg', { viewBox: `0 0 ${size} ${size}`, role: 'img', 'aria-label': `${p.name} cycle` });
  const defs = svg('defs');
  const pat = svg('pattern', { id: 'hatch', width: 4, height: 4, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
  pat.append(svg('rect', { width: 4, height: 4, fill: '#fff' }), svg('rect', { width: 2, height: 4, fill: p.color, opacity: .55 }));
  defs.append(pat);
  root.append(defs);

  const actions = $('#cycleActions');
  const facts = $('#cycleFacts');
  const note = $('#ringNote');

  if (!s.hasData) {
    const n = DEFAULT_CYCLE;
    drawDots(root, n, c, R, () => ({ fill: 'var(--dot)' }));
    root.append(
      svg('text', { x: c, y: c - 6, 'text-anchor': 'middle', class: 'ring-center-sub', fill: 'var(--ink)' }, 'No periods yet'),
      svg('text', { x: c, y: c + 18, 'text-anchor': 'middle', class: 'ring-center-date' }, `Log ${p.name === 'Me' ? 'your' : p.name + "'s"} first period`),
    );
    $('#ringWrap').replaceChildren(root);
    note.textContent = '';
    actions.replaceChildren(
      el('button', { class: 'btn big', onclick: () => openSheet({ personId: p.id }) }, 'Log period'),
    );
    facts.replaceChildren();
    return;
  }

  // Ring covers the current cycle plus the predicted next period.
  const cycleDays = Math.max(s.avgCycle, s.dayOfCycle);
  const predicted = s.late ? 0 : PERIOD_DAYS;
  const total = cycleDays + predicted;

  drawDots(root, total, c, R, day => {
    // day is 1-based within the ring
    if (day <= PERIOD_DAYS) return { fill: p.color };
    if (day > cycleDays) return { fill: 'url(#hatch)', stroke: p.color, 'stroke-width': 1.2 };
    return { fill: 'var(--dot)' };
  }, s.dayOfCycle);

  // Center text
  let big, label, sub, subColor = p.color;
  if (s.dayOfCycle < 1) {
    label = 'Starts'; big = fmt(s.lastStart); sub = 'logged in the future';
  } else if (s.onPeriod) {
    label = 'Period'; big = `Day ${s.dayOfCycle}`; sub = `Next: ${fmt(s.nextStart)}`;
  } else {
    label = 'Cycle day'; big = String(s.dayOfCycle);
    if (s.late) { sub = `Period ${plural(s.late, 'day')} late`; subColor = '#c62828'; }
    else if (s.daysUntil === 0) sub = 'Period expected today';
    else sub = `Period in ${plural(s.daysUntil, 'day')}`;
  }
  root.append(
    svg('text', { x: c, y: c - 34, 'text-anchor': 'middle', class: 'ring-center-label' }, label),
    svg('text', { x: c, y: c + 12, 'text-anchor': 'middle', class: 'ring-center-day' }, big),
    svg('text', { x: c, y: c + 40, 'text-anchor': 'middle', class: 'ring-center-sub', fill: subColor }, sub),
    svg('text', { x: c, y: c + 62, 'text-anchor': 'middle', class: 'ring-center-date' },
      s.onPeriod || s.dayOfCycle < 1 ? '' : `Next: ${fmt(s.nextStart)}`),
  );
  $('#ringWrap').replaceChildren(root);

  note.replaceChildren(...[
    el('div', { class: 'legend' },
      el('span', {}, el('i', { style: `background:${p.color}` }), 'Period'),
      el('span', {}, el('i', { style: `background:repeating-linear-gradient(45deg,${p.color}88 0 2px,#fff 2px 4px);border:1px solid ${p.color}` }), 'Predicted'),
      el('span', {}, el('i', { style: 'background:var(--ink)' }), 'Today'),
    ),
    s.isEstimate ? el('div', { style: 'margin-top:6px' }, 'Prediction uses a 28-day estimate — log more periods to personalise it.') : null,
  ].filter(Boolean));

  actions.replaceChildren(
    el('button', { class: 'btn big', onclick: () => openSheet({ personId: p.id }) }, 'Log period'));

  facts.replaceChildren(
    fact(s.isEstimate ? '~28' : s.avgCycle, 'avg cycle (days)'),
    fact(fmt(s.lastStart), 'last started'),
    fact(fmt(s.nextStart), 'next expected'),
  );
}

function fact(v, label) {
  return el('div', { class: 'fact' }, el('b', {}, String(v)), el('span', {}, label));
}

function drawDots(root, n, c, R, styleFor, todayIndex) {
  const gapAngle = 0.0; // dots are evenly spaced all the way round
  const step = (2 * Math.PI - gapAngle) / n;
  const r = Math.max(2.5, Math.min(9, (2 * Math.PI * R / n) * 0.36));
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + gapAngle / 2 + step * i;
    const x = c + R * Math.cos(a), y = c + R * Math.sin(a);
    const day = i + 1;
    const isToday = day === todayIndex;
    root.append(svg('circle', { cx: x.toFixed(2), cy: y.toFixed(2), r: isToday ? r + 2.5 : r, ...styleFor(day) }));
    if (isToday) {
      root.append(svg('circle', { cx: x.toFixed(2), cy: y.toFixed(2), r: r + 5.5, fill: 'none', stroke: 'var(--ink)', 'stroke-width': 2.2 }));
      const cos = Math.cos(a), sin = Math.sin(a);
      const ox = c + (R + r + 10) * cos, oy = c + (R + r + 10) * sin;
      const anchor = cos > 0.35 ? 'start' : cos < -0.35 ? 'end' : 'middle';
      root.append(svg('text', { x: ox.toFixed(1), y: (oy + 4 + sin * 6).toFixed(1), 'text-anchor': anchor, 'font-size': 11, 'font-weight': 700, fill: 'var(--ink)' }, 'today'));
    }
  }
}

/* ---------- History ---------- */
function renderHistory() {
  const p = person();
  const s = statsFor(p.id);
  const today = todayDay();

  const minC = s.validCycles.length ? Math.min(...s.validCycles) : null;
  const maxC = s.validCycles.length ? Math.max(...s.validCycles) : null;
  $('#historyStats').replaceChildren(
    el('div', { class: 'stat' },
      el('b', {}, s.isEstimate ? '—' : String(s.avgCycle), el('small', {}, ' days')),
      el('span', {}, 'Average cycle length'),
      minC != null && minC !== maxC ? el('span', {}, `Range ${minC}–${maxC} days`) : null),
    el('div', { class: 'stat' },
      el('b', {}, String(s.list.length)),
      el('span', {}, 'Periods logged')),
  );

  const list = s.list;
  $('#historyHint').hidden = !list.length;
  if (!list.length) {
    $('#historyList').replaceChildren(el('li', { class: 'empty' }, `No periods logged for ${p.name} yet.`));
    return;
  }

  // Build cycles: each period start → day before the next start.
  const cycles = list.map((per, i) => {
    const start = toDay(per.start);
    const next = list[i + 1];
    const current = !next;
    const length = current ? Math.max(1, today - start + 1) : toDay(next.start) - start;
    return { per, start, length, current, endDay: current ? today : toDay(next.start) - 1 };
  }).reverse();

  const maxLen = Math.max(...cycles.map(c => c.length), s.avgCycle);

  $('#historyList').replaceChildren(...cycles.map(cy => {
    const dots = [];
    const shown = Math.min(cy.length, 120);
    for (let d = 1; d <= shown; d++) {
      const isP = d <= PERIOD_DAYS;
      dots.push(el('i', { class: isP ? 'p' : (cy.current && d === cy.length ? 'today' : '') }));
    }
    const odd = !cy.current && (cy.length < MIN_CYCLE || cy.length > MAX_CYCLE);
    return el('li', { class: 'cycle-row', onclick: () => openSheet(cy.per) },
      el('div', { class: 'head' },
        el('div', {},
          cy.current ? el('span', { class: 'tag' }, `Current cycle · Day ${cy.length}`) : null,
          el('span', { class: 'range' }, `${fmt(cy.start, true)} – ${cy.current ? 'today' : fmt(cy.endDay)}`)),
        el('span', { class: 'len' }, plural(cy.length, 'day'))),
      el('div', { class: 'bar', style: `width:${(Math.min(cy.length, maxLen) / maxLen * 100).toFixed(1)}%` }, dots),
      odd ? el('div', { class: 'sub' }, 'Not counted in average') : null,
    );
  }));
}

/* ---------- In-app dialog (native confirm/alert are silently blocked in some browsers) ---------- */
function ask(message, { ok = 'OK', cancel = 'Cancel', danger = false } = {}) {
  return new Promise(resolve => {
    const close = result => { $('#dialog').hidden = true; resolve(result); };
    $('#dialogMsg').textContent = message;
    $('#dialogBtns').replaceChildren(
      cancel ? el('button', { type: 'button', class: 'btn ghost', onclick: () => close(false) }, cancel) : null,
      el('button', { type: 'button', class: 'btn' + (danger ? ' danger-solid' : ''), onclick: () => close(true) }, ok),
    );
    $('#dialog').onclick = e => { if (e.target.id === 'dialog') close(false); };
    $('#dialog').hidden = false;
  });
}
const tell = message => ask(message, { cancel: null });

/* ---------- Settings ---------- */
function renderSettings() {
  $('#peopleList').replaceChildren(...data.people.map(p => el('div', { class: 'person-edit' },
    el('input', { type: 'color', value: p.color, 'aria-label': 'Colour', oninput: e => { p.color = e.target.value; save(); renderTabs(); } }),
    el('input', { type: 'text', value: p.name, 'aria-label': 'Name', oninput: e => { p.name = e.target.value; save(); } , onchange: () => render() }),
    data.people.length > 1 ? el('button', { class: 'remove', title: 'Remove', onclick: () => removePerson(p) }, '×') : null,
  )));
  $('#clearList').replaceChildren(
    ...data.people.map(p => {
      const n = periodsOf(p.id).length;
      return n ? el('button', { class: 'btn ghost danger', onclick: () => clearPeriods(p) }, `Delete ${p.name}'s periods (${n})`) : null;
    }),
    el('button', { class: 'btn ghost danger', onclick: deleteEverything }, 'Delete everything'),
  );
  const lb = data.lastBackup;
  $('#backupInfo').textContent = lb
    ? `Last backup: ${fmt(toDay(lb), true)} (${plural(todayDay() - toDay(lb), 'day')} ago)`
    : 'No backup exported yet.';
}

async function removePerson(p) {
  const n = data.periods.filter(x => x.personId === p.id).length;
  if (!await ask(`Remove ${p.name}${n ? ` and their ${plural(n, 'logged period')}` : ''}? This can't be undone.`, { ok: 'Remove', danger: true })) return;
  data.people = data.people.filter(x => x.id !== p.id);
  data.periods = data.periods.filter(x => x.personId !== p.id);
  save(); render();
}

async function clearPeriods(p) {
  const n = periodsOf(p.id).length;
  if (!await ask(`Delete all ${plural(n, 'logged period')} for ${p.name}? This can't be undone.`, { ok: 'Delete', danger: true })) return;
  data.periods = data.periods.filter(x => x.personId !== p.id);
  save(); render();
}

async function deleteEverything() {
  if (!await ask("Delete all periods and reset people to the defaults? This can't be undone.", { ok: 'Delete everything', danger: true })) return;
  data = defaultData();
  ui.personId = data.people[0].id;
  save(); saveUi(); render();
}

const EXTRA_COLORS = ['#f08a24', '#3a86ff', '#d6336c', '#6a994e'];
$('#addPersonBtn').addEventListener('click', () => {
  const id = 'p' + Date.now().toString(36);
  data.people.push({ id, name: 'New person', color: EXTRA_COLORS[data.people.length % EXTRA_COLORS.length] });
  save(); render();
});

/* ---------- Export / import ---------- */
$('#exportBtn').addEventListener('click', async () => {
  data.lastBackup = todayStr();
  save();
  const json = JSON.stringify(data, null, 2);
  const name = `cycles-backup-${todayStr()}.json`;
  const file = new File([json], name, { type: 'application/json' });
  // On phones, the share sheet lets you save to Files / Drive / email.
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Cycles backup' }); renderSettings(); return; }
    catch (e) { if (e.name === 'AbortError') { renderSettings(); return; } }
  }
  const url = URL.createObjectURL(file);
  const a = el('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  renderSettings();
});

$('#importInput').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  let d;
  try {
    d = JSON.parse(await f.text());
    if (!Array.isArray(d.people) || !Array.isArray(d.periods)) throw new Error('bad file');
  } catch (err) {
    return tell("That file doesn't look like a Cycles backup.");
  }
  if (!await ask(`Replace all current data with this backup (${plural(d.people.length, 'person')}, ${plural(d.periods.length, 'period')})?`, { ok: 'Replace' })) return;
  data = { ...defaultData(), ...d };
  ui.personId = data.people[0]?.id;
  save(); saveUi(); render();
  tell('Backup restored.');
});

/* ============================================================
   Logging periods
   ============================================================ */
function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

let editing = null;
function openSheet(period) {
  editing = period;
  const isNew = !period.id;
  $('#sheetTitle').textContent = isNew ? `Log period · ${person().name}` : `Edit period · ${person().name}`;
  $('#fStart').value = period.start || '';
  $('#fStart').max = todayStr();
  $('#deleteBtn').hidden = isNew;
  $('#formError').hidden = true;
  $('#sheet').hidden = false;
}
function closeSheet() { $('#sheet').hidden = true; editing = null; }

$('#cancelBtn').addEventListener('click', closeSheet);
$('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') closeSheet(); });
$('#deleteBtn').addEventListener('click', async () => {
  const id = editing?.id;
  if (!id) return;
  if (!await ask('Delete this period?', { ok: 'Delete', danger: true })) return;
  data.periods = data.periods.filter(p => p.id !== id);
  save(); closeSheet(); render();
});

$('#periodForm').addEventListener('submit', e => {
  e.preventDefault();
  const start = $('#fStart').value;
  const err = msg => { $('#formError').textContent = msg; $('#formError').hidden = false; };
  if (!start) return err('Pick the start date.');
  const personId = editing.personId;
  const clash = data.periods.find(p => p.personId === personId && p.id !== editing.id &&
    Math.abs(toDay(p.start) - toDay(start)) < PERIOD_DAYS);
  if (clash) return err(`That's too close to the period starting ${fmt(toDay(clash.start), true)}.`);

  if (editing.id) {
    editing.start = start;
  } else {
    data.periods.push({ id: newId(), personId, start });
  }
  save(); closeSheet(); render();
});

$('#addPastBtn').addEventListener('click', () => openSheet({ personId: person().id }));

/* ============================================================
   Navigation
   ============================================================ */
document.querySelectorAll('.bottom-bar button').forEach(b =>
  b.addEventListener('click', () => { ui.view = b.dataset.view; render(); window.scrollTo(0, 0); }));

// Swipe left/right on the ring to switch person.
(() => {
  let x0 = null, y0 = null;
  const area = $('#view-cycle');
  area.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  area.addEventListener('touchend', e => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx)) return;
    const i = data.people.findIndex(p => p.id === ui.personId);
    const j = (i + (dx < 0 ? 1 : -1) + data.people.length) % data.people.length;
    ui.personId = data.people[j].id; saveUi(); render();
  });
})();

// Refresh "today" when the app comes back to the foreground on a new day.
let renderedFor = todayStr();
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && todayStr() !== renderedFor) { renderedFor = todayStr(); render(); }
});

render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
