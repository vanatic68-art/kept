/* Kept — app UI. All data stays on this device (localStorage + IndexedDB for photos). */
'use strict';
const K = window.KeptCore;
const ST = window.KeptStatement;
const CD = window.KeptCancel;
const STORE_KEY = 'kept.v1';
const APP_NAME = 'Kept'; // working name — change here, in index.html and manifest.webmanifest
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const fmt = (c, whole) => (c < 0 ? '-' : '') + '$' + (Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
const fmtSmart = c => fmt(c, c % 100 === 0);
const ord = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const niceDate = s => { const d = K.parse(s); return MONTHS[d.getMonth()] + ' ' + d.getDate() + (d.getFullYear() !== K.parse(today()).getFullYear() ? ', ' + d.getFullYear() : ''); };
// ?today=YYYY-MM-DD lets you preview the future (handy for demos/testing). Not saved.
const TODAY_OVERRIDE = (() => { const v = new URLSearchParams(location.search).get('today'); return /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null; })();
const today = () => TODAY_OVERRIDE || K.ymd(new Date());

/* ---------- storage ---------- */
const defaultState = () => ({ version: 1, subs: [], receipts: [], goal: null, ignoredMerchants: [], createdAt: today() });
function load() { try { const s = JSON.parse(localStorage.getItem(STORE_KEY)); if (s && Array.isArray(s.subs)) { if (!Array.isArray(s.ignoredMerchants)) s.ignoredMerchants = []; return s; } } catch (e) { } return defaultState(); }
let state = load();
let findCache = null; // last analysis (session only)
// Statements added this session: [{ id, name, format, txs, range, error }] — kept in sessionStorage so an Android
// tab reload while the file picker is open doesn't lose the files already added.
let findFiles = (() => { try { return JSON.parse(sessionStorage.getItem('kept.findFiles') || '[]'); } catch (e) { return []; } })();
const saveFindFiles = () => { try { sessionStorage.setItem('kept.findFiles', JSON.stringify(findFiles)); } catch (e) { } };
let pendingPromptOpen = false; // hoisted for closeSheet
let pendingSnoozed = false;      // "Not yet"/backdrop → don't re-ask until the next cancel-link tap or app open
let pickerOpen = false;          // true while the OS file picker is showing
let findStatusHtml = '';         // last statement-reading status (survives re-render)
function openPicker(id) {
  const inp = document.getElementById(id); if (!inp) return;
  inp.value = ''; pickerOpen = true; clearTimeout(openPicker._t);
  inp.click();
}
function pickerDone() { pickerOpen = false; clearTimeout(openPicker._t); }
const dupKey = s => [String(s.name || '').trim().toLowerCase(), s.cents || 0, +s.day || 0].join('|');
function findSameBill(name, cents, day, exceptId) { const k = dupKey({ name, cents, day }); return state.subs.find(s => s.id !== exceptId && dupKey(s) === k) || null; }
/** Inline question at the bottom of the open sheet; resolves with the chosen key. */
function inlineAsk(sh, msgHtml, choices) {
  return new Promise(res => {
    let box = sh.querySelector('#sheetAsk');
    if (!box) { box = document.createElement('div'); box.id = 'sheetAsk'; sh.appendChild(box); }
    box.className = 'ask';
    box.innerHTML = `<p style="margin:0 0 12px">${msgHtml}</p><div class="btns">${choices.map(([k, label, cls]) => `<button type="button" class="btn ${cls || ''}" data-ask="${k}">${label}</button>`).join('')}</div>`;
    box.scrollIntoView({ block: 'center', behavior: 'smooth' });
    box.querySelectorAll('[data-ask]').forEach(b => b.addEventListener('click', () => { const k = b.dataset.ask; box.remove(); res(k); }, { once: true }));
  });
}
function save() { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => { });

const Photos = (() => {
  let dbp;
  const db = () => dbp || (dbp = new Promise((res, rej) => { const r = indexedDB.open('kept', 1); r.onupgradeneeded = () => r.result.createObjectStore('photos'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
  const tx = async (mode, fn) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction('photos', mode); const st = t.objectStore('photos'); const r = fn(st); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); }); };
  const urls = {};
  return {
    put: (id, blob) => { delete urls[id]; return tx('readwrite', s => s.put(blob, id)); },
    get: id => tx('readonly', s => s.get(id)),
    del: id => { delete urls[id]; return tx('readwrite', s => s.delete(id)); },
    clear: () => tx('readwrite', s => s.clear()),
    url: async id => { if (urls[id]) return urls[id]; const b = await Photos.get(id); if (!b) return null; return (urls[id] = URL.createObjectURL(b)); },
  };
})();

/* ---------- ui helpers ---------- */
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 2600); }
/* Sheets: open/close + Android back button (history entry) + swipe-down-to-dismiss. */
let sheetBackPending = false, hashAfterBack = null;
function openSheet(html, mount) {
  const sh = $('#sheet'); const wasOpen = !sh.hidden;
  sh.innerHTML = '<div class="grab" aria-hidden="true"></div>' + html; sh.hidden = false; $('#backdrop').hidden = false;
  sh.style.transform = ''; sh.style.transition = ''; $('#backdrop').style.opacity = '';
  document.body.style.overflow = 'hidden'; sh.scrollTop = 0;
  // Give the sheet its own history entry so Android back closes it instead of leaving Kept.
  if (!wasOpen && !sheetBackPending && !(history.state && history.state.keptSheet)) { try { history.pushState({ keptSheet: 1 }, ''); } catch (e) { } }
  if (mount) mount(sh);
}
function closeSheet(fromBack) {
  const was = !$('#sheet').hidden;
  $('#sheet').hidden = true; $('#backdrop').hidden = true; $('#sheet').innerHTML = ''; $('#sheet').style.transform = ''; $('#backdrop').style.opacity = '';
  document.body.style.overflow = ''; if (pendingPromptOpen) pendingSnoozed = true; pendingPromptOpen = false;
  // Closed by a button/backdrop/swipe: drop the sheet's history entry so Back still works normally.
  if (was && fromBack !== true && history.state && history.state.keptSheet && !sheetBackPending) { sheetBackPending = true; history.back(); }
}
/** Navigate to a tab after closing a sheet (waits for the history.back() above to finish). */
function goHash(h) { if (sheetBackPending) hashAfterBack = h; else { location.hash = h; route(); } }
// A tab tapped in the split second before history.back() lands must still win.
window.addEventListener('hashchange', () => { if (sheetBackPending) hashAfterBack = location.hash; }, true);
window.addEventListener('popstate', () => {
  if (sheetBackPending) {
    sheetBackPending = false;
    if (!$('#sheet').hidden) { try { history.pushState({ keptSheet: 1 }, ''); } catch (e) { } } // a new sheet opened meanwhile
    if (hashAfterBack) { const h = hashAfterBack; hashAfterBack = null; location.hash = h; route(); }
    return;
  }
  if (!$('#sheet').hidden) closeSheet(true);   // Android back / gesture → close the sheet, stay in Kept
});
$('#backdrop').addEventListener('click', closeSheet);
/** Animate the sheet off-screen, then run the normal close (same as tapping the backdrop). */
function dismissSheet() {
  const sh = $('#sheet'); if (sh.hidden) return;
  sh.style.transition = 'transform .18s ease-in'; sh.style.transform = `translateY(${sh.offsetHeight + 20}px)`;
  $('#backdrop').style.transition = 'opacity .18s'; $('#backdrop').style.opacity = '0';
  setTimeout(() => { $('#backdrop').style.transition = ''; closeSheet(); }, 190);
}
(function swipeToDismiss() {
  const sh = $('#sheet'); const bd = $('#backdrop');
  let startY = 0, startX = 0, lastY = 0, lastT = 0, vel = 0, dy = 0, state = 'idle', fromHandle = false;
  const isField = el => !!el.closest('input, textarea, select, [contenteditable]');
  const begin = (y, x, target) => {
    if (sh.hidden) return false;
    fromHandle = !!target.closest('.grab, .sheet-head, .sheet > h3:first-of-type');
    if (!fromHandle && isField(target)) { state = 'ignore'; return false; }
    startY = lastY = y; startX = x; lastT = performance.now(); vel = 0; dy = 0;
    state = fromHandle ? 'drag-ready' : 'maybe'; return true;
  };
  const move = (y, x) => {
    const d = y - startY;
    if (state === 'maybe') {
      if (Math.abs(x - startX) > Math.abs(d) && Math.abs(x - startX) > 8) { state = 'ignore'; return false; }
      if (d > 8 && sh.scrollTop <= 0) state = 'drag-ready';
      else if (Math.abs(d) > 8) { state = 'ignore'; return false; }  // normal scroll inside the sheet
      else return false;
    }
    if (state === 'drag-ready') { state = 'drag'; sh.style.transition = 'none'; startY = y; }
    if (state !== 'drag') return false;
    const now = performance.now(); vel = (y - lastY) / Math.max(1, now - lastT); lastY = y; lastT = now;
    dy = Math.max(0, y - startY);
    sh.style.transform = `translateY(${dy}px)`;
    bd.style.opacity = String(Math.max(0.15, 1 - dy / (sh.offsetHeight || 1)));
    return true;
  };
  const end = () => {
    const was = state; state = 'idle';
    if (was !== 'drag') return;
    const h = sh.offsetHeight || 1;
    if (dy > h * 0.25 || (vel > 0.5 && dy > 30)) dismissSheet();
    else { sh.style.transition = 'transform .2s ease-out'; sh.style.transform = ''; bd.style.opacity = ''; }
  };
  // Touch (Android Chrome): non-passive move so we can stop the page from scrolling while dragging.
  sh.addEventListener('touchstart', e => { if (e.touches.length !== 1) { state = 'ignore'; return; } begin(e.touches[0].clientY, e.touches[0].clientX, e.target); }, { passive: true });
  sh.addEventListener('touchmove', e => { if (state === 'idle' || state === 'ignore') return; if (move(e.touches[0].clientY, e.touches[0].clientX) && e.cancelable) e.preventDefault(); }, { passive: false });
  sh.addEventListener('touchend', end); sh.addEventListener('touchcancel', () => { dy = 0; end(); });
  // Mouse / pen (desktop testing): drag the grab bar or header only.
  sh.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch' || !e.target.closest('.grab, .sheet-head, .sheet > h3:first-of-type')) return;
    begin(e.clientY, e.clientX, e.target);
    const mv = ev => move(ev.clientY, ev.clientX), up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); end(); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  });
})();

/* ---------- routing ---------- */
const routes = { home: renderHome, subs: renderSubs, receipts: renderReceipts, settings: renderSettings, find: renderFind, howto: renderHowto };
function route() {
  const tab = (location.hash || '#home').slice(1).split('?')[0];
  const r = routes[tab] ? tab : 'home';
  const tabHl = r === 'find' ? 'subs' : r === 'howto' ? 'settings' : r;
  $$('#tabbar a').forEach(a => a.classList.toggle('active', a.dataset.tab === tabHl));
  $('#view').innerHTML = routes[r]();
  hydrate();
  window.scrollTo(0, 0);
}
function activeRoute() { const t = (location.hash || '#home').slice(1).split('?')[0]; return routes[t] ? t : 'home'; }
function rerender() { const y = window.scrollY; $('#view').innerHTML = routes[activeRoute()](); hydrate(); window.scrollTo(0, y); }
window.addEventListener('hashchange', route);
async function hydrate() { // fill receipt thumbnails
  for (const img of $$('img[data-photo]')) { const u = await Photos.url(img.dataset.photo); if (u) img.src = u; else img.replaceWith(Object.assign(document.createElement('div'), { className: 'badge rec', textContent: '🧾' })); }
}
document.addEventListener('click', e => {
  if (e.target.closest('a[href]') && !e.target.closest('a[href]').dataset.act) return; // a link inside a row opens the link only
  const el = e.target.closest('[data-act]'); if (!el) return;
  const a = el.dataset.act, id = el.dataset.id;
  ({ addSub: () => subForm(), editSub: () => subForm(state.subs.find(s => s.id === id)), addReceipt: () => receiptForm(), editReceipt: () => receiptForm(state.receipts.find(r => r.id === id)),
    goal: () => goalForm(), close: closeSheet, demo: loadDemo, clearDemo: clearDemo, exportData, importData: () => openPicker('importFile'), reset: resetAll, upcoming: showAllUpcoming,
    pickStatement: () => openPicker('stmtFile'), useSampleStmt, pasteStmt, runFind: () => runFind(false), removeStmt: () => removeStmt(el.dataset.id), clearStmts, dupRemove: () => dupRemove(el.dataset.key), dupKeep: () => dupKeep(el.dataset.key), ignoreFound: () => ignoreFound(el.dataset.key), cancelledFromDir: () => cancelledFromDir(el.dataset.id),
    startSavingFound: () => startSavingFound(el.dataset.key), clearIgnored,
    linkBank: () => linkBank(), linkDemo, bankRefresh, bankDisconnect, relinkBank: () => { const b = getBank(); if (b) linkBank({ itemId: b.itemId }); }, saveBankServer })[a]?.();
});

/* ---------- home ---------- */
function goalInfo(t) {
  const g = state.goal; if (!g) return null;
  const td = today(); const daysLeft = K.daysBetween(td, g.date);
  const projected = t.all + (g.date > td ? K.projectSubs(state.subs, td, g.date) : 0);
  const pace = K.receiptPace(state, td);
  const withPace = projected + (daysLeft > 0 ? Math.round(pace * daysLeft / 30.44) : 0);
  return { g, daysLeft, projected, withPace, pct: Math.min(100, Math.round(t.all / g.cents * 100)) };
}

function dupGroups() {
  const groups = {};
  state.subs.forEach(s => { const k = dupKey(s) + '|' + K.subMode(s); (groups[k] = groups[k] || []).push(s); });
  const dismissed = state.dupDismissed || [];
  return Object.entries(groups).filter(([k, list]) => list.length > 1 && !dismissed.includes(k)).map(([key, list]) => ({ key, list }));
}
function dupBannerHtml() {
  return dupGroups().map(g => `<div class="card dup-banner"><div style="font-weight:700;margin-bottom:4px">🤔 Looks like ${esc(g.list[0].name)} was added ${g.list.length === 2 ? 'twice' : g.list.length + ' times'}</div>
    <p class="muted small" style="margin:0 0 12px">${fmtSmart(g.list[0].cents)}/mo · drafted the ${ord(g.list[0].day)}. Remove the extra${g.list.length > 2 ? 's' : ''}? Nothing else changes.</p>
    <div class="btns two"><button class="btn small" style="width:100%" data-act="dupRemove" data-key="${esc(g.key)}">Remove extra</button><button class="btn small ghost" style="width:100%" data-act="dupKeep" data-key="${esc(g.key)}">Keep both</button></div></div>`).join('');
}
function dupRemove(key) {
  const g = dupGroups().find(x => x.key === key); if (!g) return;
  const keep = [...g.list].sort((x, y) => (x.startDate || '') < (y.startDate || '') ? -1 : (x.startDate || '') > (y.startDate || '') ? 1 : state.subs.indexOf(x) - state.subs.indexOf(y))[0];
  const drop = new Set(g.list.filter(s => s !== keep).map(s => s.id));
  state.subs = state.subs.filter(s => !drop.has(s.id)); save(); rerender();
  toast(`Removed ${drop.size} extra ${keep.name}`);
}
function dupKeep(key) { state.dupDismissed = (state.dupDismissed || []).concat(key); save(); rerender(); }
function renderHome() {
  const td = today(); const t = K.totals(state, td);
  const hasAny = state.subs.length || state.receipts.length;
  if (!hasAny) return `
    <div class="card hero"><div class="label">Money you didn't spend</div><div class="big">$0</div><div class="sub">Every bill you cancel and every dollar you save at the register — kept, counted, and added up.</div></div>
    <div class="card empty"><div class="emoji">👋</div><h3>Let's start your savings</h3><p>Cancelled a subscription? Saved money at the store? Add it and watch it grow.</p>
      <div class="btns"><button class="btn" data-act="addSub">＋ Add a cancelled subscription</button><button class="btn secondary" data-act="addReceipt">🧾 Add store savings</button><button class="btn ghost" data-act="demo">Try it with sample data</button></div></div>`;
  const next = K.upcoming(state.subs, td, 62);
  const gi = goalInfo(t);
  const firstEv = K.events(state, td)[0];
  const subsPct = t.all ? t.subs / t.all * 100 : 0;
  const yearOut = K.ymd(K.addMonths(K.parse(td), 12));
  const proj1y = t.all + K.projectSubs(state.subs, td, yearOut);
  const xmas = (() => { let y = K.parse(td).getFullYear(); let s = y + '-12-25'; if (s < td) s = (y + 1) + '-12-25'; return s; })();
  const projX = t.all + K.projectSubs(state.subs, td, xmas);
  const monthlySave = K.savingSubs(state.subs).filter(s => !s.stopDate || s.stopDate > td).reduce((a, s) => a + s.cents, 0);
  const monthlyTrack = K.trackSubs(state.subs).filter(s => !s.stopDate || s.stopDate > td).reduce((a, s) => a + s.cents, 0);
  return `${dupBannerHtml()}
  <div class="card hero">
    <div class="label">Total saved</div>
    <div class="big" id="bigTotal">${fmt(t.all)}</div>
    <div class="sub">${firstEv ? 'since ' + niceDate(firstEv.date) : 'Your first transfer is coming up'}${monthlySave ? ' · ' + fmtSmart(monthlySave) + '/mo into savings' : ''}</div>
    ${next.filter(u => K.subMode(u.sub)==='save')[0] ? `<div class="pill">⏭ Next save: ${fmtSmart(next.filter(u => K.subMode(u.sub)==='save')[0].cents)} on ${niceDate(next.filter(u => K.subMode(u.sub)==='save')[0].date)} · ${esc(next.filter(u => K.subMode(u.sub)==='save')[0].sub.name)}</div>` : ''}
  </div>
  ${K.trackSubs(state.subs).length ? `<div class="card" style="background:var(--bluebg);box-shadow:none">
    <div class="seg"><div><div class="muted small">👁 Not spent (tracked)</div><div style="font-size:28px;font-weight:800;color:var(--blue);letter-spacing:-.5px">${fmt(t.notSpent)}</div></div>
    <div class="muted small" style="text-align:right">Would've spent<br>${monthlyTrack ? fmtSmart(monthlyTrack) + '/mo' : '—'}</div></div>
    <p class="hint" style="margin:8px 0 0">${t.notSpent ? 'This is money you no longer pay — shown separately so it doesn\'t mix with Saved.' : 'Counting starts on the next draft day. Shown separately from Saved.'}</p>
  </div>` : ''}
  <div class="split">
    <a class="tile subs" href="#subs"><div class="k"><span class="dot subs"></span>Bills → Saved</div><div class="v">${fmt(t.subs, true)}</div><div class="s">${K.savingSubs(state.subs).length} item${K.savingSubs(state.subs).length === 1 ? '' : 's'}</div></a>
    <a class="tile rec" href="#receipts"><div class="k"><span class="dot rec"></span>Receipts</div><div class="v">${fmt(t.receipts, true)}</div><div class="s">${state.receipts.length} trip${state.receipts.length === 1 ? '' : 's'}</div></a>
  </div>
  ${t.all ? `<div class="card" style="padding:14px 18px"><div class="bar" style="margin:0"><i class="b1" style="width:${subsPct}%"></i><i class="b2" style="width:${100 - subsPct}%"></i></div><div class="legend"><span><span class="dot subs"></span> Bills ${Math.round(subsPct)}%</span><span><span class="dot rec"></span> Receipts ${Math.round(100 - subsPct)}%</span></div></div>` : ''}
  ${gi ? `<div class="card"><div class="goal-top"><div><div class="muted small">🎯 Goal</div><div class="goal-name">${esc(gi.g.name)}</div></div><div class="goal-pct">${gi.pct}%</div></div>
     <div class="bar"><i class="b1" style="width:${gi.pct}%;background:var(--green2)"></i></div>
     <div class="seg small"><span><b>${fmt(t.all, true)}</b> of ${fmt(gi.g.cents, true)} saved</span><span class="muted">${gi.daysLeft > 0 ? gi.daysLeft + ' days left' : gi.daysLeft === 0 ? 'Today!' : 'Ended ' + niceDate(gi.g.date)}</span></div>
     ${gi.daysLeft > 0 ? `<p class="small" style="margin:10px 0 0">${gi.withPace >= gi.g.cents ? `<span class="ok">✓ On track</span> — about <b>${fmt(gi.withPace, true)}</b> by ${niceDate(gi.g.date)}` : `<span class="warn">Projected ${fmt(gi.withPace, true)}</span> by ${niceDate(gi.g.date)} — ${fmt(gi.g.cents - gi.withPace, true)} short. One more cancelled bill could close the gap.`}</p>` : ''}
     <button class="btn small ghost" style="margin-top:12px" data-act="goal">Edit goal</button></div>`
    : `<div class="card"><h3>🎯 Set a goal</h3><p class="muted small" style="margin-top:-4px">Like a Christmas fund, a new truck down payment, or a family trip.</p><button class="btn secondary" data-act="goal">Set a goal</button></div>`}
  <div class="card chart"><h3>Growth over time</h3>${chartSVG(K.monthlySeries(state, td, 5, 6))}
    <div class="legend"><span>━ Saved so far</span><span>┅ Coming from bills set to Saved</span></div></div>
  <div class="card"><h3>Looking ahead</h3><div class="proj">
    <div><div class="k">By Christmas (${niceDate(xmas)})</div><div class="v">${fmt(projX, true)}</div></div>
    <div><div class="k">In 1 year</div><div class="v">${fmt(proj1y, true)}</div></div></div>
    <p class="hint">From bills set to Saved. Receipts come on top. Not-spent tracking is separate.</p></div>
  <div class="card"><div class="seg"><h3 style="margin:0">Upcoming</h3>${next.length > 4 ? '<button class="chip" data-act="upcoming">See all</button>' : ''}</div>
    ${next.length ? next.slice(0, 4).map(u => upRow(u)).join('') : '<p class="muted small">Nothing scheduled. Add a cancelled subscription to start.</p>'}</div>
  <div class="btns two"><button class="btn" data-act="addSub">＋ Bill</button><button class="btn secondary" data-act="addReceipt">＋ Receipt</button></div>`;
}
const upRow = u => { const m = K.subMode(u.sub); return `<div class="row"><div class="badge subs" style="${m==='track'?'background:var(--bluebg);color:var(--blue)':''}">${esc(u.sub.name[0] || '?').toUpperCase()}</div><div class="grow"><div class="t">${esc(u.sub.name)} ${modeBadge(m)}</div><div class="muted small">${niceDate(u.date)} · in ${K.daysBetween(today(), u.date)} day${K.daysBetween(today(), u.date) === 1 ? '' : 's'}</div></div><div class="amt" style="color:${m==='track'?'var(--blue)':'var(--green)'}">+${fmt(u.cents)}</div></div>`; };
function showAllUpcoming() {
  const list = K.upcoming(state.subs, today(), 92);
  openSheet(`<h3>Next 3 months</h3>${list.map(upRow).join('')}<div class="row"><div class="grow"><b>Total</b></div><div class="amt">${fmt(list.reduce((a, u) => a + u.cents, 0))}</div></div><button class="btn ghost" data-act="close" style="margin-top:12px">Done</button>`);
}
function chartSVG(pts) {
  const W = 340, H = 170, L = 8, R = 8, T = 16, B = 26;
  const max = Math.max(100, ...pts.map(p => p.cents)) * 1.1;
  const x = i => L + (pts.length === 1 ? (W - L - R) / 2 : i * (W - L - R) / (pts.length - 1));
  const y = c => T + (H - T - B) * (1 - c / max);
  const past = pts.map((p, i) => [i, p]).filter(([, p]) => !p.projected);
  const futr = pts.map((p, i) => [i, p]).filter(([, p], i) => p.projected || i === past.length - 1);
  const line = arr => arr.map(([i, p], k) => (k ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.cents).toFixed(1)).join(' ');
  const area = past.length ? line(past) + ` L${x(past[past.length - 1][0]).toFixed(1)} ${H - B} L${x(past[0][0]).toFixed(1)} ${H - B} Z` : '';
  const labels = pts.map((p, i) => { const m = +p.ym.slice(5) - 1; return `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="${p.projected ? '#9aa9a1' : '#5f6f67'}">${MONTHS[m][0]}${m === 0 ? "'" + p.ym.slice(2, 4) : ''}</text>`; }).join('');
  const lastPast = past[past.length - 1]; const lastF = futr[futr.length - 1];
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Savings over time">
    <defs><linearGradient id="g" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#14a06f" stop-opacity=".35"/><stop offset="1" stop-color="#14a06f" stop-opacity="0"/></linearGradient></defs>
    ${[0.25, 0.5, 0.75, 1].map(f => `<line x1="${L}" x2="${W - R}" y1="${y(max / 1.1 * f)}" y2="${y(max / 1.1 * f)}" stroke="#eef3f0"/>`).join('')}
    <path d="${area}" fill="url(#g)"/>
    ${futr.length > 1 ? `<path d="${line(futr)}" fill="none" stroke="#14a06f" stroke-width="2.5" stroke-dasharray="5 5" opacity=".6"/>` : ''}
    <path d="${line(past)}" fill="none" stroke="#0b6e4f" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
    ${lastPast ? `<circle cx="${x(lastPast[0])}" cy="${y(lastPast[1].cents)}" r="5" fill="#0b6e4f" stroke="#fff" stroke-width="2"/><text x="${Math.min(x(lastPast[0]), W - 40)}" y="${y(lastPast[1].cents) - 10}" font-size="11" font-weight="700" text-anchor="middle" fill="#0b6e4f">${fmt(lastPast[1].cents, true)}</text>` : ''}
    ${futr.length > 1 ? `<text x="${W - R}" y="${Math.max(12, y(lastF[1].cents) - 8)}" font-size="11" font-weight="700" text-anchor="end" fill="#14a06f">${fmt(lastF[1].cents, true)}</text>` : ''}
    ${labels}</svg>`;
}

/* ---------- subscriptions ---------- */
const SUB_PRESETS = [['Netflix', 15.49], ['Hulu', 17.99], ['Disney+', 13.99], ['Spotify', 11.99], ['Amazon Prime', 14.99], ['Sirius XM', 10.99], ['YouTube TV', 82.99], ['Gym', 40], ['Cable TV', 120], ['Apple', 9.99]];
function matchCancel(name) { return CD.match(ST.normalizeMerchant(name)) || CD.match(name); }
function modeLabel(m) {
  return m === 'track' ? 'Not spent' : m === 'log' ? 'Logged only' : 'Saved';
}
function modeBadge(m) {
  const mode = K.subMode({ mode: m });
  if (mode === 'track') return '<span class="freq" style="background:#e7efff;color:var(--blue)">Not spent</span>';
  if (mode === 'log') return '<span class="freq" style="background:#eee;color:#666">Logged</span>';
  return '<span class="freq">Saved</span>';
}
function pendingPayload(opts) {
  return {
    name: opts.name || '',
    cents: opts.cents != null && opts.cents !== '' ? +opts.cents : null,
    day: opts.day != null && opts.day !== '' ? +opts.day : null,
    catalogId: opts.catalogId || null,
    source: opts.source || '',
    findKey: opts.findKey || null,
    at: Date.now(),
  };
}
function rememberPending(p) {
  try { localStorage.setItem('kept.pendingCancel', JSON.stringify(p)); } catch (e) { }
}
function readPending() {
  try { const p = JSON.parse(localStorage.getItem('kept.pendingCancel') || 'null'); return p && p.name ? p : null; } catch (e) { return null; }
}
function clearPending() { try { localStorage.removeItem('kept.pendingCancel'); } catch (e) { } }
function cancelLinkHtml(entry, name, ctx) {
  ctx = ctx || {};
  if (!entry) entry = matchCancel(name);
  const label = entry ? entry.name : name;
  const cents = ctx.cents != null ? ctx.cents : '';
  const day = ctx.day != null ? ctx.day : '';
  const catalogId = entry ? entry.id : '';
  const data = ` data-cancel-name="${esc(label)}" data-cancel-cents="${cents}" data-cancel-day="${day}" data-cancel-catalog="${esc(catalogId)}" data-cancel-findkey="${esc(ctx.findKey || '')}" data-cancel-source="${esc(ctx.source || '')}"${ctx.billId ? ` data-cancel-bill="${esc(ctx.billId)}"` : ''}`;
  let html = '';
  if (entry && entry.cancelUrl) {
    html += `<a class="cancel-link" href="${esc(entry.cancelUrl)}" target="_blank" rel="noopener"${data}>🔗 Cancel / manage ${esc(entry.name)}</a>`;
    if (entry.altUrl) {
      const altLabel = /play\.google|vending|intent:/.test(entry.altUrl) ? 'Open in Play Store app' : /apps\.apple|itms-apps/.test(entry.altUrl) ? 'Open in App Store' : 'Open in app';
      html += ` <a class="cancel-link" style="margin-left:8px" href="${esc(entry.altUrl)}"${data}>${esc(altLabel)}</a>`;
    }
    if (entry.id === 'googleplay' || /play\.google/.test(entry.cancelUrl || '')) {
      html += `<div class="hint">If it times out, open the Play Store app first, then tap again.</div>`;
    }
    if (entry.note || entry.phone) html += `<div class="hint">${esc(entry.note || 'This one often needs a phone call or a visit.')}</div>`;
  } else {
    html += `<a class="cancel-link" href="${esc(CD.googleCancel(label))}" target="_blank" rel="noopener"${data}>🔍 Search how to cancel ${esc(label)}</a>`;
  }
  return html;
}
function renderSubs() {
  const td = today(); const t = K.totals(state, td);
  const items = state.subs.map(s => ({ s, p: K.subPaid(s, td), n: K.nextDraft(s, td), c: matchCancel(s.name), mode: K.subMode(s) }))
    .sort((a, b) => (b.mode === 'log' ? -1 : b.p.cents) - (a.mode === 'log' ? -1 : a.p.cents));
  const savedN = state.subs.filter(s => K.subMode(s) === 'save').length;
  const trackN = state.subs.filter(s => K.subMode(s) === 'track').length;
  return `<h2>Cancelled bills</h2>
  ${dupBannerHtml()}
  <div class="total-strip"><span class="muted">Saved from bills</span><b>${fmt(t.subs)}</b></div>
  ${K.trackSubs(state.subs).length ? `<div class="total-strip" style="margin-top:-8px"><span class="muted">Not spent (tracked)</span><b style="color:var(--blue)">${fmt(t.notSpent)}</b></div>` : ''}
  <div class="btns" style="margin-bottom:14px">
    <button class="btn" data-act="addSub">＋ Add a cancelled subscription</button>
    <a class="btn secondary" href="#find">🔎 Find subscriptions on a bank statement</a>
    <a class="btn ghost" href="#howto">📋 How to cancel a subscription</a>
  </div>
  ${items.length ? `<div class="card">${items.map(({ s, p, n, c, mode }) => `
    <div class="bill-row">
      <button class="listbtn" data-act="editSub" data-id="${s.id}" aria-label="Edit ${esc(s.name)}">
        <div class="badge ${mode === 'track' ? '' : 'subs'}" style="${mode === 'track' ? 'background:var(--bluebg);color:var(--blue)' : mode === 'log' ? 'background:#eee;color:#666' : ''}">${esc(s.name[0] || '?').toUpperCase()}</div>
        <div class="grow"><div class="t">${esc(s.name)}${s.demo ? ' <span class="muted small">(sample)</span>' : ''} ${modeBadge(mode)}</div>
        <div class="muted small">${s.cents ? fmtSmart(s.cents) + '/mo · ' : ''}drafted the ${ord(s.day)}</div>
        <div class="small">${mode === 'log' ? 'Listed only — not counting' : s.stopDate && s.stopDate <= td ? '⏸ Stopped ' + niceDate(s.stopDate) : n ? (mode === 'track' ? '⏭ Next count ' : '⏭ Next ') + niceDate(K.ymd(n)) : ''}</div>
        </div>
        <div><div class="amt" style="${mode === 'track' ? 'color:var(--blue)' : mode === 'log' ? 'color:#999' : ''}">${mode === 'log' ? '—' : fmt(p.cents)}</div>
        <div class="muted small" style="text-align:right">${mode === 'log' ? 'no total' : p.count + (mode === 'track' ? ' mo' : ' transfer' + (p.count === 1 ? '' : 's'))}</div></div>
      </button>
      <div class="bill-links">
        <button type="button" class="chip" data-act="editSub" data-id="${s.id}">✎ Edit / delete</button></div>
    </div>`).join('')}</div>
    <p class="hint">${savedN} saved · ${trackN} not-spent tracked · tap a bill to edit or delete it</p>`
    : `<div class="card empty"><div class="emoji">✂️</div><p>Cancelled Netflix, cable, a gym? Add it here — or upload a bank statement and we'll find subscriptions for you.</p></div>`}`;
}

function subForm(sub) {
  const isNew = !sub || !sub.id;
  if (!sub) sub = { name: '', cents: 0, day: K.parse(today()).getDate(), startDate: today(), mode: 'save' };
  else if (isNew) sub = Object.assign({ name: '', cents: 0, day: K.parse(today()).getDate(), startDate: today(), mode: 'save' }, sub);
  // else: keep the same object reference so edits write through to state.subs
  openSheet(`<div class="sheet-head"><h3>${isNew ? 'Cancelled subscription' : 'Edit ' + esc(sub.name)}</h3>${!isNew ? '<button type="button" class="chip danger-chip" id="delSubTop">🗑 Delete</button>' : ''}</div>
    <form id="subF">
    ${isNew ? `<div class="chips">${SUB_PRESETS.map(([n, a]) => `<button type="button" class="chip" data-n="${esc(n)}" data-a="${a}">${esc(n)}</button>`).join('')}</div>` : ''}
    <label class="f"><span>What did you cancel?</span><input name="name" required maxlength="40" placeholder="e.g. Netflix" value="${esc(sub.name)}" autocomplete="off"></label>
    <label class="f"><span>Monthly amount</span><div class="money"><input name="amt" inputmode="decimal" placeholder="0.00" value="${sub.cents ? (sub.cents / 100).toFixed(2) : ''}"></div></label>
    <label class="f"><span>Day of the month it used to come out</span><select name="day">${Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}" ${sub.day === i + 1 ? 'selected' : ''}>The ${ord(i + 1)}</option>`).join('')}</select>
      <div class="hint">In shorter months, we use the last day of the month.</div></label>
    <label class="f"><span>When did you cancel it?</span><input type="date" name="start" required value="${sub.startDate}" max="${today()}">
      <div class="hint">Counting starts on the first draft day on or after this date. Pick an earlier date to count past months.</div></label>
    <div class="f"><span class="lbl">What should Kept do with it?</span>
      <div class="mode-picks" role="radiogroup">
        <label class="mode-pick"><input type="radio" name="mode" value="save" ${K.subMode(sub)==='save'?'checked':''}><span class="mp-text"><b>Keep it going into savings</b><span class="hint">Counts toward your Saved total (like putting that money aside).</span></span></label>
        <label class="mode-pick"><input type="radio" name="mode" value="track" ${K.subMode(sub)==='track'?'checked':''}><span class="mp-text"><b>Just track what I would've spent</b><span class="hint">Shows under Not spent — not counted as Saved.</span></span></label>
        <label class="mode-pick"><input type="radio" name="mode" value="log" ${K.subMode(sub)==='log'?'checked':''}><span class="mp-text"><b>Just mark it cancelled</b><span class="hint">Listed only — no running total.</span></span></label>
      </div>
    </div>
    ${!isNew ? `<label class="f"><span>Stop counting after (optional)</span><input type="date" name="stop" value="${sub.stopDate || ''}"><div class="hint">Use this if you signed back up.</div></label>` : ''}
    <div id="subCancelHint"></div><div id="subPreview" class="ocr"></div>
    <div class="btns"><button class="btn" type="submit">${isNew ? 'Save' : 'Save changes'}</button>
    ${!isNew ? `<button class="btn danger" type="button" id="delSub">🗑 Delete this bill</button>` : ''}<button class="btn ghost" type="button" data-act="close">Cancel</button></div></form>`, sh => {
    const f = $('#subF', sh);
    const preview = () => {
      const mode = (f.querySelector('input[name=mode]:checked') || {}).value || 'save';
      const c = K.toCents(f.amt.value); const s = { cents: c, day: +f.day.value, startDate: f.start.value || today(), stopDate: f.stop && f.stop.value };
      if (mode === 'log') { $('#subPreview').innerHTML = 'Listed only — no running total. You can switch it to Saved or Not spent any time.'; return; }
      if (!c) { $('#subPreview').innerHTML = 'Enter the monthly amount to see what it adds up to.'; return; }
      const p = K.subPaid(s, today()); const n = K.nextDraft(s, today()); const yr = K.projectSubs([s], today(), K.ymd(K.addMonths(K.parse(today()), 12)));
      $('#subPreview').innerHTML = mode === 'track'
        ? `${p.count ? `Already counted as not spent: <b>${fmt(p.cents)}</b> (${p.count} month${p.count === 1 ? '' : 's'}).<br>` : ''}${n ? `Next count: <b>${fmt(c)}</b> on ${niceDate(K.ymd(n))}.<br>` : ''}That's <b>${fmt(yr, true)}</b> you won't spend over the next year (not counted as Saved).`
        : `${p.count ? `Already kept: <b>${fmt(p.cents)}</b> (${p.count} month${p.count === 1 ? '' : 's'}).<br>` : ''}${n ? `Next transfer: <b>${fmt(c)}</b> on ${niceDate(K.ymd(n))}.<br>` : ''}That's <b>${fmt(yr, true)}</b> more over the next year.`;
    };
    const cancelHint = () => { }; // cancel links live only in the statement finder + How to cancel directory
    f.addEventListener('input', () => { preview(); cancelHint(); }); preview(); cancelHint();
    const syncMode = () => $$('.mode-pick', f).forEach(p => p.classList.toggle('on', !!(p.querySelector('input')||{}).checked));
    f.querySelectorAll('input[name=mode]').forEach(r => r.addEventListener('change', () => { syncMode(); preview(); })); syncMode();
    $$('.chip', f).forEach(ch => ch.addEventListener('click', () => { $$('.chip', f).forEach(c => c.classList.remove('on')); ch.classList.add('on'); f.name.value = ch.dataset.n; if (!f.amt.value) f.amt.value = (+ch.dataset.a).toFixed(2); preview(); }));
    let busy = false;
    f.addEventListener('submit', async e => {
      e.preventDefault(); if (busy) return; busy = true;
      const btns = $$('button', f); btns.forEach(b => b.disabled = true);
      const done = () => { busy = false; btns.forEach(b => b.disabled = false); };
      const mode = (f.querySelector('input[name=mode]:checked') || {}).value || 'save';
      const c = K.toCents(f.amt.value); const name = f.name.value.trim();
      if (!name) { toast('Enter what you cancelled'); return done(); }
      if (mode !== 'log' && c <= 0) { toast('Enter the monthly amount'); return done(); }
      const vals = { name, cents: c || 0, day: +f.day.value, startDate: f.start.value, stopDate: f.stop && f.stop.value ? f.stop.value : undefined, mode };
      const pend = readPending(); if (pend && pend.name.trim().toLowerCase() === name.toLowerCase()) clearPending();
      if (isNew) {
        const same = findSameBill(vals.name, vals.cents, vals.day);
        if (same) {
          const ch = await inlineAsk(sh, `You already have <b>${esc(same.name)}</b> (${fmtSmart(same.cents)}/mo, the ${ord(same.day)}). Update it instead?`, [['update', 'Update existing', ''], ['add', 'Add another anyway', 'ghost'], ['back', 'Go back', 'ghost']]);
          if (ch === 'back') return done();
          if (ch === 'update') { same.mode = vals.mode; if (vals.stopDate) same.stopDate = vals.stopDate; save(); /* keep its name + start date so nothing already kept is lost */ closeSheet(); rerender(); toast(`Updated ${same.name}`); return; }
        }
      }
      Object.assign(sub, vals);
      if (isNew) { sub.id = uid(); state.subs.push(sub); if (sub._fromFind) { if (!state.ignoredMerchants.includes(sub._fromFind)) state.ignoredMerchants.push(sub._fromFind); delete sub._fromFind; } } delete sub.demo; save(); closeSheet(); rerender();
      toast(isNew ? (mode === 'save' ? `${sub.name} — keeping ${fmtSmart(c)}/mo in savings` : mode === 'track' ? `${sub.name} — tracking as not spent` : `${sub.name} marked cancelled`) : 'Saved');
    });
    const askDelete = async () => {
      const total = K.subPaid(sub, today()).cents;
      const ch = await inlineAsk(sh, `Delete <b>${esc(sub.name)}</b>?${total && K.subMode(sub) !== 'log' ? ` Its ${fmt(total)} will come off your ${K.subMode(sub) === 'track' ? 'Not spent' : 'Saved'} total.` : ''} This can't be undone.`, [['yes', 'Yes, delete it', 'danger'], ['no', 'Keep it', 'ghost']]);
      if (ch !== 'yes') return;
      state.subs = state.subs.filter(s => s.id !== sub.id); save(); closeSheet(); rerender(); toast(`Deleted ${sub.name}`);
    };
    const del = $('#delSub', sh); if (del) del.addEventListener('click', askDelete);
    const delTop = $('#delSubTop', sh); if (delTop) delTop.addEventListener('click', askDelete);
  });
}

/* ---------- receipts ---------- */
const STORES = ['Walmart', 'Kroger', 'Target', 'Home Depot', "Lowe's", 'Dollar General', 'Publix', 'Aldi', 'Costco', 'Food City'];
function renderReceipts() {
  const t = K.totals(state, today());
  const items = [...state.receipts].sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
  return `<h2>Receipt savings</h2>
  <div class="total-strip"><span class="muted">Saved at the register</span><b>${fmt(t.receipts)}</b></div>
  <button class="btn" data-act="addReceipt" style="margin-bottom:14px">📷 Add store savings</button>
  ${items.length ? `<div class="card">${items.map(r => `
    <button class="listbtn row" data-act="editReceipt" data-id="${r.id}">${r.photo ? `<img class="thumb" data-photo="${r.id}" alt="">` : '<div class="badge rec">🧾</div>'}
      <div class="grow"><div class="t">${esc(r.store)}${r.demo ? ' <span class="muted small">(sample)</span>' : ''}</div><div class="muted small">${niceDate(r.date)}${r.note ? ' · ' + esc(r.note) : ''}</div></div>
      <div class="amt" style="color:#b77400">${fmt(r.cents)}</div></button>`).join('')}</div>`
    : `<div class="card empty"><div class="emoji">🧾</div><p>Receipt says "You saved $78"? Snap a photo and log it. Coupons, sales and rollbacks all count.</p></div>`}`;
}
function receiptForm(rec) {
  const isNew = !rec; rec = rec || { store: '', cents: 0, date: today(), note: '' };
  let photoBlob = null, photoChanged = false, removePhoto = false;
  openSheet(`<h3>${isNew ? 'Store savings' : 'Edit receipt'}</h3>
  <form id="recF">
    <div class="photo-box" id="photoBox">
      <div id="photoPrev"></div>
      <div class="btns two"><button type="button" class="btn small secondary" id="camBtn" style="width:100%">📷 Take photo</button><button type="button" class="btn small ghost" id="libBtn" style="width:100%">🖼 Choose</button></div>
      <input type="file" accept="image/*" capture="environment" id="camIn" hidden><input type="file" accept="image/*" id="libIn" hidden>
      <div class="hint">Optional. We'll try to read the "You saved" amount for you.</div>
    </div>
    <div id="ocrBox" class="ocr" hidden></div>
    <label class="f"><span>Store</span><input name="store" required maxlength="40" placeholder="e.g. Walmart" value="${esc(rec.store)}" list="storeList" autocomplete="off"></label>
    <div class="chips">${STORES.slice(0, 6).map(s => `<button type="button" class="chip ${rec.store === s ? 'on' : ''}" data-s="${esc(s)}">${esc(s)}</button>`).join('')}</div>
    <label class="f"><span>Amount you saved</span><div class="money"><input name="amt" required inputmode="decimal" placeholder="0.00" value="${rec.cents ? (rec.cents / 100).toFixed(2) : ''}"></div></label>
    <label class="f"><span>Date</span><input type="date" name="date" required value="${rec.date}" max="${today()}"></label>
    <label class="f"><span>Note (optional)</span><input name="note" maxlength="60" placeholder="e.g. Rollbacks + coupons" value="${esc(rec.note || '')}"></label>
    <div class="btns"><button class="btn" type="submit">${isNew ? 'Add to savings' : 'Save changes'}</button>
    ${!isNew ? '<button class="btn danger" type="button" id="delRec">🗑 Delete this receipt</button>' : ''}<button class="btn ghost" type="button" data-act="close">Cancel</button></div>
  </form>`, async sh => {
    const f = $('#recF', sh);
    const showPhoto = url => { $('#photoPrev').innerHTML = url ? `<img src="${url}" alt="Receipt photo"><button type="button" class="chip" id="rmPhoto">Remove photo</button>` : ''; const rm = $('#rmPhoto'); if (rm) rm.onclick = () => { photoBlob = null; photoChanged = true; removePhoto = true; showPhoto(null); }; };
    if (rec.photo) showPhoto(await Photos.url(rec.id));
    $$('.chip[data-s]', f).forEach(ch => ch.addEventListener('click', () => { $$('.chip[data-s]', f).forEach(c => c.classList.remove('on')); ch.classList.add('on'); f.store.value = ch.dataset.s; }));
    $('#camBtn').onclick = () => $('#camIn').click(); $('#libBtn').onclick = () => $('#libIn').click();
    const onFile = async e => {
      const file = e.target.files[0]; if (!file) return;
      try { photoBlob = await shrink(file, 1600, 0.82); } catch (err) { photoBlob = file; }
      photoChanged = true; removePhoto = false; showPhoto(URL.createObjectURL(photoBlob));
      runOCR(photoBlob, f);
    };
    $('#camIn').onchange = onFile; $('#libIn').onchange = onFile;
    f.addEventListener('submit', async e => {
      e.preventDefault(); const c = K.toCents(f.amt.value);
      if (c <= 0) { toast('Enter how much you saved'); return; }
      Object.assign(rec, { store: f.store.value.trim(), cents: c, date: f.date.value, note: f.note.value.trim() });
      if (isNew) { rec.id = uid(); state.receipts.push(rec); } delete rec.demo;
      if (photoChanged) { if (photoBlob) { await Photos.put(rec.id, photoBlob); rec.photo = true; } else if (removePhoto) { await Photos.del(rec.id); rec.photo = false; } }
      save(); closeSheet(); rerender(); toast(isNew ? `${fmt(c)} saved at ${rec.store} 🎉` : 'Saved');
    });
    const del = $('#delRec', sh); if (del) del.addEventListener('click', async () => {
      const ch = await inlineAsk(sh, `Delete this <b>${esc(rec.store)}</b> receipt (${fmt(rec.cents)})? This can't be undone.`, [['yes', 'Yes, delete it', 'danger'], ['no', 'Keep it', 'ghost']]);
      if (ch !== 'yes') return;
      state.receipts = state.receipts.filter(r => r.id !== rec.id); await Photos.del(rec.id).catch(() => { }); save(); closeSheet(); rerender(); toast('Receipt deleted');
    });
  });
}
function shrink(file, max, q) {
  return new Promise((res, rej) => {
    const img = new Image(); const u = URL.createObjectURL(file);
    img.onload = () => { const s = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u); c.toBlob(b => b ? res(b) : rej(new Error('encode')), 'image/jpeg', q); };
    img.onerror = rej; img.src = u;
  });
}
let tessP;
function loadTesseract() { return tessP || (tessP = new Promise((res, rej) => { if (window.Tesseract) return res(window.Tesseract); const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js'; s.onload = () => res(window.Tesseract); s.onerror = () => { tessP = null; rej(new Error('offline')); }; document.head.appendChild(s); })); }
async function runOCR(blob, f) {
  const box = $('#ocrBox'); box.hidden = false;
  box.innerHTML = '🔎 Reading your receipt… <span id="ocrPct">starting</span><div class="progress"><i id="ocrBar"></i></div><div class="hint">First time takes a bit longer (downloads the reader).</div>';
  try {
    const T = await loadTesseract();
    const worker = await T.createWorker('eng', 1, { logger: m => { if (m.status === 'recognizing text') { const p = Math.round(m.progress * 100); const b = $('#ocrBar'); if (b) { b.style.width = p + '%'; $('#ocrPct').textContent = p + '%'; } } } });
    const { data } = await worker.recognize(blob); await worker.terminate();
    if (!document.body.contains(box)) return;
    const r = K.findSavings(data.text);
    const storeGuess = STORES.find(s => new RegExp(s.replace(/'/g, "'?").replace(/\s/g, '\\s*'), 'i').test(data.text));
    if (storeGuess && !f.store.value) f.store.value = storeGuess;
    if (r.best) { f.amt.value = (r.best / 100).toFixed(2); box.innerHTML = `✅ Found <b>${fmt(r.best)}</b> saved — filled in below. Check it and fix if needed.`; }
    else box.innerHTML = r.candidates.length ? `Couldn't spot "You saved" for sure. Tap the right amount, or type it in:` : `Couldn't read an amount from this photo — just type it in below.`;
    if (r.candidates.length) { const chips = document.createElement('div'); chips.className = 'chips'; chips.style.marginTop = '8px'; chips.innerHTML = r.candidates.map(c => `<button type="button" class="chip ${c === r.best ? 'on' : ''}" data-c="${c}">${fmt(c)}</button>`).join(''); box.appendChild(chips);
      $$('.chip', chips).forEach(ch => ch.onclick = () => { $$('.chip', chips).forEach(x => x.classList.remove('on')); ch.classList.add('on'); f.amt.value = (ch.dataset.c / 100).toFixed(2); }); }
  } catch (err) { box.innerHTML = 'Photo saved. (Auto-reading needs an internet connection the first time.) Type the amount below.'; }
}

/* ---------- goal ---------- */
function goalForm() {
  const g = state.goal || { name: 'Christmas fund', cents: 100000, date: (() => { const td = today(); const y = +td.slice(0, 4); return (td > y + '-12-25' ? y + 1 : y) + '-12-25'; })() };
  openSheet(`<h3>🎯 Savings goal</h3><form id="goalF">
    <label class="f"><span>Goal name</span><input name="name" required maxlength="40" value="${esc(g.name)}"></label>
    <label class="f"><span>Target amount</span><div class="money"><input name="amt" required inputmode="decimal" value="${(g.cents / 100).toFixed(0)}"></div></label>
    <label class="f"><span>By when?</span><input type="date" name="date" required value="${g.date}"></label>
    <div class="btns"><button class="btn" type="submit">Save goal</button>${state.goal ? '<button class="btn danger" type="button" id="delGoal">Remove goal</button>' : ''}<button class="btn ghost" type="button" data-act="close">Cancel</button></div></form>`, sh => {
    const f = $('#goalF', sh);
    f.addEventListener('submit', e => { e.preventDefault(); const c = K.toCents(f.amt.value); if (c <= 0) return toast('Enter a target amount'); state.goal = { name: f.name.value.trim(), cents: c, date: f.date.value }; save(); closeSheet(); rerender(); toast('Goal saved'); });
    const d = $('#delGoal', sh); if (d) d.onclick = () => { state.goal = null; save(); closeSheet(); rerender(); };
  });
}


/* ---------- find subscriptions from statement ---------- */
function freqLabel(f) { return ({ daily: 'Daily', weekly: 'Weekly', biweekly: 'Every 2 weeks', monthly: 'Monthly', bimonthly: 'Every 2 months', quarterly: 'Every 3 months', yearly: 'Yearly' })[f] || f; }
function alreadySaving(found) {
  return state.subs.some(s => {
    const c = found.monthlyCents || found.typicalCents;
    if (Math.abs(s.cents - c) > 200 && Math.abs(s.cents - c) / c > 0.15 && Math.abs(s.cents - found.typicalCents) > 200) return false;
    const a = ST.normalizeMerchant(s.name), b = found.label;
    return a.includes(b.split(' ')[0]) || b.includes(a.split(' ')[0]) || (matchCancel(s.name) && matchCancel(found.label) && matchCancel(s.name).id === matchCancel(found.label).id);
  });
}
const shortDate = d => { const x = K.parse(d); return x.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
const longDate = d => { const x = K.parse(d); return x.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };
const SKIP_LABEL = { check: 'check — skipped', credit: 'deposit — skipped', transfer: 'transfer — skipped', atm: 'ATM — skipped', p2p: 'Zelle/Venmo — skipped', cardpay: 'card payment — skipped', other: 'loan/insurance/utility', spend: '' };
function sessionTxs() { const lists = findFiles.filter(f => f.txs && f.txs.length).map(f => f.txs); const bt = bankTxs(); if (bt.length) lists.unshift(bt); return ST.mergeTransactions(lists); }
function renderFind() {
  const ignored = new Set(state.ignoredMerchants || []);
  const bank = getBank(); const hasSrc = findFiles.length || (bank && bankTxs().length);
  const all = hasSrc ? sessionTxs() : [];
  const range = ST.dateRange(all);
  const ok = findFiles.filter(f => !f.error).length + (bank ? 1 : 0);
  return `<h2>Find subscriptions</h2>
  ${bankPanelHtml('find')}
  <div class="card"><p style="margin-top:0">${bank ? '<b>Have a credit card too?</b> Add its statements and we\'ll check them together with your bank.' : '<b>Or add your statements</b> — ideally <b>3 months</b> (for example July, August and September) of bank or credit-card statements.'} Statement files are read <b>entirely on this phone</b> — nothing is uploaded.</p>
    <div class="drop">
      <div style="font-size:36px">📄</div>
      <strong>${findFiles.length ? 'Add another statement' : 'Add your statements'}</strong>
      <div class="muted small">PDF statements work · CSV/OFX/QFX too<br>You can pick several files at once, or add them one at a time.</div>
      <button class="btn" data-act="pickStatement" style="margin-top:12px">${findFiles.length ? '＋ Add another statement' : 'Choose statement files'}</button>
    </div>
    <div class="tipbox">💡 <b>Tip:</b> if your bank's website has <b>"Export transactions"</b>, <b>"Download CSV"</b> or a <b>Quicken (QFX)</b> download, use that for 3 months — it's even more reliable than PDF statements.</div>
    ${findFiles.length ? '' : '<button class="btn ghost" data-act="useSampleStmt">Try with a sample statement</button>'}
  </div>
  <div id="findStatus">${findStatusHtml}</div>
  ${hasSrc || findFiles.length ? `<div class="card" id="findSession">
    <div class="sess-title">${bank ? 'What we\'re checking' : 'Your statements'}</div>
    ${bank ? `<div class="sess-file"><div class="grow"><div class="t">🏦 ${esc(bank.institution && bank.institution.name || 'Linked bank')}${bank.mode === 'demo' ? ' <span class="conf">DEMO</span>' : ''}</div>
      <div class="muted small">${bankTxs().length} transactions${bank.range ? ` · ${shortDate(bank.range.from)} – ${shortDate(bank.range.to)}` : ''} · linked bank${bank.mode === 'demo' ? ' (fake test data)' : ''}</div></div></div>` : ''}
    ${findFiles.map(f => `<div class="sess-file ${f.error ? 'bad' : ''}">
      <div class="grow"><div class="t">${f.error ? '⚠️' : '✓'} ${esc(f.name)}</div>
      <div class="muted small">${f.error ? esc(f.error) : `${f.txs.length} transactions · ${f.range ? shortDate(f.range.from) + ' – ' + shortDate(f.range.to) : ''} · ${({ pdf: 'PDF', csv: 'CSV', ofx: 'OFX/QFX', text: 'text' })[f.format] || f.format}`}</div></div>
      <button class="iconbtn" data-act="removeStmt" data-id="${f.id}" aria-label="Remove ${esc(f.name)}">✕</button></div>`).join('')}
    ${range ? `<div class="sess-sum">We read <b>${all.length} transactions</b> from <b>${longDate(range.from)}</b> to <b>${longDate(range.to)}</b> (${range.days} days${ok.length > 1 ? ', duplicates between statements removed' : ''}).</div>
    ${range.days < 60 ? `<div class="tipbox warn">📅 That's under 2 months. <b>Add more months for better results</b> — a monthly bill has to show up at least twice before we can spot it.</div>` : ''}
    <div class="muted small" style="margin:10px 0 4px">Does this look right? A few of the transactions we read:</div>
    <div class="preview">${previewRows(all).map(t => `<div class="pv"><span class="d">${shortDate(t.date)}</span><span class="n">${esc(t.desc.slice(0, 48))}${SKIP_LABEL[ST.classify(t)] ? `<em>${SKIP_LABEL[ST.classify(t)]}</em>` : ''}</span><span class="a ${t.cents > 0 ? 'in' : ''}">${t.cents > 0 ? '+' : '−'}${fmt(Math.abs(t.cents))}</span></div>`).join('')}</div>
    <div class="btns" style="margin-top:14px"><button class="btn" data-act="runFind">🔎 Find subscriptions</button>
    ${findFiles.length ? '<button class="btn ghost small" data-act="clearStmts">Remove statements</button>' : ''}</div>` : `<div class="btns" style="margin-top:12px"><button class="btn ghost small" data-act="clearStmts">Start over</button></div>`}
  </div>` : ''}
  ${findCache ? renderFindResults(findCache, ignored) : ''}
  <details class="paste-box"><summary>Upload not working? Paste statement text instead</summary>
    <p class="hint">Open the statement on your bank's site, select the transactions, copy, and paste here.</p>
    <textarea id="stmtPaste" rows="6" placeholder="07/06  NETFLIX.COM  15.49&#10;07/10  KARAFUN  10.99"></textarea>
    <button class="btn secondary" data-act="pasteStmt" style="margin-top:10px">Add pasted text</button>
  </details>`;
}
function previewRows(all) {
  if (all.length <= 5) return all;
  const debits = all.filter(t => t.cents < 0); const pick = [];
  const src = debits.length >= 4 ? debits : all;
  for (let i = 0; i < 4; i++) pick.push(src[Math.floor(i * (src.length - 1) / 3)]);
  const other = all.find(t => !pick.includes(t) && ST.classify(t) !== 'spend'); pick.push(other || all[all.length - 1]);
  return [...new Set(pick)].sort((a, b) => a.date < b.date ? -1 : 1).slice(0, 5);
}
function findCardHtml(f, kind) {
  const cat = matchCancel(f.label) || (f.catalogId ? CD.byId(f.catalogId) : null);
  const name = cat ? cat.name : titleCase(f.label);
  const saving = alreadySaving(f);
  const perMo = f.frequency !== 'monthly' && f.monthlyCents ? ` <span class="muted small">≈ ${fmt(f.monthlyCents)}/mo</span>` : '';
  return `<div class="find-card ${kind === 'other' ? 'other' : ''}" data-key="${esc(f.key)}">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><h4>${esc(name)}</h4>${f.confidence === 'high' ? '<span class="conf hi">Very likely</span>' : '<span class="conf">Possible</span>'}</div>
      <div class="muted small">${esc(f.label)}</div>
      <div style="margin:8px 0;display:flex;flex-wrap:wrap;gap:8px;align-items:center">
        <span class="freq">${freqLabel(f.frequency)}</span><b>${fmt(f.typicalCents)}</b>${perMo}
        <span class="muted small">${f.frequency === 'monthly' || f.frequency === 'quarterly' || f.frequency === 'yearly' ? 'usually the ' + ord(f.day) + ' · ' : ''}seen ${f.count}× · last ${shortDate(f.lastDate)}</span>
        ${f.reasons && f.reasons.includes('may have stopped') ? '<span class="muted small">· may have stopped already</span>' : ''}
      </div>
      ${kind === 'other' ? `<div class="find-actions"><button class="btn ghost small" data-act="ignoreFound" data-key="${esc(f.key)}">Hide</button></div>` : `
      <div class="find-actions">
        ${saving ? `<div class="ocr">✓ Already in your cancelled bills</div>` : `<button class="btn" data-act="startSavingFound" data-key="${esc(f.key)}">✓ I cancelled it — start saving</button>`}
        ${cat && cat.cancelUrl
      ? `<a class="btn secondary cancel-link" href="${esc(cat.cancelUrl)}" target="_blank" rel="noopener" data-cancel-name="${esc(name)}" data-cancel-cents="${f.monthlyCents || f.typicalCents}" data-cancel-day="${f.day}" data-cancel-catalog="${esc(cat.id)}" data-cancel-findkey="${esc(f.key)}" data-cancel-source="find">Open cancel page</a>`
        + (cat.altUrl ? `<a class="btn ghost cancel-link" href="${esc(cat.altUrl)}" data-cancel-name="${esc(name)}" data-cancel-cents="${f.monthlyCents || f.typicalCents}" data-cancel-day="${f.day}" data-cancel-catalog="${esc(cat.id)}" data-cancel-findkey="${esc(f.key)}" data-cancel-source="find">${/play\.google|vending|intent:/.test(cat.altUrl) ? 'Open in Play Store app' : 'Open in app'}</a>` : '')
        + (cat.id === 'googleplay' ? `<div class="hint">If it times out, open the Play Store app first, then tap again.</div>` : '')
      : `<a class="btn secondary cancel-link" href="${esc(CD.googleCancel(name))}" target="_blank" rel="noopener" data-cancel-name="${esc(name)}" data-cancel-cents="${f.monthlyCents || f.typicalCents}" data-cancel-day="${f.day}" data-cancel-findkey="${esc(f.key)}" data-cancel-source="find">Search how to cancel</a>`}
        <button class="btn ghost" data-act="ignoreFound" data-key="${esc(f.key)}">Not a subscription / ignore</button>
      </div>`}
    </div>`;
}
function renderFindResults(res, ignored) {
  const found = res.found.filter(f => !ignored.has(f.key));
  const other = res.other.filter(f => !ignored.has(f.key));
  const hi = found.filter(f => f.confidence === 'high'), maybe = found.filter(f => f.confidence !== 'high');
  const ex = res.excluded; const skipped = [[ex.check, 'check'], [ex.credit, 'deposit'], [ex.transfer, 'transfer'], [ex.atm, 'ATM withdrawal'], [ex.p2p, 'Zelle/Venmo payment'], [ex.cardpay, 'credit-card payment']].filter(x => x[0]).map(([n, w]) => `${n} ${w}${n === 1 ? '' : 's'}`);
  return `<div id="findResults">
  <div class="total-strip"><span class="muted">Repeating charges found</span><b>${found.length}</b></div>
  <p class="hint" style="margin-top:-6px">Looked at ${res.debitCount} purchases &amp; bills from ${longDate(res.range.from)} to ${longDate(res.range.to)}.${skipped.length ? ` Skipped ${skipped.join(', ')}.` : ''}</p>
  ${getBank() && getBank().mode === 'demo' ? `<div class="tipbox warn">🧪 These results include the <b>DEMO bank's made-up transactions</b> — not your real spending.</div>` : ''}
  ${res.range.days < 60 ? `<div class="tipbox warn">📅 Only ${res.range.days} days of history — <b>add more months for better results</b>.</div>` : ''}
  ${!found.length ? `<div class="card empty"><div class="emoji">🤔</div><p>No repeating subscriptions found${res.range.days < 60 ? ' yet — add another month or two' : ''}.</p></div>` : ''}
  ${hi.length ? `<h3 class="find-h">Very likely subscriptions</h3>${hi.map(f => findCardHtml(f)).join('')}` : ''}
  ${maybe.length ? `<h3 class="find-h">Possible — take a look</h3>${maybe.map(f => findCardHtml(f)).join('')}` : ''}
  ${other.length ? `<h3 class="find-h">Other repeating payments</h3><p class="hint" style="margin-top:-4px">Loans, insurance and utilities — real bills, shown so nothing's missed.</p>${other.map(f => findCardHtml(f, 'other')).join('')}` : ''}
  </div>`;
}
function titleCase(s) { return String(s || '').toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase()); }
async function extractPdfText(file) {
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.map(it => ({ str: it.str || '', x: it.transform[4], y: it.transform[5], w: it.width || 0, h: it.height || Math.abs(it.transform[3]) || 10 })));
  }
  return { pages };   // statement.js rebuilds rows/columns from these positions
}
let pdfP;
function loadPdfJs() {
  return pdfP || (pdfP = new Promise((res, rej) => {
    if (window.pdfjsLib) return res(window.pdfjsLib);
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.min.mjs';
    // classic build is easier without modules:
    s.onerror = () => {
      const s2 = document.createElement('script');
      s2.src = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
      s2.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js'; res(window.pdfjsLib); };
      s2.onerror = () => { pdfP = null; rej(new Error('pdf.js')); }; document.head.appendChild(s2);
    };
    // try umd first via non-module
    s.remove(); const s2 = document.createElement('script');
    s2.src = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
    s2.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js'; res(window.pdfjsLib); };
    s2.onerror = () => { pdfP = null; rej(new Error('pdf.js')); };
    document.head.appendChild(s2);
  }));
}
function setFindStatus(html) { findStatusHtml = html; const el = $('#findStatus'); if (el) el.innerHTML = html; }
function readErrorText(err) {
  return err.code === 'scanned-pdf' ? `Looks like a scanned picture — no text to read. Try your bank's "Export"/CSV download, or paste the text below.`
    : err.code === 'spreadsheet' ? `Excel file — choose CSV in your bank's download options instead.`
    : err.code === 'empty' ? `File is empty (0 KB) — download it again.`
    : /pdf\.js/.test(err.message || '') ? `Couldn't load the PDF reader (needs internet the first time).`
    : `Couldn't read this file.`;
}
function addParsed(name, parsed) {
  const txs = (parsed.transactions || []).map(t => ({ date: t.date, cents: t.cents, desc: t.desc, memo: t.memo || '', type: t.type || '', checkNo: t.checkNo || '' }));
  const entry = { id: uid(), name, format: parsed.format, txs, range: ST.dateRange(txs) };
  if (!txs.length) entry.error = parsed.format === 'pdf' ? `No transactions found in this PDF. If it's a summary page or scanned, try your bank's "Export transactions" (CSV) or paste the text below.` : 'No transactions found in this file.';
  findFiles.push(entry); saveFindFiles(); return entry;
}
/** Read one or more files into the session. Auto-runs detection once there are ~2 months of history. */
async function processStatementFiles(files) {
  files = Array.from(files || []); if (!files.length) return;
  findCache = null;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    setFindStatus(`<div class="card ocr">🔎 Reading <b>${esc(file.name || 'your file')}</b>${files.length > 1 ? ` (${i + 1} of ${files.length})` : ''} on your phone…</div>`);
    try {
      if (!file.size) throw Object.assign(new Error('empty'), { code: 'empty' });
      const parsed = await ST.parseFile(file, extractPdfText);
      addParsed(file.name || 'statement', parsed);
    } catch (err) {
      console.error(err);
      findFiles.push({ id: uid(), name: file.name || 'statement', format: '', txs: [], error: readErrorText(err) }); saveFindFiles();
    }
  }
  afterFilesChanged(true);
}
const processStatementFile = f => processStatementFiles([f]);
function afterFilesChanged(maybeAuto) {
  const all = sessionTxs(); const range = ST.dateRange(all);
  const good = findFiles.filter(f => !f.error).length, bad = findFiles.filter(f => f.error).length;
  if (!all.length) { setFindStatus(bad ? `<div class="card status-err"><b>We couldn't find transactions in that file.</b> See the note under the file name below.</div>` : ''); findCache = null; rerender(); return; }
  setFindStatus(`<div class="card status-ok">✅ ${good} statement${good === 1 ? '' : 's'} added — <b>${all.length} transactions</b>, ${longDate(range.from)} to ${longDate(range.to)}.${bad ? ` ${bad} file${bad === 1 ? '' : 's'} couldn't be read.` : ''}</div>`);
  if (maybeAuto && range.days >= 55) { runFind(true); return; }
  rerender();
  if (range.days < 55) toast('Added — add more months, then tap Find subscriptions');
}
function runFind(auto) {
  const all = sessionTxs(); if (!all.length) { toast('Add a statement first'); return; }
  findCache = ST.analyze(all);
  rerender();
  const n = findCache.found.length;
  toast(n ? `Found ${n} repeating charge${n === 1 ? '' : 's'}` : 'No subscriptions found yet');
  const r = document.getElementById('findResults'); if (r && !auto) r.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function removeStmt(id) { findFiles = findFiles.filter(f => f.id !== id); saveFindFiles(); findCache = null; findStatusHtml = ''; afterFilesChanged(false); }
function clearStmts() { findFiles = []; saveFindFiles(); findCache = null; findStatusHtml = ''; rerender(); }
function pasteStmt() {
  const ta = $('#stmtPaste'); const text = ta ? ta.value : '';
  if (!text.trim()) { toast('Paste your statement text first'); return; }
  try { const parsed = ST.parseText(text, ''); findCache = null; addParsed('Pasted text', parsed); afterFilesChanged(true); }
  catch (e) { setFindStatus(`<div class="card status-err">Couldn't read that text. Each line needs a date, a description, and an amount.</div>`); }
}
async function useSampleStmt() {
  try {
    const res = await fetch('samples/sample-statement.csv');
    const file = new File([await res.blob()], 'sample-statement.csv', { type: 'text/csv' });
    await processStatementFiles([file]);
  } catch (e) { toast('Could not load sample'); }
}
function ignoreFound(key) {
  if (!key) return;
  if (!state.ignoredMerchants.includes(key)) state.ignoredMerchants.push(key);
  save(); rerender(); toast('Ignored — hide it from future scans too');
}
function clearIgnored() { state.ignoredMerchants = []; save(); rerender(); toast('Ignored list cleared'); }
function startSavingFound(key) {
  const f = findCache && findCache.found.find(x => x.key === key); if (!f) return;
  const monthly = f.monthlyCents || f.typicalCents;
  const cat = matchCancel(f.label);
  const name = cat ? cat.name : titleCase(f.label).slice(0, 40);
  // Prefill cancelled-bill form
  subForm({ name, cents: monthly, day: f.day, startDate: today(), _fromFind: key });
}

/* ---------- cancel directory ---------- */
function renderHowto() {
  return `<h2>How to cancel</h2>
  <div class="howto-note">Links go to each company's official cancel or account page when we know it. <b>Some services (gyms, cable) still make you call or visit.</b> If a link asks you to sign in, that's normal — canceling happens on their site, not in ${APP_NAME}.</div>
  <input class="searchbox" id="howtoSearch" type="search" placeholder="Search — Netflix, gym, Adobe…" autocomplete="off">
  <div id="howtoList">${howtoListHtml('')}</div>
  <p class="hint">Don't see it? <a href="${esc(CD.googleCancel(''))}" id="howtoFallback" target="_blank" rel="noopener">Search the web for how to cancel</a></p>`;
}
function howtoListHtml(q) {
  const list = CD.search(q);
  if (!list.length) return `<div class="card empty"><p>No matches. Try another name, or <a href="${esc(CD.googleCancel(q))}" target="_blank" rel="noopener">search how to cancel ${esc(q)}</a>.</p></div>`;
  const cats = [];
  list.forEach(c => { if (!cats.includes(c.category)) cats.push(c.category); });
  return cats.map(cat => `<div class="cat">${esc(cat)}</div><div class="card" style="padding:8px 14px">${list.filter(c => c.category === cat).map(c => `
    <div class="row" style="align-items:flex-start;flex-wrap:wrap">
      <div class="grow" style="min-width:60%"><div class="t">${esc(c.name)}</div>
      ${c.note || c.phone ? `<div class="hint">${esc(c.note || 'Often requires phone or in-person cancel.')}</div>` : ''}
      ${cancelLinkHtml(c, c.name, { source: 'howto', catalogId: c.id })}
      <div style="margin-top:8px"><button type="button" class="chip" data-act="cancelledFromDir" data-id="${esc(c.id)}">✓ I cancelled this</button></div>
      </div>
    </div>`).join('')}</div>`).join('');
}


/* ---------- pending cancel follow-up ---------- */
function maybePromptPending() {
  if (pendingPromptOpen || pendingSnoozed || pickerOpen) return;
  if (!$('#sheet').hidden) return;
  const p = readPending();
  if (!p) return;
  clearTimeout(maybePromptPending._t);
  maybePromptPending._t = setTimeout(() => { if (!pickerOpen && $('#sheet').hidden && readPending()) showPendingCancelSheet(readPending()); }, 400);
}
function showPendingCancelSheet(p) {
  if (pendingPromptOpen || !p) return;
  pendingPromptOpen = true;
  const knownAmt = p.cents != null && p.cents > 0;
  const day = p.day || K.parse(today()).getDate();
  openSheet(`<h3>Did you cancel ${esc(p.name)}?</h3>
    <p class="muted small" style="margin-top:-6px">You opened the cancel page. Tell us what happened so we can log it.</p>
    <form id="pendF">
      <label class="f"><span>Monthly amount${knownAmt ? '' : ' (needed to track or save)'}</span><div class="money"><input name="amt" inputmode="decimal" placeholder="0.00" value="${knownAmt ? (p.cents / 100).toFixed(2) : ''}"></div></label>
      <label class="f"><span>Day it used to come out</span><select name="day">${Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}" ${day === i + 1 ? 'selected' : ''}>The ${ord(i + 1)}</option>`).join('')}</select></label>
      <div class="btns">
        <button type="button" class="btn" data-pend="save">💰 Cancel &amp; keep it going into savings</button>
        <button type="button" class="btn secondary" data-pend="track">👁 Cancel &amp; track what I would've spent</button>
        <button type="button" class="btn ghost" data-pend="log">✓ Just mark it cancelled</button>
        <button type="button" class="btn ghost" data-pend="later">Not yet / didn't cancel</button>
        <button type="button" class="btn danger" data-pend="dismiss">Forget this</button>
      </div>
    </form>`, sh => {
    const f = $('#pendF', sh);
    let busy = false;
    const finish = async (mode) => {
      if (busy) return; busy = true;
      const btns = $$('[data-pend]', sh); btns.forEach(b => b.disabled = true);
      const done = () => { busy = false; btns.forEach(b => b.disabled = false); };
      if (mode === 'later') { pendingSnoozed = true; closeSheet(); toast("OK — we'll ask again next time you open Kept"); return; }
      if (mode === 'dismiss') { clearPending(); closeSheet(); return; }
      const cents = K.toCents(f.amt.value);
      if (mode !== 'log' && cents <= 0) { toast('Enter the monthly amount'); return done(); }
      clearPending(); // clear BEFORE saving so no other return/focus event can ask again
      const same = findSameBill(p.name, cents || 0, +f.day.value);
      if (same) {
        const ch = await inlineAsk(sh, `You already have <b>${esc(same.name)}</b> (${fmtSmart(same.cents)}/mo, the ${ord(same.day)}). Update it instead?`, [['update', 'Update existing', ''], ['add', 'Add another anyway', 'ghost'], ['back', 'Go back', 'ghost']]);
        if (ch === 'back') { rememberPending(p); return done(); }
        if (ch === 'update') { same.mode = mode; save(); closeSheet(); goHash('#subs'); toast(`Updated ${same.name}`); return; }
      }
      const sub = { id: uid(), name: p.name, cents: cents || 0, day: +f.day.value, startDate: today(), mode, catalogId: p.catalogId || undefined };
      state.subs.push(sub);
      if (p.findKey && !state.ignoredMerchants.includes(p.findKey)) state.ignoredMerchants.push(p.findKey);
      save(); closeSheet();
      goHash('#subs');
      toast(mode === 'save' ? `${sub.name} — ${fmtSmart(sub.cents)}/mo into savings` : mode === 'track' ? `${sub.name} — tracking as not spent` : `${sub.name} marked cancelled`);
    };
    sh.querySelectorAll('[data-pend]').forEach(btn => btn.addEventListener('click', () => finish(btn.dataset.pend)));
  });
}
function cancelledFromDir(id) {
  const c = CD.byId(id); if (!c) return;
  rememberPending(pendingPayload({ name: c.name, cents: null, day: null, catalogId: c.id, source: 'howto' }));
  showPendingCancelSheet(readPending());
}

/* ---------- settings ---------- */
function renderSettings() {
  const hasDemo = state.subs.some(s => s.demo) || state.receipts.some(r => r.demo);
  return `<h2>Settings</h2>
  <div class="card"><h3>🎯 Goal</h3><p class="muted small" style="margin-top:-4px">${state.goal ? `${esc(state.goal.name)} — ${fmt(state.goal.cents, true)} by ${niceDate(state.goal.date)}` : 'No goal yet.'}</p><button class="btn secondary" data-act="goal">${state.goal ? 'Edit goal' : 'Set a goal'}</button></div>
  <div class="card"><h3>🔎 Find &amp; cancel</h3><p class="muted small" style="margin-top:-4px">Scan a bank statement for subscriptions, or look up how to cancel a service.</p>
    <div class="btns"><a class="btn secondary" href="#find">Find on a bank statement</a><a class="btn ghost" href="#howto">Cancel directory</a></div>
    ${state.ignoredMerchants.length ? `<p class="hint">${state.ignoredMerchants.length} ignored from scans. <button class="chip" data-act="clearIgnored">Show them again</button></p>` : ''}</div>
  <div class="card"><h3>💾 Backup</h3><p class="muted small" style="margin-top:-4px">Your savings live only on this phone. Save a backup file now and then (to Files, iCloud, Google Drive, or email it to yourself).</p>
    <div class="btns"><button class="btn secondary" data-act="exportData">Save backup file</button><button class="btn ghost" data-act="importData">Restore from backup</button></div></div>
  ${bankPanelHtml('settings')}
  <div class="card note"><h3>💸 Still planned: automatic transfers</h3>${APP_NAME} counts the money you didn't spend, but doesn't move real money yet. Linking your bank above only <b>reads</b> transactions.</div>
  <div class="card"><h3>👀 Show a friend</h3><p class="muted small" style="margin-top:-4px">Load sample bills and receipts to show how it works.</p>
    <div class="btns">${hasDemo ? '<button class="btn secondary" data-act="clearDemo">Remove sample data</button>' : '<button class="btn secondary" data-act="demo">Add sample data</button>'}</div></div>
  <div class="card"><h3>About</h3><p class="small muted" style="margin:0 0 12px">"${APP_NAME}" is a working name and can be changed. Version 1.4.0 · No account. Your savings, receipts and statement files stay on this phone. Bank linking is optional${getBank() && getBank().mode === 'demo' ? ' (demo bank linked — fake data)' : ''}.</p>
    <details class="paste-box"><summary>Advanced: bank server (for setup help)</summary>
      <p class="hint">Only change this if you were given a Kept bank server address. Leave empty to use the Demo bank.</p>
      <input id="bankServerIn" inputmode="url" autocapitalize="none" spellcheck="false" placeholder="https://kept-bank.example.workers.dev" value="${esc(localStorage.getItem('kept.bankServer') || '')}">
      <div class="btns" style="margin-top:8px"><button class="btn secondary small" data-act="saveBankServer">Save</button></div>
      <p class="hint">Now using: ${bankServer() ? esc(bankServer()) : 'Demo bank (no server)'}</p>
    </details>
    <button class="btn danger" data-act="reset">Erase all data</button></div>`;
}
async function blobToDataURL(b) { return new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); }); }
async function exportData() {
  const photos = {};
  for (const r of state.receipts) if (r.photo) { const b = await Photos.get(r.id); if (b) photos[r.id] = await blobToDataURL(b); }
  const data = JSON.stringify({ app: 'kept', exportedAt: new Date().toISOString(), state, photos });
  const name = `kept-backup-${today()}.json`; const file = new File([data], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: 'Kept backup' }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click(); a.remove(); toast('Backup saved');
}
document.addEventListener('change', async e => {
  if (e.target.id !== 'importFile') return; pickerDone(); const file = e.target.files[0]; if (!file) return;
  try {
    const d = JSON.parse(await file.text()); if (!d.state || !Array.isArray(d.state.subs)) throw new Error('bad');
    if (!confirm(`Restore backup from ${(d.exportedAt || '').slice(0, 10)}? This replaces what's on this phone now.`)) return;
    await Photos.clear(); for (const [id, url] of Object.entries(d.photos || {})) await Photos.put(id, await (await fetch(url)).blob());
    state = d.state; save(); location.hash = '#home'; route(); toast('Backup restored');
  } catch (err) { toast("That file doesn't look like a Kept backup"); }
  e.target.value = '';
});
function resetAll() { if (!confirm('Erase ALL savings, receipts and photos from this phone? This cannot be undone.')) return; state = defaultState(); save(); Photos.clear(); location.hash = '#home'; route(); toast('All data erased'); }
function loadDemo() {
  const td = K.parse(today()); const ago = m => K.ymd(K.addMonths(td, -m)); const dAgo = n => K.ymd(K.addDays(td, -n));
  state.subs.push(
    { id: uid(), demo: true, name: 'Netflix', cents: 5000, day: 6, startDate: ago(7) },
    { id: uid(), demo: true, name: 'Cable TV', cents: 11999, day: 15, startDate: ago(4) },
    { id: uid(), demo: true, name: 'Sirius XM', cents: 1099, day: 22, startDate: ago(2) });
  state.receipts.push(
    { id: uid(), demo: true, store: 'Walmart', cents: 7800, date: dAgo(3), note: 'Rollbacks + coupons' },
    { id: uid(), demo: true, store: 'Kroger', cents: 2345, date: dAgo(12), note: 'Fuel points + digital coupons' },
    { id: uid(), demo: true, store: 'Home Depot', cents: 4120, date: dAgo(40), note: 'Pro Xtra discount' },
    { id: uid(), demo: true, store: "Lowe's", cents: 1875, date: dAgo(75) });
  if (!state.goal) { const y = td.getFullYear(); state.goal = { name: 'Christmas fund', cents: 250000, date: (today() > y + '-12-25' ? y + 1 : y) + '-12-25', demo: true }; }
  save(); location.hash = '#home'; route(); toast('Sample data added — remove it anytime in Settings');
}
function clearDemo() { state.subs = state.subs.filter(s => !s.demo); state.receipts = state.receipts.filter(r => !r.demo); if (state.goal && state.goal.demo) state.goal = null; save(); rerender(); toast('Sample data removed'); }

/* ---------- boot ---------- */
document.title = APP_NAME; $('#appName').textContent = APP_NAME;
$('#todayLabel').textContent = (TODAY_OVERRIDE ? 'Preview · ' : '') + new Date(K.parse(today())).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
route();
completeOAuthReturn();
// refresh at midnight / when reopened so new transfers show up
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  // Returning from the Android file picker fires this BEFORE the input's change event.
  // Re-rendering here used to wipe the screen and the picked file was lost.
  if (pickerOpen) { clearTimeout(openPicker._t); openPicker._t = setTimeout(pickerDone, 4000); return; }
  if ($('#sheet').hidden) rerender();
  maybePromptPending();
});
window.addEventListener('focus', () => maybePromptPending());
window.addEventListener('pageshow', () => maybePromptPending());
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => { });
document.addEventListener('change', e => {
  if (e.target.id === 'stmtFile') { pickerDone(); const fl = Array.from(e.target.files || []); if (fl.length) { if (location.hash !== '#find') location.hash = '#find'; processStatementFiles(fl); } }
});
document.addEventListener('input', e => {
  if (e.target.id === 'howtoSearch') {
    const q = e.target.value;
    const list = $('#howtoList'); if (list) list.innerHTML = howtoListHtml(q);
    const fb = $('#howtoFallback'); if (fb) fb.href = CD.googleCancel(q || 'subscription');
  }
});
document.addEventListener('click', e => {
  const a = e.target.closest('a.cancel-link, a[data-cancel-name]');
  if (!a || !a.dataset.cancelName) return;
  // A link on a bill that's already saved (or inside the add form) must not create a new "Did you cancel?" prompt.
  if (a.dataset.cancelBill || a.dataset.cancelSource === 'form') return;
  pendingSnoozed = false;
  rememberPending(pendingPayload({
    name: a.dataset.cancelName,
    cents: a.dataset.cancelCents || null,
    day: a.dataset.cancelDay || null,
    catalogId: a.dataset.cancelCatalog || null,
    findKey: a.dataset.cancelFindkey || null,
    source: a.dataset.cancelSource || '',
  }));
}, true);
setTimeout(maybePromptPending, 600);

function saveBankServer() {
  const v = ($('#bankServerIn') || {}).value || ''; const url = v.trim().replace(/\/+$/, '');
  if (url && !/^https:\/\/[^\s/]+(\/\S*)?$/.test(url)) { toast('That needs to start with https://'); return; }
  if (url) localStorage.setItem('kept.bankServer', url); else localStorage.removeItem('kept.bankServer');
  rerender(); toast(url ? 'Bank server saved' : 'Using the Demo bank');
}
