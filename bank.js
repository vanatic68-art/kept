/* Kept — bank linking. Real path: Plaid Link + the Kept bank server (worker/). Until a server URL is set: DEMO bank with fake data.
   Transactions are kept only on this phone (localStorage 'kept.bank'); the server only holds an encrypted connection key. */
const BANK_KEY = 'kept.bank';
const DB = window.KeptDemoBank;
function bankServer() { return (localStorage.getItem('kept.bankServer') || (window.KEPT_CONFIG && KEPT_CONFIG.bankServer) || '').trim().replace(/\/+$/, ''); }
function deviceId() {
  let id = localStorage.getItem('kept.deviceId');
  if (!id) { const b = crypto.getRandomValues(new Uint8Array(24)); id = 'k_' + btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); localStorage.setItem('kept.deviceId', id); }
  return id;
}
function getBank() { try { return JSON.parse(localStorage.getItem(BANK_KEY) || 'null'); } catch (e) { return null; } }
function setBank(b) { if (b) localStorage.setItem(BANK_KEY, JSON.stringify(b)); else localStorage.removeItem(BANK_KEY); }
const bankLinked = () => !!getBank();
/** Linked-bank transactions in the finder's shape (posted only). */
function bankTxs() {
  const b = getBank(); if (!b) return [];
  return (b.txs || []).filter(t => !t.pending).map(t => ({ date: t.date, cents: t.cents, desc: t.desc, memo: '', type: '', checkNo: t.checkNo || '', pfc: t.pfc || '', p2p: !!t.p2p }));
}
function agoText(iso) {
  if (!iso) return 'never'; const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  const d = new Date(iso); const t = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return s < 86400 && d.getDate() === new Date().getDate() ? `today at ${t}` : `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${t}`;
}
const BANK_PRIVACY = `<details class="privacy"><summary>🔒 How bank linking works &amp; your privacy</summary>
  <ul>
    <li><b>Optional.</b> Uploading statements still works and never leaves your phone.</li>
    <li>Your bank login is typed into <b>Plaid</b> (the service Venmo, Chime and many banks' apps use) — <b>Kept never sees your username or password.</b></li>
    <li>Kept asks for <b>read-only transactions</b>. It can't move money, pay bills or see your login.</li>
    <li>Transactions are sent to <b>this phone only</b> and stored here. Kept's small server keeps just an <b>encrypted connection key</b> — no transactions, no name, no account numbers.</li>
    <li><b>Disconnect</b> any time: the connection key is deleted and Plaid stops access. You can also revoke it at <b>my.plaid.com</b>.</li>
  </ul></details>`;

/* ---------- panel (Settings + finder) ---------- */
function bankPanelHtml(where) {
  const b = getBank();
  if (!b) {
    const real = !!bankServer();
    return `<div class="card bank-card" id="bankPanel"><h3>🏦 ${where === 'find' ? 'Easiest: link your bank' : 'Link your bank'}</h3>
      <p class="muted small" style="margin-top:-4px">${where === 'find' ? 'Instead of downloading statements, connect your checking account and we\'ll pull the last 6+ months automatically.' : 'Connect your checking account so the subscription finder can read your transactions automatically.'}</p>
      ${real ? `<button class="btn" data-act="linkBank">🔗 Link your bank</button>`
        : `<div class="demo-note"><b>Not set up yet.</b> Real bank linking needs a Plaid account first. Until then you can try the whole flow with a <b>pretend bank and fake transactions</b>.</div>
           <button class="btn secondary" data-act="linkDemo">🧪 Try Demo bank (test data)</button>`}
      ${BANK_PRIVACY}</div>`;
  }
  const demo = b.mode === 'demo'; const acct = (b.accounts || [])[0];
  const n = (b.txs || []).filter(t => !t.pending).length;
  return `<div class="card bank-card ${demo ? 'is-demo' : ''}" id="bankPanel">
    ${demo ? '<div class="demo-ribbon">DEMO · TEST DATA · NOT YOUR REAL BANK</div>' : ''}
    <h3>🏦 ${esc(b.institution && b.institution.name || 'Your bank')}${demo ? ' <span class="conf">Demo</span>' : ''}</h3>
    <div class="muted small" style="margin-top:-4px">${acct ? `${esc(acct.name)} ••${esc(acct.mask || '')} · ` : ''}${n} transactions${b.range ? ` · ${shortDate(b.range.from)} – ${shortDate(b.range.to)}` : ''}</div>
    <div class="bank-sync">Last synced <b>${agoText(b.lastSync)}</b>${b.syncing ? ' · syncing…' : ''}</div>
    ${b.error ? `<div class="tipbox warn">⚠️ ${esc(b.error)}${b.needsLogin ? `<div class="btns" style="margin-top:8px"><button class="btn small" data-act="relinkBank">Sign in again</button></div>` : ''}</div>` : ''}
    ${b.waiting ? `<div class="tipbox">⏳ Your bank is still sending your history. Tap <b>Refresh</b> in a minute.</div>` : ''}
    <div class="btns" style="margin-top:12px">
      ${where !== 'find' ? '<a class="btn" href="#find">🔎 Find subscriptions</a>' : ''}
      <button class="btn secondary" data-act="bankRefresh">↻ Refresh</button>
      <button class="btn ghost" data-act="bankDisconnect">Disconnect</button>
    </div>
    ${demo ? '<p class="hint">These are made-up transactions so you can see how it works. Disconnect anytime — nothing real is connected.</p>' : ''}
    ${BANK_PRIVACY}</div>`;
}

/* ---------- after linking / syncing ---------- */
function bankChanged(runFinder) {
  const b = getBank();
  if (b) { const tx = (b.txs || []).filter(t => !t.pending); b.range = tx.length ? ST.dateRange(tx) : null; setBank(b); }
  findCache = null; findStatusHtml = '';
  if (runFinder && b && b.range) { if (activeRoute() !== 'find') goHash('#find'); setTimeout(() => runFind(true), 0); }
  else rerender();
}
async function bankRefresh() {
  const b = getBank(); if (!b) return;
  if (b.mode === 'demo') {
    b.syncing = true; setBank(b); rerender();
    await new Promise(r => setTimeout(r, 900));
    const nb = getBank(); if (!nb) return;
    nb.txs = DB.transactions(nb.seed, today()); nb.lastSync = new Date().toISOString(); delete nb.syncing; setBank(nb);
    toast('Demo bank refreshed'); bankChanged(activeRoute() === 'find' && !!findCache); return;
  }
  return realSync(true);
}
async function bankDisconnect() {
  const b = getBank(); if (!b) return;
  const name = b.institution && b.institution.name || 'your bank';
  const ok = await confirmSheet(`Disconnect ${esc(name)}?`, b.mode === 'demo'
    ? 'The demo transactions will be removed from this phone.'
    : 'Kept will stop reading transactions, the connection key on Kept\'s server is deleted, and Plaid\'s access is removed. Transactions already on this phone are cleared too. (Linking again later uses another of the 10 free Plaid connections.)', 'Disconnect', 'Keep linked');
  if (!ok) return;
  if (b.mode !== 'demo') {
    try { await api('/api/disconnect', {}); }
    catch (e) { if (!(e.status === 404)) { toast("Couldn't reach the bank server — try again"); return; } }
  }
  setBank(null); bankChanged(false); toast(`Disconnected ${name}`);
}
function confirmSheet(title, msg, yes, no) {
  return new Promise(res => {
    openSheet(`<h3>${title}</h3><p>${msg}</p><div class="btns"><button class="btn danger" id="cfYes">${yes}</button><button class="btn ghost" id="cfNo">${no}</button></div>`, sh => {
      $('#cfYes', sh).onclick = () => { closeSheet(); res(true); };
      $('#cfNo', sh).onclick = () => { closeSheet(); res(false); };
    });
  });
}

/* ---------- real Plaid path ---------- */
async function api(path, body) {
  const res = await fetch(bankServer() + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: deviceId(), ...body }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || data.error || 'error'), { status: res.status, data });
  return data;
}
let plaidSdkP;
function loadPlaidSdk() {
  return plaidSdkP || (plaidSdkP = new Promise((res, rej) => {
    if (window.Plaid) return res(window.Plaid);
    const s = document.createElement('script'); s.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
    s.onload = () => res(window.Plaid); s.onerror = () => { plaidSdkP = null; rej(new Error('sdk')); }; document.head.appendChild(s);
  }));
}
async function linkBank(opts = {}) {
  if (!bankServer()) return linkDemo();
  toast('Opening secure bank connection…');
  try {
    const [{ linkToken }, Plaid] = await Promise.all([api('/api/link-token', opts.itemId ? { itemId: opts.itemId } : {}), loadPlaidSdk()]);
    localStorage.setItem('kept.linkToken', linkToken);   // oauth.html needs it after the bank's OAuth redirect
    const handler = Plaid.create({
      token: linkToken,
      onSuccess: (publicToken, meta) => { localStorage.removeItem('kept.linkToken'); opts.itemId ? realSync(true) : finishLink(publicToken, meta); },
      onExit: (err) => { localStorage.removeItem('kept.linkToken'); if (err) toast(err.display_message || 'Bank connection was not finished'); },
    });
    handler.open();
  } catch (e) {
    toast(e.message === 'sdk' ? "Couldn't load Plaid — check your internet" : e.status === 503 ? 'Bank server is not set up yet' : "Couldn't start bank linking — try again");
  }
}
async function finishLink(publicToken, meta) {
  toast('Connecting…');
  try {
    const inst = meta && meta.institution ? { name: meta.institution.name, institution_id: meta.institution.institution_id } : null;
    const r = await api('/api/exchange', { publicToken, institution: inst });
    setBank({ mode: 'plaid', itemId: r.itemId, institution: r.institution || { name: 'Your bank' }, accounts: (meta && meta.accounts || []).map(a => ({ id: a.id, name: a.name, mask: a.mask })), linkedAt: new Date().toISOString(), txs: [] });
    rerender(); await realSync(true, 0);
  } catch (e) { toast("Couldn't finish connecting — try again"); }
}
/** Pull changes from the server and merge them into the transactions kept on this phone. */
async function realSync(runFinder, attempt = 0) {
  let b = getBank(); if (!b) return;
  b.syncing = true; setBank(b); if (attempt === 0) rerender();
  try {
    const d = await api('/api/sync', {});
    b = getBank(); if (!b) return;
    const byId = new Map((b.txs || []).map(t => [t.id, t]));
    d.added.concat(d.modified).forEach(t => byId.set(t.id, t)); d.removed.forEach(id => byId.delete(id));
    b.txs = [...byId.values()].sort((x, y) => x.date < y.date ? 1 : -1);
    const it = d.items[0] || {};
    if (it.accounts && it.accounts.length) b.accounts = it.accounts;
    if (it.institution && it.institution.name) b.institution = it.institution;
    b.needsLogin = it.error === 'ITEM_LOGIN_REQUIRED'; b.error = it.error ? (b.needsLogin ? 'Your bank needs you to sign in again.' : (it.message || 'Your bank had a problem sending transactions.')) : null;
    b.waiting = !b.txs.length && it.status !== 'HISTORICAL_UPDATE_COMPLETE' && !it.error;
    b.lastSync = new Date().toISOString(); delete b.syncing; setBank(b);
    if (b.waiting && attempt < 6) { rerender(); setTimeout(() => realSync(runFinder, attempt + 1), 10000); return; }
    toast(d.added.length ? `${d.added.length} new transactions` : 'Up to date');
    bankChanged(runFinder);
  } catch (e) {
    b = getBank(); if (b) { delete b.syncing; b.error = e.status === 404 ? 'This bank link was removed. Disconnect and link again.' : "Couldn't reach the bank server. Check your internet and tap Refresh."; setBank(b); }
    rerender();
  }
}
/** Back from a bank's OAuth page (oauth.html stored the result). */
function completeOAuthReturn() {
  let r; try { r = JSON.parse(localStorage.getItem('kept.oauthResult') || 'null'); } catch (e) { r = null; }
  if (!r) return; localStorage.removeItem('kept.oauthResult');
  if (r.publicToken) finishLink(r.publicToken, r.meta);
}

/* ---------- DEMO bank (looks like Plaid Link, clearly fake) ---------- */
function linkDemo() {
  const step = { bank: null };
  const shell = body => `<div class="plink"><div class="demo-ribbon">DEMO · TEST DATA · NOT YOUR REAL BANK</div>${body}</div>`;
  const screens = {
    intro: () => shell(`<div class="plink-logos"><span class="pl-app">K</span><span class="pl-dots">···</span><span class="pl-app pl-plaid">▦</span></div>
      <h3 class="pl-h">Kept uses <b>Plaid (demo)</b> to connect your account</h3>
      <div class="pl-pt"><span>🔐</span><div><b>Secure</b><br><span class="muted small">Your login goes to the bank connector, not to Kept.</span></div></div>
      <div class="pl-pt"><span>👁️</span><div><b>Private</b><br><span class="muted small">Kept only reads transactions. It can't move money.</span></div></div>
      <p class="demo-note">This is a <b>practice run</b> with a pretend bank. <b>Don't type your real bank login.</b> The real version will look like this once Plaid is set up.</p>
      <button class="btn" data-pl="go">Continue</button>`),
    pick: () => shell(`<h3 class="pl-h">Select your bank <span class="conf">Demo banks</span></h3>
      <input class="pl-search" id="plSearch" placeholder="Search" autocomplete="off">
      <div class="pl-banks" id="plBanks">${DB.BANKS.map(b => `<button class="pl-bank" data-bank="${b.id}" data-name="${esc(b.name.toLowerCase())}"><span class="pl-logo" style="background:${b.color}">${b.logo}</span><span>${esc(b.name)}<br><span class="muted small">Demo bank · fake data</span></span></button>`).join('')}</div>`),
    login: () => { const b = step.bank; return shell(`<div class="pl-bankhead"><span class="pl-logo" style="background:${b.color}">${b.logo}</span><b>${esc(b.name)}</b></div>
      <h3 class="pl-h">Enter your credentials</h3>
      <div class="tipbox">🧪 <b>Demo login:</b> username <code>${DB.USER}</code> · password <code>${DB.PASS}</code></div>
      <label class="pl-l">Username<input id="plUser" autocomplete="off" autocapitalize="none" spellcheck="false"></label>
      <label class="pl-l">Password<input id="plPass" type="password" autocomplete="off"></label>
      <div id="plErr" class="pl-err" hidden></div>
      <button class="btn" data-pl="submit">Submit</button>`); },
    loading: () => shell(`<div class="pl-spin"></div><h3 class="pl-h" style="text-align:center">Connecting to ${esc(step.bank.name)}…</h3><p class="muted small" style="text-align:center">(pretend — no real bank is contacted)</p>`),
    accounts: () => shell(`<h3 class="pl-h">Select account</h3><p class="muted small">Kept will read transactions from the account you pick.</p>
      ${DB.ACCOUNTS.map((a, i) => `<label class="pl-acct"><input type="radio" name="plAcct" value="${a.id}" ${i ? '' : 'checked'}><span><b>${a.name}</b><br><span class="muted small">${a.subtype} ••${a.mask} · fake account</span></span></label>`).join('')}
      <button class="btn" data-pl="acct" style="margin-top:12px">Continue</button>`),
    done: () => shell(`<div style="text-align:center;font-size:54px">✅</div><h3 class="pl-h" style="text-align:center">Demo account connected</h3>
      <p class="muted small" style="text-align:center">Kept will now read about 6 months of <b>fake</b> transactions and look for subscriptions.</p>
      <button class="btn" data-pl="finish">Continue</button>`),
  };
  let acctId = DB.ACCOUNTS[0].id;
  const show = (name, sh) => {
    sh = sh || $('#sheet'); const body = screens[name]();
    sh.innerHTML = '<div class="grab" aria-hidden="true"></div>' + body; sh.scrollTop = 0; wire(name, sh);
  };
  const wire = (name, sh) => {
    sh.querySelectorAll('[data-pl]').forEach(btn => btn.addEventListener('click', () => {
      const k = btn.dataset.pl;
      if (k === 'go') show('pick');
      if (k === 'submit') {
        const u = $('#plUser', sh).value.trim(), p = $('#plPass', sh).value;
        if (u !== DB.USER || p !== DB.PASS) { const er = $('#plErr', sh); er.hidden = false; er.textContent = `Those aren't the demo credentials. Use ${DB.USER} / ${DB.PASS}.`; return; }
        show('loading'); setTimeout(() => { if (!$('#sheet').hidden) show('accounts'); }, 1400);
      }
      if (k === 'acct') { const c = sh.querySelector('input[name=plAcct]:checked'); acctId = c ? c.value : acctId; show('done'); }
      if (k === 'finish') {
        const seed = deviceId() + ':' + step.bank.id;
        const acct = DB.ACCOUNTS.find(a => a.id === acctId) || DB.ACCOUNTS[0];
        setBank({ mode: 'demo', seed, institution: { name: step.bank.name, id: step.bank.id }, accounts: [acct], linkedAt: new Date().toISOString(), lastSync: new Date().toISOString(), txs: DB.transactions(seed, today()) });
        closeSheet(); toast(`Demo bank connected — ${bankTxs().length} fake transactions`); bankChanged(true);
      }
    }));
    sh.querySelectorAll('[data-bank]').forEach(btn => btn.addEventListener('click', () => { step.bank = DB.BANKS.find(b => b.id === btn.dataset.bank); show('login'); }));
    const s = $('#plSearch', sh);
    if (s) s.addEventListener('input', () => { const q = s.value.toLowerCase(); sh.querySelectorAll('[data-bank]').forEach(b => b.hidden = !b.dataset.name.includes(q)); });
  };
  openSheet(screens.intro(), sh => wire('intro', sh));
}
