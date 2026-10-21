/* Kept — core date & money logic (no DOM). Works in browser and Node for tests. */
(function (root) {
  'use strict';
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parse = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
  const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
  // A draft day that doesn't exist in a month (e.g. 31st in Feb) falls on that month's last day.
  const draftDate = (y, m, day) => new Date(y, m, Math.min(day, daysInMonth(y, m)));
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const addMonths = (d, n) => { const y = d.getFullYear(), m = d.getMonth() + n; return new Date(y, m, Math.min(d.getDate(), daysInMonth(y, m))); };
  const toCents = v => Math.round(parseFloat(String(v).replace(/[^0-9.\-]/g, '')) * 100) || 0;
  const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);

  /** All draft dates for a sub with lo <= date <= hi (Date objects, local midnight). */
  function draftsBetween(sub, from, to) {
    const start = parse(sub.startDate);
    const stop = sub.stopDate ? parse(sub.stopDate) : null;
    const lo = from > start ? from : start;
    const hi = stop && stop < to ? stop : to;
    const out = [];
    if (lo > hi) return out;
    let y = lo.getFullYear(), m = lo.getMonth();
    for (let guard = 0; guard < 1200; guard++) {
      const d = draftDate(y, m, sub.day);
      if (d > hi) break;
      if (d >= lo) out.push(d);
      if (++m > 11) { m = 0; y++; }
    }
    return out;
  }
  /** Transfers that have already happened (draft day on/after cancel date, up to and including today). */
  function subPaid(sub, todayStr) {
    const dates = draftsBetween(sub, parse(sub.startDate), parse(todayStr));
    return { count: dates.length, cents: dates.length * sub.cents, dates };
  }
  function nextDraft(sub, todayStr) {
    const from = addDays(parse(todayStr), 1);
    const d = draftsBetween(sub, from, addMonths(from, 2));
    return d.length ? d[0] : null;
  }
  function upcoming(subs, todayStr, days) {
    const from = addDays(parse(todayStr), 1), to = addDays(parse(todayStr), days);
    const out = [];
    (subs || []).filter(s => subMode(s) !== 'log').forEach(s => draftsBetween(s, from, to).forEach(d => out.push({ sub: s, date: ymd(d), cents: s.cents })));
    return out.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.sub.name.localeCompare(b.sub.name));
  }
  /** Cents that subscriptions will add after today, up to and including targetStr. */
  function projectSubs(subs, todayStr, targetStr) {
    const from = addDays(parse(todayStr), 1), to = parse(targetStr);
    return savingSubs(subs).reduce((t, s) => t + draftsBetween(s, from, to).length * s.cents, 0);
  }
  function projectTrack(subs, todayStr, targetStr) {
    const from = addDays(parse(todayStr), 1), to = parse(targetStr);
    return trackSubs(subs).reduce((t, s) => t + draftsBetween(s, from, to).length * s.cents, 0);
  }
  /** mode: 'save' (default) → Saved total; 'track' → Not spent (would-have); 'log' → listed only, $0. */
  function subMode(s) { return s && s.mode === 'track' ? 'track' : s && s.mode === 'log' ? 'log' : 'save'; }
  function savingSubs(subs) { return (subs || []).filter(s => subMode(s) === 'save'); }
  function trackSubs(subs) { return (subs || []).filter(s => subMode(s) === 'track'); }
  function totals(state, todayStr) {
    const savedSubs = savingSubs(state.subs).reduce((t, s) => t + subPaid(s, todayStr).cents, 0);
    const notSpent = trackSubs(state.subs).reduce((t, s) => t + subPaid(s, todayStr).cents, 0);
    const receipts = state.receipts.filter(r => r.date <= todayStr).reduce((t, r) => t + r.cents, 0);
    return { subs: savedSubs, notSpent, receipts, all: savedSubs + receipts, saved: savedSubs + receipts };
  }
  /** Average receipt savings per month, based on the last 90 days. */
  function receiptPace(state, todayStr) {
    const from = ymd(addDays(parse(todayStr), -90));
    const c = state.receipts.filter(r => r.date > from && r.date <= todayStr).reduce((t, r) => t + r.cents, 0);
    return Math.round(c / 3);
  }
  function events(state, todayStr) {
    const ev = [];
    // Chart / growth = money kept (save mode + receipts). Track-only is shown separately.
    savingSubs(state.subs).forEach(s => subPaid(s, todayStr).dates.forEach(d => ev.push({ date: ymd(d), cents: s.cents, kind: 'sub' })));
    state.receipts.filter(r => r.date <= todayStr).forEach(r => ev.push({ date: r.date, cents: r.cents, kind: 'receipt' }));
    return ev.sort((a, b) => a.date < b.date ? -1 : 1);
  }
  /** Cumulative total at end of each month (current month = as of today), plus subscription-only projection. */
  function monthlySeries(state, todayStr, minBack, fwd) {
    const today = parse(todayStr);
    const ev = events(state, todayStr);
    let first = ev.length ? parse(ev[0].date) : today;
    let start = new Date(first.getFullYear(), first.getMonth(), 1);
    const minStart = new Date(today.getFullYear(), today.getMonth() - minBack, 1);
    if (start > minStart) start = minStart;
    const maxBack = new Date(today.getFullYear(), today.getMonth() - 11, 1);
    let carry = 0;
    if (start < maxBack) { // keep chart readable: show the last 12 months, carry earlier totals in
      carry = ev.filter(e => parse(e.date) < maxBack).reduce((t, e) => t + e.cents, 0);
      start = maxBack;
    }
    const pts = [];
    let cur = new Date(start);
    while (cur <= today) {
      const end = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);
      const endStr = ymd(end < today ? end : today);
      const sum = carry + ev.filter(e => e.date <= endStr && parse(e.date) >= start).reduce((t, e) => t + e.cents, 0);
      pts.push({ ym: ymd(cur).slice(0, 7), cents: sum, projected: false });
      cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    }
    const base = pts.length ? pts[pts.length - 1].cents : 0;
    for (let i = 0; i < fwd; i++) {
      const end = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);
      pts.push({ ym: ymd(cur).slice(0, 7), cents: base + projectSubs(state.subs, todayStr, ymd(end)), projected: true });
      cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    }
    return pts;
  }

  /** Try to find a "you saved" amount in OCR text. Returns {best, candidates[]} in cents. */
  function findSavings(text) {
    const norm = String(text || '').replace(/[Ss](?=\d)/g, '$').replace(/(\d)\s*[,.]\s*(\d{2})(?!\d)/g, '$1.$2');
    const lines = norm.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const amtRe = /\$?\s?(\d{1,5}\.\d{2})(?!\d)/g;
    const amounts = l => { const a = []; let m; amtRe.lastIndex = 0; while ((m = amtRe.exec(l))) a.push(Math.round(parseFloat(m[1]) * 100)); return a; };
    const strong = /(you\s*sav|total\s*sav|sav[il1]ngs|saved|you\s*save)/i;
    const weak = /(discount|coupon|promo|markdown|rollback|price\s*cut)/i;
    const pick = re => {
      const found = [];
      lines.forEach((l, i) => { if (re.test(l)) { let a = amounts(l); if (!a.length && lines[i + 1]) a = amounts(lines[i + 1]); found.push(...a); } });
      return found.filter(c => c > 0);
    };
    const s = pick(strong), w = pick(weak);
    const all = []; lines.forEach(l => all.push(...amounts(l)));
    const uniq = arr => [...new Set(arr)];
    const best = s.length ? Math.max(...s) : (w.length ? w.reduce((a, b) => a + b, 0) : null);
    const candidates = uniq([...s, ...w, ...all.sort((a, b) => b - a)]).slice(0, 8);
    return { best, candidates };
  }

  const api = { pad, ymd, parse, daysInMonth, addDays, addMonths, toCents, daysBetween, draftsBetween, subPaid, nextDraft, upcoming, projectSubs, projectTrack, totals, receiptPace, events, monthlySeries, findSavings, subMode, savingSubs, trackSubs };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.KeptCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
