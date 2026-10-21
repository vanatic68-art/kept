/* Kept — read bank statements on-device (PDF, CSV, OFX/QFX, pasted text) and find repeating charges.
   Nothing leaves the phone. v1.3: positional PDF lines, sections, year inference, robust CSV,
   exclusions (checks, deposits, transfers, ATM, P2P, card payments), confidence scoring, multi-file merge. */
(function (root) {
  'use strict';
  const K = root.KeptCore || (typeof require !== 'undefined' ? require('./core.js') : null);
  const CD = root.KeptCancel || (typeof require !== 'undefined' ? (() => { try { return require('./cancel-directory.js'); } catch (e) { return null; } })() : null);

  const STATES = 'AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC';
  const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, SEPT: 9, OCT: 10, NOV: 11, DEC: 12 };
  const pad = n => String(n).padStart(2, '0');
  const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  const validMD = (m, d) => m >= 1 && m <= 12 && d >= 1 && d <= 31;
  const dayNum = s => Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 864e5);
  const daysBetween = (a, b) => dayNum(b) - dayNum(a);

  /* ---------- merchant names ---------- */
  function normalizeMerchant(raw) {
    let s = String(raw || '').toUpperCase().replace(/[\u0000-\u001f]/g, ' ');
    let m;
    if ((m = s.match(/ORIG CO NAME:\s*(.+?)\s+(?:ORIG ID|DESC DATE|CO ENTRY|SEC:|IND ID|IND NAME|TRACE)/))) s = m[1];
    else if ((m = s.match(/^(.+?)\s+DES:/))) s = m[1];
    s = s.replace(/\bINDN:.*?(?=\bCO ID\b|$)/g, ' ');
    s = s.replace(/https?:\/\//g, '').replace(/\bWWW\./g, '');
    s = s.replace(/\b(?:RECURRING\s+)?(?:PURCHASE|PAYMENT)?\s*AUTHORI[ZS]ED ON\s+\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?/g, ' ');
    s = s.replace(/\b\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?\b/g, ' ');            // dates
    s = s.replace(/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g, ' ');                   // phone
    s = s.replace(/\b\d{3}-[A-Z]{5,}\b/g, ' ');                                  // 800-COMCAST
    s = s.replace(/\b(?:CARD|CRD)\s*#?\s*[X*]*\d{4}\b/g, ' ').replace(/[X*]{2,}\d{2,4}\b/g, ' ');
    s = s.replace(/\b(?:STORE|STR|STE|UNIT|NO)\s*#?\s*\d+\b/g, ' ').replace(/#\s*\d+/g, ' ');
    s = s.replace(/\b[A-Z]{2}\s*\d{5}(?:-\d{4})?\b/g, ' ');                       // ST 37203
    s = s.replace(/\b(?:WITHDRAWAL DEBIT CARD|DEBIT CARD PURCHASE|DEBIT CARD|CARD PURCHASE|POS PURCHASE|POS DEBIT|POS|CHECK ?CARD|CHECKCARD|CARD PURCHASE(?: WITH PIN)?|PURCHASE(?: WITH PIN)?|DBT CRD|DEBIT CRD|VISA (?:CHECK|DEBIT)|PRE-?AUTHORI[ZS]ED|ELECTRONIC|EFT|ACH|WEB PMTS?|RECURRING|RECUR|AUTO ?-?PAY|BILL ?PAY(?:MENT)?|ONLINE PMT|DEBIT|WITHDRAWAL|PMTS?|PAYMT|PYMT|PPD|CCD|WEB ID|CO ID|WEB|TEL|INDN|TRACE|REF|CONF|MEMBERSHIP FEE|SUBSCRIPTION|VISA|MASTERCARD|MC|AMEX|DISCOVER)\b:?/g, ' ');
    s = s.replace(/^\s*(?:SQ|TST|SP|PP|PY|IN|DD|FS|BT|CKO|SMK|LS|GPS|PAYPAL|PAY PAL)\s*\*\s*/g, '');
    s = s.replace(/\*/g, ' ');
    s = s.replace(/\.(?:COM|NET|ORG|CO|IO|TV)\b/g, '');
    s = s.replace(/[^A-Z0-9+&'.\s-]/g, ' ');
    s = s.split(/\s+/).filter(t => t && !/^[\d.\-]+$/.test(t) && !(/\d{3,}/.test(t)) && t !== '-' && t !== '.').join(' ');
    s = s.replace(new RegExp('\\s+(?:' + STATES + ')$'), '').replace(/\s+US[A]?$/, '');
    s = s.replace(new RegExp('\\s+(?:' + STATES + ')$'), '');
    s = s.replace(/^CARD\s+/, '');
    s = s.split(' ').filter((t, i, a) => t && t !== a[i - 1]).join(' ');   // ALLY ALLY → ALLY
    return s.replace(/\s+/g, ' ').trim();
  }
  const GENERIC = new Set(['THE', 'CITY', 'STATE', 'FIRST', 'TOWN', 'COUNTY', 'BANK', 'ONLINE', 'NEW', 'AMERICAN', 'NATIONAL', 'TRANSFER', 'PAYMENT', 'CHECK', 'MOBILE', 'APPLE', 'AMAZON', 'GOOGLE', 'THE', 'SAMS', 'DOLLAR', 'MONTHLY']);
  function merchantKey(raw) {
    const toks = normalizeMerchant(raw).split(' ').filter(t => t.length > 1 || /[&+]/.test(t));
    if (!toks.length) return String(raw || '').toUpperCase().trim().slice(0, 20);
    if (toks[0].length >= 4 && !GENERIC.has(toks[0])) return toks[0];
    return toks.slice(0, 2).join(' ');
  }

  /* ---------- dates & amounts ---------- */
  function parseDateLoose(s) {
    s = String(s || '').trim(); let m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return ymd(+m[1], +m[2], +m[3]);
    if ((m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/))) {
      let a = +m[1], b = +m[2], y = +m[3]; if (y < 100) y += 2000;
      if (a > 12 && validMD(b, a)) return ymd(y, b, a);
      return validMD(a, b) ? ymd(y, a, b) : null;
    }
    if ((m = s.match(/^(\d{4})(\d{2})(\d{2})/))) return ymd(+m[1], +m[2], +m[3]);
    if ((m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/))) { const mo = MONTHS[m[1].slice(0, 4).toUpperCase()] || MONTHS[m[1].slice(0, 3).toUpperCase()]; if (mo) return ymd(+m[3], mo, +m[2]); }
    if ((m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[a-z]*[\s-](\d{2,4})/))) { const mo = MONTHS[m[2].toUpperCase()]; let y = +m[3]; if (y < 100) y += 2000; if (mo) return ymd(y, mo, +m[1]); }
    return null;
  }
  /** "1,234.56" "-15.49" "(15.49)" "15.49-" "$15.49 CR" → signed cents (null if not money). */
  function parseAmount(s) {
    if (s == null) return null;
    let t = String(s).trim(); if (!t) return null;
    let neg = false;
    if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
    if (/\s*(?:DR|-)$/i.test(t) && /\d/.test(t)) { neg = true; t = t.replace(/\s*(?:DR|-)$/i, ''); }
    t = t.replace(/\s*CR$/i, '');
    t = t.replace(/[$,\s]/g, '');
    if (t.startsWith('-')) { neg = true; t = t.slice(1); }
    if (t.startsWith('+')) t = t.slice(1);
    if (!/^\d+(?:\.\d{1,2})?$/.test(t)) return null;
    const c = Math.round(parseFloat(t) * 100);
    return neg ? -c : c;
  }

  /* ---------- classification ---------- */
  const RX = {
    check: /^\s*(?:CHECK|CHECK PAID|CHK|CHEQUE|SHARE DRAFT|DRAFT)\b\s*#?\s*\d*|\bCHECK\s*#\s*\d+|\bCHK\s*#?\s*\d{2,}|\bSHARE DRAFT\b|^\s*#?\d{3,6}\s*\*?\s*$|\bDRAFT\s*#?\s*\d{3,}/,
    notCheck: /\b(?:ACH|AUTO|ONLINE|E-?CHECK|CHECKCARD|CHECK CARD|CHECKING)\b/,
    transfer: /\b(?:TRANSFER|XFER|TRNSFR|TFR|TRANS TO|TRANS FROM|TO SAV|FROM SAV|TO CHK|FROM CHK|TO SHARE|FROM SHARE|SWEEP|INTERNAL TRANSFER|ONLINE BANKING TRANSFER)\b/,
    atm: /\bATM\b|\bCASH WITHDRAWAL\b|\bWITHDRAWAL AT\b|\bCASH ADVANCE\b|\bTELLER WITHDRAWAL\b|\bCOUNTER WITHDRAWAL\b/,
    p2p: /\bZELLE\b|\bVENMO\b|\bCASH ?APP\b|\bSQC\*|\bQUICKPAY\b|\bAPPLE CASH\b|\bPAYPAL INST(?:ANT)? XFER\b|\bPOPMONEY\b|\bP2P\b/,
    cardpay: /\b(?:CRCARDPMT|CRCARDPYMT|CARDMEMBER SERV|CREDIT CA?R?D (?:PMT|PAYMENT|AUTOPAY|EPAY)|CC (?:PMT|PAYMENT)|CARD (?:PMT|PAYMENT)|PAYMENT TO .*CARD|AMEX EPAYMENT|AMERICAN EXPRESS (?:ACH PMT|PAYMENT)|DISCOVER (?:E-?PAYMENT|DC PYMNT)|CITI (?:AUTOPAY|CARD ONLINE)|CAPITAL ONE (?:MOBILE PMT|ONLINE PMT|CRCARDPMT|AUTOPAY)|CHASE CREDIT CRD|SYNCHRONY (?:BANK )?(?:PMT|PAYMENT)|BARCLAYCARD|PAYMENT THANK YOU|THANK YOU FOR YOUR PAYMENT|AUTOPAY PAYMENT|ONLINE PAYMENT|MOBILE PAYMENT)\b/,
    other: /\b(?:LOAN|MORTGAGE|MTG|AUTO FIN|FINANCE|FINANCIAL|CREDIT ACCEPT|ALLY|TOYOTA|FORD CREDIT|GM FINANCIAL|HONDA FIN|NISSAN|SANTANDER|CARMAX|WESTLAKE|EXETER|NAVIENT|NELNET|MOHELA|SALLIE|STUDENT|INSURANCE|INS PREM|INSUR|GEICO|PROGRESSIVE|STATE FARM|ALLSTATE|NATIONWIDE|LIBERTY MUTUAL|FARMERS INS|ERIE INS|TRAVELERS|USAA|RENT|PROPERTY MGMT|APARTMENTS|HOA|ELECTRIC|POWER|ENERGY|WATER|SEWER|UTILIT|NES\b|MLGW|EPB|TVA|KUB|ATMOS|PIEDMONT|DUKE ENERGY|CHILD SUPPORT|IRS|TREAS|TAX)\b/,
    credit: /\b(?:DEPOSIT|DIRECT DEP|PAYROLL|REFUND|INTEREST PAID|INTEREST EARNED|CREDIT ADJ|REVERSAL|CASHBACK|RETURN)\b/,
    boost: /\b(?:RECURRING|RECUR|AUTOPAY|AUTO PAY|SUBSCR|SUBSCRIPTION|MEMBERSHIP|MONTHLY|PREMIUM|PLAN)\b/,
  };
  /** 'credit' | 'check' | 'transfer' | 'atm' | 'p2p' | 'cardpay' | 'other' | 'spend' */
  function classify(t) {
    const d = String((t.desc || '') + ' ' + (t.memo || '')).toUpperCase();
    const type = String(t.type || '').toUpperCase();
    if (t.cents > 0) return 'credit';
    if (t.checkNo || /CHECK_PAID|^CHECK$|^CHK$|SHARE DRAFT/.test(type) || (RX.check.test(d) && !RX.notCheck.test(d))) return 'check';
    // Linked-bank (Plaid) hints: personal_finance_category + payment-app counterparty
    const cat = String(t.pfc || '').toUpperCase();
    if (t.p2p) return 'p2p';
    if (cat) {
      if (/^TRANSFER_OUT_WITHDRAWAL|ATM/.test(cat)) return 'atm';
      if (/^TRANSFER_(?:OUT|IN)/.test(cat)) return RX.p2p.test(d) ? 'p2p' : 'transfer';
      if (/CREDIT_CARD_PAYMENT/.test(cat)) return 'cardpay';
      if (/^LOAN_PAYMENTS|^RENT_AND_UTILITIES_(?:RENT|GAS_AND_ELECTRICITY|WATER|SEWAGE)|INSURANCE/.test(cat)) return 'other';
    }
    if (/ACCT_XFER|TRANSFER/.test(type) || RX.transfer.test(d)) return 'transfer';
    if (/^ATM/.test(type) || RX.atm.test(d)) return 'atm';
    if (/QUICKPAY|ZELLE/.test(type) || RX.p2p.test(d)) return 'p2p';
    if (RX.cardpay.test(d)) return 'cardpay';
    if (/LOAN_PMT/.test(type) || RX.other.test(d)) return 'other';
    return 'spend';
  }

  /* ---------- CSV ---------- */
  function detectDelimiter(text) {
    const sample = text.split(/\r?\n/).slice(0, 20).join('\n');
    const counts = { ',': 0, ';': 0, '\t': 0, '|': 0 };
    for (const c of sample) if (c in counts) counts[c]++;
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }
  function csvRows(text, delim) {
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; continue; }
      if (c === '"') q = true;
      else if (c === delim) { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += c;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows.map(r => r.map(c => c.trim())).filter(r => r.some(c => c));
  }
  function splitCSVLine(line) { return csvRows(line, ',')[0] || []; }
  const HDR = {
    date: [/^(posting|posted|post) ?date$/, /^(transaction|trans\.?|txn) ?date$/, /^date$/, /date/],
    desc: [/^(description|transaction description|original description|payee|merchant|merchant name|name|narrative|transaction)$/, /description|payee|merchant/, /^details$/],
    memo: [/^(memo|notes?|extended description|additional (info|information)|reference|comments?)$/, /memo/],
    amount: [/^(amount|transaction amount|amt|amount \(usd\)|net amount)$/, /^amount(?!.*(debit|credit))/],
    debit: [/^(debit|debits|withdrawal|withdrawals|withdrawal amount|money out|paid out|amount debit|debit amount|charges?|payments? out|outflow)$/, /debit|withdraw/],
    credit: [/^(credit|credits|deposit|deposits|deposit amount|money in|paid in|amount credit|credit amount|inflow)$/, /credit|deposit/],
    type: [/^(type|transaction type|trans type|tran type|category type)$/, /^details$/],
    drcr: [/^(credit\/debit|debit\/credit|cr\/dr|dr\/cr|indicator|credit debit indicator)$/],
    check: [/^(check|check number|check no\.?|check #|check or slip #|chk|chk #|serial number|draft number)$/],
    balance: [/balance/],
  };
  const isHeaderCell = c => Object.values(HDR).some(list => list.some(r => r.test(c)));
  function parseCSV(text) {
    let raw = String(text).replace(/^\uFEFF/, '');
    const delim = detectDelimiter(raw);
    const rows = csvRows(raw, delim);
    if (!rows.length) return [];
    // header row: within the first 20 rows, the row with ≥2 known header names and no date, followed by a dated row
    let hIdx = -1;
    for (let i = 0; i < Math.min(20, rows.length); i++) {
      const cells = rows[i].map(c => c.toLowerCase());
      const hits = cells.filter(isHeaderCell).length;
      if (hits >= 2 && !rows[i].some(c => parseDateLoose(c)) && rows.slice(i + 1, i + 4).some(r => r.some(c => parseDateLoose(c)))) { hIdx = i; break; }
    }
    let col = { date: -1, desc: -1, memo: -1, amount: -1, debit: -1, credit: -1, type: -1, drcr: -1, check: -1, balance: -1 };
    if (hIdx >= 0) {
      const H = rows[hIdx].map(c => c.toLowerCase().trim());
      const used = new Set();
      for (const k of ['date', 'drcr', 'check', 'debit', 'credit', 'amount', 'balance', 'desc', 'memo', 'type']) {
        for (const r of HDR[k]) {
          const i = H.findIndex((h, j) => !used.has(j) && r.test(h));
          if (i >= 0) { col[k] = i; used.add(i); break; }
        }
      }
      // Chase checking: "Details" is DEBIT/CREDIT/CHECK; "Type" is ACH_DEBIT etc.
      const det = H.indexOf('details'); if (det >= 0 && col.desc !== det) col.drcr = col.drcr >= 0 ? col.drcr : det;
      if (col.desc < 0) col.desc = H.findIndex((h, j) => !used.has(j) && h);
    } else {
      // no header: guess by content of the first rows
      const sample = rows.slice(0, 15); const n = Math.max(...sample.map(r => r.length));
      const sc = Array.from({ length: n }, () => ({ date: 0, amt: 0, text: 0, len: 0 }));
      sample.forEach(r => r.forEach((c, i) => {
        if (parseDateLoose(c)) sc[i].date++;
        else if (parseAmount(c) != null && /\.\d{2}/.test(c)) sc[i].amt++;
        if (/[A-Za-z]{3,}/.test(c)) { sc[i].text++; sc[i].len += c.length; }
      }));
      col.date = sc.reduce((b, s, i, a) => s.date > a[b].date ? i : b, 0);
      const amtCols = sc.map((s, i) => [s.amt, i]).filter(([a, i]) => i !== col.date && a >= sample.length * 0.5).map(x => x[1]);
      col.amount = amtCols.length ? amtCols[0] : -1;
      col.desc = sc.reduce((b, s, i, a) => (i !== col.date && !amtCols.includes(i) && (b < 0 || s.len > a[b].len) ? i : b), -1);
    }
    const out = [];
    for (let r = hIdx + 1; r < rows.length; r++) {
      const c = rows[r];
      const date = col.date >= 0 ? parseDateLoose(c[col.date]) : null;
      if (!date) continue;
      let cents = null;
      const dr = col.drcr >= 0 ? String(c[col.drcr] || '').toUpperCase() : '';
      if (col.amount >= 0 && c[col.amount] !== '' && c[col.amount] != null) cents = parseAmount(c[col.amount]);
      if (cents == null && (col.debit >= 0 || col.credit >= 0)) {
        const d = col.debit >= 0 ? parseAmount(c[col.debit]) : null;
        const cr = col.credit >= 0 ? parseAmount(c[col.credit]) : null;
        if (d) cents = -Math.abs(d); else if (cr) cents = Math.abs(cr);
      }
      if (cents == null || cents === 0) continue;
      if (/^(DEBIT|DR|D|WITHDRAWAL|CHECK)$/.test(dr)) cents = -Math.abs(cents);
      else if (/^(CREDIT|CR|C|DEPOSIT|DSLIP)$/.test(dr)) cents = Math.abs(cents);
      let desc = col.desc >= 0 ? c[col.desc] || '' : '';
      const memo = col.memo >= 0 ? c[col.memo] || '' : '';
      // merchant often lives in Memo when Description is generic ("POS PURCHASE", "ACH DEBIT")
      if (memo && (!normalizeMerchant(desc) || normalizeMerchant(desc).length < 3 || /^(POS|ACH|DEBIT|WITHDRAWAL|PURCHASE|DEBIT CARD|POINT OF SALE|ELECTRONIC|EXTERNAL WITHDRAWAL|WITHDRAWAL DEBIT CARD)/i.test(desc))) desc = (desc + ' ' + memo).trim();
      if (!desc && memo) desc = memo;
      if (!desc) desc = '(no description)';
      const type = col.type >= 0 ? c[col.type] || '' : (dr === 'CHECK' ? 'CHECK' : '');
      const checkNo = col.check >= 0 && /^\d{2,}$/.test(String(c[col.check] || '').trim()) ? String(c[col.check]).trim() : '';
      out.push({ date, cents, desc: desc.replace(/\s+/g, ' ').trim(), memo, type, checkNo });
    }
    return fixSignConvention(out, !!(col.debit >= 0 || col.credit >= 0 || col.drcr >= 0));
  }
  /** Some exports show money OUT as positive (credit cards, some banks). Decide from the data. */
  function fixSignConvention(txs, signsKnown) {
    if (signsKnown || !txs.length) return txs;
    const neg = txs.filter(t => t.cents < 0).length;
    let creditLikeNeg = 0, creditLikePos = 0;
    txs.forEach(t => { if (RX.credit.test(t.desc.toUpperCase()) || RX.cardpay.test(t.desc.toUpperCase())) { if (t.cents < 0) creditLikeNeg++; else creditLikePos++; } });
    const flip = (creditLikeNeg > creditLikePos) || (neg === 0);
    if (neg === 0) { // all positive: everything is money out except obvious deposits/payments received
      return txs.map(t => ({ ...t, cents: RX.credit.test(t.desc.toUpperCase()) || /PAYMENT THANK YOU|THANK YOU FOR YOUR PAYMENT/.test(t.desc.toUpperCase()) ? Math.abs(t.cents) : -Math.abs(t.cents) }));
    }
    return flip ? txs.map(t => ({ ...t, cents: -t.cents })) : txs;
  }

  /* ---------- OFX / QFX ---------- */
  function parseOFX(text) {
    const txs = [];
    const blocks = String(text).split(/<STMTTRN>/i).slice(1);
    for (const b of blocks) {
      const field = n => { const m = b.match(new RegExp('<' + n + '>([^<>\\r\\n]+)', 'i')); return m ? m[1].trim() : ''; };
      const date = parseDateLoose((field('DTPOSTED') || field('DTUSER')).slice(0, 8));
      const cents = parseAmount(field('TRNAMT'));
      const name = field('NAME') || field('PAYEE'); const memo = field('MEMO');
      const desc = name && memo && normalizeMerchant(name).length < 3 ? name + ' ' + memo : (name || memo);
      const type = field('TRNTYPE'); const checkNo = field('CHECKNUM');
      if (date && cents != null && desc) txs.push({ date, cents, desc, memo, type, checkNo: /CHECK/i.test(type) || checkNo ? (checkNo || 'y') : '' });
    }
    return txs;
  }

  /* ---------- PDF ---------- */
  /** pdf.js text items per page → layout text: rows grouped by y, sorted by x, columns kept by spacing. */
  function layoutFromItems(pages) {
    const out = [];
    for (const items of pages) {
      const its = items.filter(i => i.str && i.str.trim());
      if (!its.length) { out.push(''); continue; }
      let cw = 0, cl = 0; its.forEach(i => { if (i.w > 0 && i.str.length) { cw += i.w; cl += i.str.length; } });
      const charW = cl ? Math.max(2, cw / cl) : 5;
      const sorted = [...its].sort((a, b) => b.y - a.y || a.x - b.x);
      const lines = [];
      for (const it of sorted) {
        const tol = Math.max(2, (it.h || 10) * 0.45);
        let ln = lines.find(l => Math.abs(l.y - it.y) <= tol);
        if (!ln) { ln = { y: it.y, items: [] }; lines.push(ln); }
        ln.items.push(it);
      }
      lines.sort((a, b) => b.y - a.y);
      const minX = Math.min(...its.map(i => i.x));
      for (const ln of lines) {
        ln.items.sort((a, b) => a.x - b.x);
        let s = '';
        for (const it of ln.items) {
          const col = Math.round((it.x - minX) / charW);
          if (s.length < col) s += ' '.repeat(col - s.length);
          else if (s.length && !s.endsWith(' ')) s += (it.x - (ln._lastEnd || 0) > charW * 0.6 ? '  ' : ' ');
          s += it.str; ln._lastEnd = it.x + (it.w || it.str.length * charW);
        }
        out.push(s.replace(/\s+$/, ''));
      }
      out.push('\f');
    }
    return out.join('\n');
  }

  const AMT_RE = /(?<![\w.\/])(?:\(\s*)?-?\$?\s?\d{1,3}(?:,\d{3})*\.\d{2}(?:\s*\))?(?:-|\s?CR\b|\s?DR\b)?(?![\d\/])/g;
  const DATE_LEAD = /^\s*(?:(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?|([A-Za-z]{3})\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?)(?=\s|$)/;
  function findPeriod(text) {
    const T = String(text).slice(0, 20000);
    const D = '(\\d{1,2}\\/\\d{1,2}\\/\\d{2,4}|[A-Z][a-z]{2,8}\\.? \\d{1,2},? \\d{4})';
    const re = new RegExp(D + '\\s*(?:-|–|—|to|thru|through|until)\\s*' + D, 'i');
    const m = T.match(re);
    if (m) { const a = parseDateLoose(m[1]), b = parseDateLoose(m[2]); if (a && b && b >= a && daysBetween(a, b) < 400) return { start: a, end: b }; }
    const m2 = T.match(/(?:statement|closing|ending|period ending|as of)\s*(?:date)?\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4}|[A-Z][a-z]{2,8}\.? \d{1,2},? \d{4})/i);
    if (m2) { const b = parseDateLoose(m2[1]); if (b) return { start: K ? K.ymd(new Date(+b.slice(0, 4), +b.slice(5, 7) - 2, +b.slice(8, 10))) : b, end: b }; }
    const years = (T.match(/\b20\d{2}\b/g) || []).map(Number);
    if (years.length) { const y = years.sort((a, b) => years.filter(v => v === b).length - years.filter(v => v === a).length)[0]; return { start: y + '-01-01', end: y + '-12-31', guessed: true }; }
    return null;
  }
  function inferYear(m, d, period) {
    if (!period) return new Date().getFullYear();
    const ys = [+period.end.slice(0, 4), +period.start.slice(0, 4), +period.end.slice(0, 4) - 1];
    let best = ys[0], bestDist = 1e9;
    for (const y of ys) {
      const s = ymd(y, m, d);
      const dist = s < period.start ? daysBetween(s, period.start) : s > period.end ? daysBetween(period.end, s) : 0;
      if (dist < bestDist) { bestDist = dist; best = y; }
    }
    return best;
  }
  const SECTION_RX = [
    ['ignore', /daily (?:ending |ledger |collected )?balances?|ending balance on|interest charge calculation|year.to.date|ytd totals|overdraft (?:and returned item )?fees? summary|totals? for this period|important information|in case of errors|rewards summary|fees summary|^\s*balance\s*$|checks? (?:summary|images?)|average (?:daily|ledger)/i],
    ['check', /^\s*(?:paid |cleared )?(?:checks|check|share drafts?|drafts)(?:\s+(?:paid|cleared|posted|presented|written|and substitute checks))?\s*(?:\(continued\))?\s*$/i],
    ['credit', /^(?!.*(?:debit|withdraw|subtraction|purchase|charge))\s*(?:.*\b(?:deposits?|credits?|additions|payments and (?:other )?credits|interest paid)\b.*)$/i],
    ['debit', /\b(?:withdrawals?|debits?|subtractions|purchases?|electronic payments|card (?:transactions|activity)|fees(?: charged)?|interest charged|other debits|ach debits|payments sent|bill payments|checks and other debits)\b/i],
    ['register', /^\s*(?:transactions?|account activity|transaction (?:detail|history)|activity detail|(?:share|checking|savings) (?:account )?activity)\s*(?:\(continued\))?\s*$/i],
  ];
  function headingType(line) {
    const t = line.trim();
    if (!t || t.length > 70 || DATE_LEAD.test(t)) return null;
    if (/\d{1,3}(?:,\d{3})*\.\d{2}/.test(t) && !/^total/i.test(t)) return null;
    if (/^total/i.test(t)) return null;
    for (const [type, rx] of SECTION_RX) if (rx.test(t)) return type;
    return null;
  }
  function tableHeader(line) {
    const L = line.toLowerCase();
    const has = w => L.search(w);
    const cols = {};
    const add = (k, re) => { const m = L.match(re); if (m) cols[k] = m.index + m[0].length; };
    add('debit', /\b(withdrawals?|debits?|subtractions|money out|charges)\b(?:\s*\(-\))?/);
    add('credit', /\b(deposits?|credits?|additions|money in|payments)\b(?:\s*\(\+\))?/);
    add('balance', /\bbalance\b/);
    add('amount', /\bamount\b/);
    const n = ['date', 'description', 'transaction', 'check', 'posted', 'details'].filter(w => has(w) >= 0).length + Object.keys(cols).length;
    if (n >= 3 && /date|posted/.test(L)) return cols;
    return null;
  }
  const isNoise = l => /^\s*(?:page\s+\d+\s*(?:of\s*\d+)?|\d+\s+of\s+\d+|member fdic|equal housing|continued on next page|\(continued\)|account (?:number|#|no)\b|.*\bcustomer service\b|www\.|.*\.com\s*$)/i.test(l);

  /** Parse text from a PDF (layout text) or pasted statement text. */
  function parsePDFText(text, opts = {}) {
    const T = String(text || '');
    const period = opts.period || findPeriod(T);
    const isCard = /minimum payment due|credit limit|new balance|payment due date|cardmember|available credit/i.test(T);
    const lines = T.split(/\r?\n/);
    const txs = [];
    let section = null, cols = null, prevBal = null, last = null, lastLineIdx = -2;
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li].replace(/\f/g, '');
      if (!line.trim()) continue;
      const th = tableHeader(line);
      if (th) { cols = th; if (section === 'ignore') section = null; continue; }
      const h = headingType(line);
      if (h) { section = h; cols = null; last = null; continue; }
      if (isNoise(line)) continue;
      const balLine = line.match(/\b(?:beginning|previous|opening|starting)\s+balance\b.*?(-?\$?\d{1,3}(?:,\d{3})*\.\d{2}-?)/i);
      if (balLine) { prevBal = parseAmount(balLine[1]); continue; }
      if (/^\s*(?:total|subtotal|ending balance|closing balance|new balance|balance forward)\b/i.test(line)) { last = null; continue; }
      if (section === 'ignore') continue;

      const dm = line.match(DATE_LEAD);
      // Checks table: "1043  07/05  650.00   1044* 07/19  650.00" (several per row)
      if (section === 'check') {
        const re = /(?:^|\s)(\d{2,6})\s*[*^#]?\s+(\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?)\s+\$?(\d{1,3}(?:,\d{3})*\.\d{2})|(?:^|\s)(\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?)\s+(\d{2,6})\s*[*^#]?\s+\$?(\d{1,3}(?:,\d{3})*\.\d{2})/g;
        let m, any = false;
        while ((m = re.exec(line))) {
          any = true;
          const num = m[1] || m[5], ds = m[2] || m[4], amt = m[3] || m[6];
          const date = resolveDate(ds, period); const c = parseAmount(amt);
          if (date && c) txs.push({ date, cents: -Math.abs(c), desc: 'CHECK ' + num, checkNo: num, section: 'check' });
        }
        if (any) continue;
      }
      let rest, date;
      if (dm) {
        date = resolveDate(dm[0].trim(), period);
        rest = line.slice(dm[0].length);
        const dm2 = rest.match(DATE_LEAD); if (dm2) rest = rest.slice(dm2[0].length); // trans + post date
      } else if (last && (section || cols) && section !== 'check' && li - lastLineIdx <= 3) {
        // no date: continuation of the previous description, or another item on the same day
        const am = line.match(AMT_RE);
        if (!am) { if (/[A-Za-z]{2}/.test(line) && last.desc.length < 90) { last.desc = (last.desc + ' ' + line.trim().replace(/\s{2,}/g, ' ')).trim(); lastLineIdx = li; } continue; }
        date = last.date; rest = line;
      } else continue;
      if (!date) continue;
      const amts = []; let m; AMT_RE.lastIndex = 0;
      while ((m = AMT_RE.exec(rest))) amts.push({ str: m[0], end: m.index + m[0].length, idx: m.index, cents: parseAmount(m[0]) });
      if (!amts.length) {
        // description on this line, amount on the next line(s)
        if (/[A-Za-z]{3}/.test(rest)) { const nxt = (lines[li + 1] || '').trim(); const am2 = nxt.match(AMT_RE); if (am2 && !DATE_LEAD.test(nxt) && nxt.replace(AMT_RE, '').trim().length < 3) { amts.push({ str: am2[0], end: rest.length, idx: rest.length, cents: parseAmount(am2[0]) }); li++; } }
        if (!amts.length) continue;
      }
      let desc = rest.slice(0, amts[0].idx).replace(/\s{2,}/g, ' ').trim();
      if (/^(?:beginning|ending|closing|opening|previous|new|statement)\s+balance\b|^balance (?:forward|this statement)|^(?:total|subtotal)\b/i.test(desc)) { last = null; const b = amts[amts.length - 1]; if (b) prevBal = b.cents; continue; }
      const tail = rest.slice(amts[amts.length - 1].end).trim(); if (tail && /[A-Za-z]{3}/.test(tail) && !/^(CR|DR)$/i.test(tail)) desc = (desc + ' ' + tail).trim();
      desc = desc.replace(/^[\s\-–|*]+/, '').trim();
      // checks inside mixed tables: "CHECK 1043" or a bare check number as description
      let checkNo = '';
      const cm = desc.match(/^(?:CHECK|CHK|SHARE DRAFT|DRAFT)\s*#?\s*(\d{2,6})\b|^#?(\d{3,6})\s*\*?$/i);
      if (cm) checkNo = cm[1] || cm[2];
      if (!checkNo && !/[A-Za-z]{2}/.test(desc)) continue; // daily-balance rows etc.
      // which amount is the transaction and which way does it go?
      let a = amts[0], sign = null;
      const pos = s => (s.end + (cols && cols._off || 0));
      if (cols && (cols.debit != null || cols.credit != null) && amts.length) {
        const off = line.length - rest.length;
        const nearest = am => { let best = null, bd = 1e9; for (const k of ['debit', 'credit', 'balance', 'amount']) if (cols[k] != null) { const d = Math.abs(cols[k] - (am.end + off)); if (d < bd) { bd = d; best = k; } } return best; };
        const tagged = amts.map(am => ({ am, k: nearest(am) }));
        const tx = tagged.find(t => t.k === 'debit' || t.k === 'credit' || t.k === 'amount');
        if (tx) { a = tx.am; if (tx.k === 'debit') sign = -1; else if (tx.k === 'credit') sign = 1; }
        const bal = tagged.find(t => t.k === 'balance'); if (bal && bal.am !== a) { if (sign == null && prevBal != null) sign = bal.am.cents - prevBal < 0 ? -1 : 1; prevBal = bal.am.cents; }
      } else if (amts.length >= 2) {
        const bal = amts[amts.length - 1];
        if (prevBal != null) { const diff = bal.cents - prevBal; if (Math.abs(Math.abs(diff) - Math.abs(a.cents)) <= 1) sign = diff < 0 ? -1 : 1; }
        prevBal = bal.cents;
      }
      let cents = Math.abs(a.cents || 0); if (!cents) continue;
      const explicitNeg = a.cents < 0, explicitCr = /CR\b/i.test(a.str);
      if (sign == null) {
        if (section === 'debit' || section === 'check') sign = -1;
        else if (section === 'credit') sign = 1;
        else if (explicitCr) sign = 1;
        else if (explicitNeg) sign = isCard ? 1 : -1;
        else if (checkNo) sign = -1;
        else if (RX.credit.test(desc.toUpperCase()) || (isCard && RX.cardpay.test(desc.toUpperCase()))) sign = 1;
        else sign = -1;
      }
      last = { date, cents: sign * cents, desc: checkNo && !/[A-Za-z]/.test(desc) ? 'CHECK ' + checkNo : desc, checkNo, section: section || '' };
      txs.push(last); lastLineIdx = li;
    }
    return txs;
  }
  function resolveDate(s, period) {
    s = String(s).trim(); let m;
    if ((m = s.match(/^(\d{1,2})[\/-](\d{1,2})$/))) { const mo = +m[1], d = +m[2]; if (!validMD(mo, d)) return null; return ymd(inferYear(mo, d, period), mo, d); }
    if ((m = s.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})$/))) { const mo = MONTHS[m[1].toUpperCase()]; if (!mo) return null; return ymd(inferYear(mo, +m[2], period), mo, +m[2]); }
    return parseDateLoose(s.replace(/,/g, ''));
  }

  /* ---------- format detection ---------- */
  function parseText(text, name) {
    name = String(name || '').toLowerCase();
    const t = String(text || '');
    if (/OFXHEADER|<OFX>|<STMTTRN>/i.test(t) || /\.(ofx|qfx)$/.test(name)) return { format: 'ofx', transactions: parseOFX(t) };
    const lines = t.split(/\r?\n/).filter(l => l.trim());
    const delimLines = lines.filter(l => /[,;\t|]/.test(l) && (l.match(/[,;\t|]/g) || []).length >= 2).length;
    let tx = delimLines >= Math.min(3, lines.length) * 0.5 ? parseCSV(t) : [];
    if (tx.length >= 2) return { format: 'csv', transactions: tx };
    const ptx = parsePDFText(t);
    return ptx.length >= tx.length ? { format: 'text', transactions: ptx, period: findPeriod(t) } : { format: 'csv', transactions: tx };
  }
  async function parseFile(file, pdfExtractor) {
    const name = (file.name || '').toLowerCase();
    const type = (file.type || '').toLowerCase();
    const headBytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    const head = String.fromCharCode.apply(null, Array.from(headBytes));
    if (head.startsWith('%PDF') || (!head.trim() && name.endsWith('.pdf')) || (type === 'application/pdf' && !/\.(csv|txt|ofx|qfx)$/.test(name))) {
      if (!pdfExtractor) throw new Error('PDF needs pdf.js');
      const ex = await pdfExtractor(file);                 // { pages: [[{str,x,y,w,h}]] } or plain text
      const text = typeof ex === 'string' ? ex : layoutFromItems(ex.pages);
      if (text.replace(/\s/g, '').length < 40) { const e = new Error('scanned-pdf'); e.code = 'scanned-pdf'; throw e; }
      const period = findPeriod(text);
      return { format: 'pdf', transactions: parsePDFText(text, { period }), period, text };
    }
    if (head.startsWith('PK') || (headBytes[0] === 0xD0 && headBytes[1] === 0xCF)) { const e = new Error('spreadsheet'); e.code = 'spreadsheet'; throw e; }
    return parseText(await file.text(), name);
  }

  /* ---------- merging several statements ---------- */
  const txKey = t => t.date + '|' + t.cents + '|' + normalizeMerchant(t.desc).replace(/\s/g, '').slice(0, 24);
  /** Overlapping statements: the same transaction in two files counts once (identical same-day charges within one file are kept). */
  function mergeTransactions(lists) {
    const max = new Map(), sample = new Map();
    for (const list of lists) {
      const cnt = new Map();
      for (const t of list) { const k = txKey(t); cnt.set(k, (cnt.get(k) || 0) + 1); if (!sample.has(k)) sample.set(k, []); if (sample.get(k).length < cnt.get(k)) sample.get(k).push(t); }
      for (const [k, c] of cnt) max.set(k, Math.max(max.get(k) || 0, c));
    }
    const out = [];
    for (const [k, c] of max) out.push(...sample.get(k).slice(0, c));
    return out.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  }
  function dateRange(txs) { if (!txs.length) return null; let a = txs[0].date, b = txs[0].date; txs.forEach(t => { if (t.date < a) a = t.date; if (t.date > b) b = t.date; }); return { from: a, to: b, days: daysBetween(a, b) + 1 }; }

  /* ---------- recurring detection ---------- */
  function median(arr) { if (!arr.length) return 0; const a = [...arr].sort((x, y) => x - y); const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; }
  const CADENCES = [
    { id: 'weekly', period: 7, lo: 5, hi: 9, minN: 3, perMonth: 52 / 12 },
    { id: 'biweekly', period: 14, lo: 12, hi: 17, minN: 3, perMonth: 26 / 12 },
    { id: 'monthly', period: 30.4, lo: 25, hi: 36, minN: 2, perMonth: 1 },
    { id: 'bimonthly', period: 61, lo: 54, hi: 68, minN: 2, perMonth: 0.5 },
    { id: 'quarterly', period: 91, lo: 82, hi: 100, minN: 2, perMonth: 1 / 3 },
    { id: 'yearly', period: 365, lo: 340, hi: 390, minN: 2, perMonth: 1 / 12 },
  ];
  function clusterAmounts(list, tolPct, tolCents) {
    const sorted = [...list].sort((a, b) => a.abs - b.abs);
    const clusters = [];
    for (const t of sorted) {
      const c = clusters.find(c => { const m = median(c.map(x => x.abs)); return Math.abs(t.abs - m) <= Math.max(tolCents, m * tolPct); });
      if (c) c.push(t); else clusters.push([t]);
    }
    return clusters;
  }
  function cadenceFor(dates) {
    const uniq = [...new Set(dates)].sort();
    if (uniq.length < 2) return null;
    const gaps = []; for (let i = 1; i < uniq.length; i++) gaps.push(daysBetween(uniq[i - 1], uniq[i]));
    const med = median(gaps);
    for (const c of CADENCES) {
      if (med < c.lo || med > c.hi || uniq.length < c.minN) continue;
      // a gap that's ~2× or 3× the period (a skipped/missed month) still counts as consistent
      const ok = gaps.filter(g => { const k = Math.max(1, Math.round(g / c.period)); return k <= 3 && g >= c.lo * k && g <= c.hi * k; }).length;
      const consistency = ok / gaps.length;
      if (consistency >= 0.7) return { ...c, consistency, medGap: med, n: uniq.length };
    }
    if (med <= 2 && uniq.length >= 10) return { id: 'daily', period: 1, perMonth: 30, consistency: 0.8, medGap: med, n: uniq.length };
    return null;
  }
  const dayDiff = (a, b) => { const d = Math.abs(a - b); return Math.min(d, 31 - d); };
  /** Full analysis of debits: subscriptions (high/possible), other repeating payments, and what was skipped. */
  function analyze(transactions, opts = {}) {
    const range = dateRange(transactions);
    const excluded = { check: 0, credit: 0, transfer: 0, atm: 0, p2p: 0, cardpay: 0 };
    const pool = [];
    for (const t of transactions) {
      const cat = t.category || classify(t);
      if (cat in excluded) { excluded[cat]++; continue; }
      const abs = Math.abs(t.cents); if (abs < 100) continue;
      pool.push({ ...t, abs, cat, key: merchantKey(t.desc), norm: normalizeMerchant(t.desc) });
    }
    // words that end descriptions of several different merchants are places (GALLATIN, NEW YORK) — trim them from labels
    const tailKeys = new Map();
    pool.forEach(t => { const w = t.norm.split(' '); for (let i = Math.max(1, w.length - 2); i < w.length; i++) { if (!tailKeys.has(w[i])) tailKeys.set(w[i], new Set()); tailKeys.get(w[i]).add(t.key); } });
    const place = w => (tailKeys.get(w) || new Set()).size >= 2;
    const trimPlace = lbl => { const w = lbl.split(' '); while (w.length > 1 && place(w[w.length - 1])) w.pop(); return w.join(' '); };
    const groups = new Map();
    for (const t of pool) { if (!groups.has(t.key)) groups.set(t.key, []); groups.get(t.key).push(t); }
    const found = [], other = [];
    for (const [gkey, list] of groups) {
      if (list.length < 2) continue;
      const isOther = list.filter(t => t.cat === 'other').length > list.length / 2;
      for (const cl of clusterAmounts(list, isOther ? 0.35 : 0.1, isOther ? 1500 : 200)) {
        if (cl.length < 2) continue;
        cl.sort((a, b) => a.date < b.date ? -1 : 1);
        const cad = cadenceFor(cl.map(t => t.date));
        if (!cad) continue;
        const days = cl.map(t => +t.date.slice(8, 10));
        if (cad.id === 'monthly' && cl.length === 2 && dayDiff(days[0], days[1]) > 4) continue;
        const amts = cl.map(t => t.abs); const typical = Math.round(median(amts));
        const identical = amts.every(a => Math.abs(a - typical) <= Math.max(5, typical * 0.01));
        // A store he shops at often (Lowe's, Kroger) can repeat an amount by chance — demand more evidence.
        const busyStore = list.length >= 5 && cl.length / list.length < 0.6;
        if (!isOther && cl.length === 2 && !identical) continue;
        if (!isOther && busyStore && (cl.length < 3 || !identical)) continue;
        if (!isOther && cl.length === 2 && cad.id !== 'monthly' && !(CD && CD.match && CD.match(cl[0].desc)) && !cl.some(t => RX.boost.test(String(t.desc).toUpperCase()))) continue;
        const labelCounts = {}; cl.forEach(t => { labelCounts[t.norm] = (labelCounts[t.norm] || 0) + 1; });
        const label = trimPlace(Object.entries(labelCounts).sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0] || gkey);
        const cat = CD && CD.match ? (CD.match(label) || CD.match(cl.map(t => t.desc).join(' '))) : null;
        const lastDate = cl[cl.length - 1].date;
        let score = Math.min(cad.n, 6) * 10 + cad.consistency * 30 + (identical ? 15 : 0);
        const reasons = [];
        if (cl.some(t => RX.boost.test(String(t.desc).toUpperCase()))) { score += 20; reasons.push('marked recurring'); }
        if (cat) { score += 25; reasons.push('known subscription'); }
        if (cad.id === 'daily') score -= 25;
        if (range && daysBetween(lastDate, range.to) > cad.period * 1.6 + 5) { score -= 25; reasons.push('may have stopped'); }
        const dayMode = +Object.entries(days.reduce((o, d) => (o[d] = (o[d] || 0) + 1, o), {})).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
        const item = {
          key: merchantKey(label) + (cl.length !== list.length ? ':' + Math.round(typical / 100) : ''), label, typicalCents: typical, day: dayMode,
          frequency: cad.id, medGap: cad.medGap, monthlyCents: Math.round(typical * cad.perMonth),
          lastDate, firstDate: cl[0].date, count: cl.length, score: Math.round(score), confidence: score >= 70 ? 'high' : 'possible',
          catalogId: cat ? cat.id : null, reasons,
          samples: cl.slice(-4).map(t => ({ date: t.date, cents: t.abs, desc: t.desc })),
        };
        (isOther ? other : found).push(item);
      }
    }
    const order = (a, b) => (a.confidence === b.confidence ? 0 : a.confidence === 'high' ? -1 : 1) || b.monthlyCents - a.monthlyCents;
    found.sort(order); other.sort(order);
    return { found, other, excluded, range, txCount: transactions.length, debitCount: pool.length };
  }
  function detectSubscriptions(transactions, opts) { return analyze(transactions, opts).found; }

  const api = { normalizeMerchant, merchantKey, parseDateLoose, parseAmount, parseCSV, splitCSVLine, parseOFX, parsePDFText, layoutFromItems, findPeriod, parseText, parseFile, classify, mergeTransactions, dateRange, analyze, detectSubscriptions };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.KeptStatement = api;
})(typeof window !== 'undefined' ? window : globalThis);
