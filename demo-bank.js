/* Kept — DEMO bank data. Fake, realistic transactions for trying bank linking before real Plaid keys exist.
   Same shape the real bank server returns (see worker/src/index.js toKept). Nothing here is the user's real data. */
(function (root) {
  'use strict';
  const BANKS = [
    { id: 'demo_platypus', name: 'First Platypus Bank', logo: '🦆', color: '#1f6feb' },
    { id: 'demo_tartan', name: 'Tartan Bank', logo: '🟥', color: '#b42318' },
    { id: 'demo_houndstooth', name: 'Houndstooth Bank', logo: '🐾', color: '#344054' },
    { id: 'demo_tattersall', name: 'Tattersall Federal Credit Union', logo: '🏛️', color: '#0b6e4f' },
    { id: 'demo_volunteer', name: 'Volunteer State Demo Bank', logo: '🎸', color: '#e66b00' },
    { id: 'demo_cumberland', name: 'Cumberland Demo Credit Union', logo: '🌊', color: '#0e7490' },
  ];
  const ACCOUNTS = [
    { id: 'demo-chk', name: 'Demo Checking', mask: '0000', type: 'depository', subtype: 'checking' },
    { id: 'demo-sav', name: 'Demo Savings', mask: '1111', type: 'depository', subtype: 'savings' },
  ];
  // Monthly subscriptions: [description as the bank shows it, amount, day, category, startMonthOffset]
  const MONTHLY = [
    ['NETFLIX.COM 866-579-7172 CA', 15.49, 6, 'ENTERTAINMENT_TV_AND_MOVIES'],
    ['Spotify USA 877-778-1161 NY', 11.99, 14, 'ENTERTAINMENT_MUSIC_AND_AUDIO'],
    ['KARAFUN *SUBSCRIPTION KARAFUN.COM', 10.99, 10, 'ENTERTAINMENT_MUSIC_AND_AUDIO'],
    ['DISNEY PLUS 888-905-7888 CA', 13.99, 21, 'ENTERTAINMENT_TV_AND_MOVIES'],
    ['Amazon Prime*2K4LM8 Amzn.com/bill WA', 14.99, 3, 'GENERAL_MERCHANDISE_ONLINE_MARKETPLACES'],
    ['GOOGLE *Google One g.co/helppay#', 2.99, 18, 'GENERAL_SERVICES_OTHER_GENERAL_SERVICES'],
    ['SIRIUSXM RADIO 888-635-5144 NY', 10.99, 22, 'ENTERTAINMENT_MUSIC_AND_AUDIO'],
    ['PLANET FITNESS CLUB FEES MURFREESBORO TN', 24.99, 17, 'PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS'],
    ['INTUIT *QBooks Online CL.INTUIT.COM CA', 35.00, 2, 'GENERAL_SERVICES_ACCOUNTING_AND_FINANCIAL_PLANNING'],
    ['JOBBER SOFTWARE GETJOBBER.COM AB', 69.00, 9, 'GENERAL_SERVICES_OTHER_GENERAL_SERVICES'],
    ['VERIZON WIRELESS PAYMENTS 800-922-0204', 142.37, 25, 'RENT_AND_UTILITIES_TELEPHONE'],
    ['APPLE.COM/BILL 866-712-7753 CA', 2.99, 12, 'ENTERTAINMENT_OTHER_ENTERTAINMENT'],
  ];
  const BILLS = [ // loans / insurance / utilities → "Other repeating payments"
    ['ALLY AUTO PAYMT ACH 0081123', 512.37, 8, 'LOAN_PAYMENTS_CAR_PAYMENT', 0],
    ['STATE FARM RO 27 SFPP ACH', 186.40, 12, 'GENERAL_SERVICES_INSURANCE', 0],
    ['MIDDLE TN ELECTRIC MEMBERSHIP ACH', 0, 19, 'RENT_AND_UTILITIES_GAS_AND_ELECTRICITY', 60], // amount varies
  ];
  const STORES = [
    ['POS DEBIT HOME DEPOT #0712 MURFREESBORO TN', 18, 420, 'HOME_IMPROVEMENT_HARDWARE'],
    ["POS DEBIT LOWE'S #2457 SMYRNA TN", 12, 380, 'HOME_IMPROVEMENT_HARDWARE'],
    ['KROGER #0544 MURFREESBORO TN', 24, 160, 'FOOD_AND_DRINK_GROCERIES'],
    ['SHELL OIL 57444812 LA VERGNE TN', 38, 95, 'TRANSPORTATION_GAS'],
    ["CASEY'S #3391 SMYRNA TN", 30, 80, 'TRANSPORTATION_GAS'],
    ['WAFFLE HOUSE 1123 MURFREESBORO TN', 9, 28, 'FOOD_AND_DRINK_RESTAURANT'],
    ["SQ *JOE'S BBQ SMYRNA TN", 11, 34, 'FOOD_AND_DRINK_RESTAURANT'],
    ['MENARDS SMYRNA TN', 25, 300, 'HOME_IMPROVEMENT_HARDWARE'],
    ['WAL-MART #1265 MURFREESBORO TN', 15, 140, 'GENERAL_MERCHANDISE_SUPERSTORES'],
    ['TRACTOR SUPPLY #812 LEBANON TN', 20, 110, 'GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE'],
  ];
  function rng(seed) { let a = 0; for (const c of String(seed)) a = (a * 31 + c.charCodeAt(0)) | 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const dim = (y, m) => new Date(y, m + 1, 0).getDate();

  /** ~6 months of checking-account activity ending on `endDate` (YYYY-MM-DD). Deterministic per seed. */
  function transactions(seed, endDate, months = 6) {
    const r = rng(seed || 'kept-demo');
    const end = new Date(endDate + 'T00:00');
    const start = new Date(end.getFullYear(), end.getMonth() - months, end.getDate() + 1);
    const out = []; let n = 0;
    const push = (date, amount, desc, category, extra = {}) => {
      if (date < start || date > end) return;
      const ds = ymd(date); const pending = (end - date) / 864e5 < 2;
      out.push({ id: `demo-${ds}-${++n}`, accountId: 'demo-chk', date: ds, posted: ds, cents: -Math.round(amount * 100), desc, merchant: null, pfc: category, checkNo: extra.checkNo || '', pending, p2p: !!extra.p2p });
    };
    const amt = (lo, hi) => Math.round((lo + r() * (hi - lo)) * 100) / 100;
    // month loop (one extra before start so early-month items exist)
    for (let i = 0; i <= months + 1; i++) {
      const y = start.getFullYear(), m = start.getMonth() + i - 1;
      const at = day => new Date(y, m, Math.min(day, dim(new Date(y, m, 1).getFullYear(), new Date(y, m, 1).getMonth())));
      MONTHLY.forEach(([d, a, day, cat]) => push(at(day + (r() < 0.2 ? 1 : 0)), a, d, cat));
      BILLS.forEach(([d, a, day, cat, vary]) => push(at(day), a || amt(110, 110 + vary + 80), d, cat));
      // checks: rent on the shop, plus a couple of one-off checks to subs/suppliers
      const ck = 1040 + i * 3;
      push(at(1), 950.00, `CHECK ${ck}`, 'GENERAL_SERVICES_OTHER_GENERAL_SERVICES', { checkNo: String(ck) });
      push(at(11 + Math.floor(r() * 6)), amt(180, 900), `CHECK ${ck + 1}`, 'GENERAL_SERVICES_OTHER_GENERAL_SERVICES', { checkNo: String(ck + 1) });
      if (r() < 0.6) push(at(20 + Math.floor(r() * 7)), amt(60, 400), `CHECK ${ck + 2}`, 'GENERAL_SERVICES_OTHER_GENERAL_SERVICES', { checkNo: String(ck + 2) });
      push(at(15), amt(250, 900), 'CHASE CREDIT CRD AUTOPAY PPD ID: 4760039224', 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT');
      push(at(28), 200.00, 'ONLINE TRANSFER TO SAV XXXXXX1111', 'TRANSFER_OUT_SAVINGS');
      if (i % 3 === 1) push(at(5), 129.00, 'TERMINIX PEST CONTROL 901-597-1400 TN', 'GENERAL_SERVICES_OTHER_GENERAL_SERVICES'); // quarterly
    }
    // daily-ish life: weekly items, customer deposits, store runs
    for (let d = new Date(start); d <= end; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
      const dow = d.getDay();
      if (dow === 1) push(d, 59.94, 'HELLOFRESH 646-846-3663 NY RECURRING', 'FOOD_AND_DRINK_GROCERIES');        // weekly sub
      if (dow === 5) push(d, 300.00, 'ZELLE TO RAMIREZ MIGUEL', 'TRANSFER_OUT_ACCOUNT_TRANSFER', { p2p: true });   // pays his helper
      if (dow === 3 && r() < 0.5) push(d, -amt(1200, 6800), 'MOBILE DEPOSIT REF 4411' + Math.floor(r() * 900 + 100), 'INCOME_OTHER_INCOME'); // customer checks
      if (dow === 2 && r() < 0.3) push(d, -amt(400, 2500), 'SQUARE INC DEP SQ' + Math.floor(r() * 9e6), 'INCOME_OTHER_INCOME');
      if (r() < 0.12) push(d, [40, 60, 100][Math.floor(r() * 3)], 'ATM WITHDRAWAL 0451 MAIN ST SMYRNA TN', 'TRANSFER_OUT_WITHDRAWAL');
      const k = dow === 0 ? 1 : 1 + Math.floor(r() * 3);
      for (let j = 0; j < k; j++) { const [desc, lo, hi, cat] = STORES[Math.floor(r() * STORES.length)]; push(d, amt(lo, hi), desc, cat); }
    }
    return out.sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
  }
  const api = { BANKS, ACCOUNTS, transactions, USER: 'user_good', PASS: 'pass_good' };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.KeptDemoBank = api;
})(typeof window !== 'undefined' ? window : globalThis);
