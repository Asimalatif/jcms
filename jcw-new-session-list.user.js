// ==UserScript==
// @name         JCW New Session List (Transform)
// @namespace    jcw-attendance
// @version      1.6
// @description  Reads the 1st Year students of the new session from the UOP portal (read-only) and makes an Excel file in the exact Transform-ALL-COLLEGE-STRENGTH columns: one sheet each for F.A, Pre-Engineering, FCS, Pre-Medical (S) subsidized, Pre-Medical (M) and Pre-Medical (E), with Aggregate, MeritNo, Age-wise, Enroll#, section, PCS and room by the JCW merit rules.
// @match        https://portal.uop.edu.pk/Student/Students*
// @match        https://portal.uop.edu.pk/student/students*
// @require      https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// ==/UserScript==
/*
 * READ-ONLY on the portal: nothing is saved or changed there. Same reading as "JCW Portal Sync".
 * 1. Open Student > Students on the portal (logged in). 2. Check the settings in the small panel. 3. Press "Make the Excel file".
 * Reading every student's details takes about 20-40 minutes for 1,200 students (it can be resumed after a logout).
 * Paste each sheet's rows (without the heading row) under the last row of Transform-ALL-COLLEGE-STRENGTH: the columns are the same.
 */
(function () {
  'use strict';
  const INSTITUTE_ID = '1212';                 // Jinnah College for Women
  const LIST_PAGE_SIZE = 500, CONCURRENCY = 4;
  const PHOTO_BASE_URL = 'https://portal.uop.edu.pk/images/StudentPhoto/';
  const SAVE_KEY = 'JCW-NEWLIST-1';

/*ENGINE-START*/
  /* ===================== SETTINGS (the panel can change the first ones; they are remembered) ===================== */
  const DEFAULTS = {
    session: '2027-28',          // SESSION column
    year: '27',                  // Enroll# JCW-F27-…  (F = Fall, 27 = admission year)
    snoStart: 1,                 // S.No of the first student (last S.No of Transform + 1)
    lastDate: '',                // last date of admission dd/mm/yyyy: fee paid after it = late (empty = everyone on time)
    evening: false,              // Evening Pre-Medical admitting this year? (late Pre-Medical students go to (E))
    openSub: 85,                 // Pre-Medical subsidized Open Quota seats
    subFee: 60000                // Pre-Medical subsidized fee (all fee challans together); self-finance = 120000 (often 60000 paid + 60000 unpaid)
  };
  const TRANSFORM_HEAD = ['S.No', 'Enroll#', 'Student Name', 'Father Name', 'Program/Class/Section', 'Program', 'Class', 'Section', 'PCS',
    'Sub1', 'Sub2', 'Sub3', 'Sub4', 'Sub5', 'Sub6', 'Sub7', 'Appeared in', 'Quota', 'DOB', 'GroupOnly', 'Obtained Marks', 'Total Marks', 'MeritNo', 'HQ',
    'Aggregate', 'Room', 'Pic URL', 'REG#', 'BATCH', 'SESSION', 'STATUS', 'STUDENT CONTACT', 'EMAIL', 'PHOTO', 'BOARD', 'PASSING YEAR', 'MATRIC ROLL NO',
    'PERCENTAGE', 'CHALLAN DETAILS', 'PORTAL ID', 'Age-wise', 'FEE PAID DATE', 'FEE RECEIPT DATE', 'FEE DATE NOTE'];
  /* one sheet per admission program; roll ranges and sections as in session 2026-27 (rooms from the 2026-27 timetable) */
  const SHEETS = [
    { key: 'FA',  name: 'F.A',              program: 'F.A (JCW)',             appeared: 'F.A',                        roll: [2101, 2299],
      sections: [['A', 'F.A-1 A', 'R # J.C 1'], ['B', 'F.A-1 B', 'R # J.C 2']], subjects: [] },
    { key: 'PE',  name: 'Pre-Engineering',  program: 'Pre-Engineering (JCW)', appeared: 'FSC (PRE-ENGINEERING)',      roll: [2001, 2099],
      sections: [['D1', 'Pre-Eng-1 D1', 'R # 08/40']], subjects: ['PHYSICS', 'MATHEMATICS', 'CHEMISTRY'] },
    { key: 'FCS', name: 'FCS',              program: 'FCS (JCW)',             appeared: 'GENERAL / COMPUTER SCIENCE', roll: [2301, 2399],
      sections: [['D2', 'FCS-1 D2', 'R # ELECT LAB'], ['D3', 'FCS-1 D3', 'R # 2']], subjects: ['PHYSICS', 'MATHEMATICS', 'COMPUTER SCIENCE'] },
    { key: 'PMS', name: 'Pre-Medical (S)',  program: 'Pre-Medical (JCW)',     appeared: 'FSC (PRE-MEDICAL)',          roll: [1, 203],
      sections: [['A', 'A1', 'R # 10'], ['B', 'B1', 'R # 06/55'], ['C', 'C1', 'R # 07/55']], subjects: ['PHYSICS', 'BOTANY', 'CHEMISTRY'] },
    { key: 'PMM', name: 'Pre-Medical (M)',  program: 'Pre-Medical (JCW)',     appeared: 'FSC (PRE-MEDICAL)',          roll: [204, 1099],
      sections: [['E', 'E1', 'R # 3'], ['F', 'F1', 'R # 18'], ['G', 'G1', 'R # 19'], ['H', 'H1', 'R # 24/60'], ['I', 'I1', 'R # 05/40'], ['J', 'J1', 'R # 23/60'],
                 ['K', 'K1', 'R # 17'], ['L', 'L1', 'R # 4'], ['M', 'M1', 'R # 15/55'], ['N', 'N1', 'R # 20/60'], ['O', 'O1', 'R # 21/60'], ['P', 'P1', 'R # 22/60'],
                 ['Q', 'Q1', 'R # 16'], ['R', 'R1', 'R # 14']], subjects: ['PHYSICS', 'BOTANY', 'CHEMISTRY'] },
    { key: 'PME', name: 'Pre-Medical (E)',  program: 'Pre-Medical (JCW)',     appeared: 'FSC (PRE-MEDICAL)',          roll: [1100, 1999],
      sections: [['S', 'S1', ''], ['T', 'T1', '']], subjects: ['PHYSICS', 'BOTANY', 'CHEMISTRY'] }
  ];
  const COMPULSORY = ['ENGLISH', 'URDU', 'ISLAMIYAT', 'MUTALIA QURAN'];
  const OPEN = 'Open Quota', UOP = 'UoP Employee Quota';
  /* Pre-Medical subsidized (S) seats of the special quotas; more students of a quota go to (M). UoP Employee Quota: no limit, always (S). */
  const SUB_SEATS = { 'O-Level Quota': 6, 'Agriculture University Quota': 2, 'Disabled Quota': 1, 'FATA IN Quota': 2, 'Foreign Nationals': 2,
    'Minority Quota': 1, 'Pakistan Forest Institute Quota': 2 };
  /* seats shared by several programs (one merit list across them) */
  const POOLS = { 'Afghan Quota': { seats: 5, programs: ['PMS', 'PE', 'FCS'] }, 'Sports Quota': { seats: 6, programs: ['FA', 'FCS', 'PE', 'PMS'] },
    'UET Quota': { seats: 8, programs: ['FA', 'FCS', 'PE', 'PMS'] } };
  /* seats of the special quotas in the other programs (only for the over-seat notes; Open Quota has no limit) */
  const OTHER_SEATS = { FA: { 'Afghan Quota': 1, 'Agriculture University Quota': 1, 'Disabled Quota': 1, 'FATA IN Quota': 2, 'Foreign Nationals': 2,
      'Minority Quota': 1, 'O-Level Quota': 2, 'Pakistan Forest Institute Quota': 1 }, PE: {}, FCS: {},
    PMM: { 'Agriculture University Quota': 3, 'O-Level Quota': 8, 'UET Quota': 3 } };

  const sp = v => String(v ?? '').replace(/\s+/g, ' ').trim();
  const numOf = v => { const n = parseFloat(String(v ?? '').replace(/,/g, '').replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : null; };
  /** dd/mm/yyyy (or yyyy-mm-dd) -> yyyymmdd number for comparing; '' -> null */
  const dkey = s => { s = sp(s); let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/); if (m) return +(m[3] + m[2].padStart(2, '0') + m[1].padStart(2, '0'));
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? +(m[1] + m[2] + m[3]) : null; };
  const ordinal = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
  function quotaOf(c) {
    c = sp(c); if (!c) return OPEN;
    if (/^open|merit|general|self/i.test(c)) return OPEN;
    if (/uop|university of peshawar|employee/i.test(c) && !/agri|uet|engineering/i.test(c)) return UOP;
    const known = Object.keys(SUB_SEATS).concat(Object.keys(POOLS));
    return known.find(k => k.toLowerCase() === c.toLowerCase()) || c.replace(/\b\w/g, x => x.toUpperCase());
  }
  function programKey(p) {
    p = sp(p).toLowerCase();
    if (/pre.?med|medical/.test(p)) return 'PM';
    if (/engg|engineer/.test(p)) return 'PE';
    if (/fcs|computer/.test(p)) return 'FCS';
    if (/\bf\.?\s?a\b|arts|humanit/.test(p)) return 'FA';
    return '';
  }

  /** students: rows read from the portal (list + details). Returns { sheets: {name: [rows]}, notes: [[...]], seats: [[...]] } */
  function build(students, cfg) {
    cfg = Object.assign({}, DEFAULTS, cfg || {});
    const last = dkey(cfg.lastDate), notes = [];
    const S = students.map(s => {
      const obt = numOf(s['Obtain Marks/CGPA']), tot = numOf(s['Total Marks/CGPA']), hq = /^y/i.test(s['HQ'] || '') ? 'Yes' : 'No';
      const agg = obt !== null && tot ? Math.round((obt + (hq === 'Yes' ? 20 : 0)) * 100 / tot * 100) / 100 : null;
      const fee = dkey(s['Fee Paid Date']), dob = dkey(s['DOB']);
      // fee challans above Rs 3,000 (paid P- and unpaid U-): their total says subsidized (60,000) or self-finance (120,000)
      let feeTotal = 0, feePaid = 0;
      String(s['Challan Details'] || '').split(',').forEach(c => { const m = c.trim().match(/^([PU])-([\d.]+)/i); if (!m || +m[2] <= 3000) return; feeTotal += +m[2]; if (/p/i.test(m[1])) feePaid += +m[2]; });
      const quota = quotaOf(s['Category']), emp = quota === UOP;   // UoP employees: always subsidized, they pay no fee (the portal's challans for them mean nothing)
      const o = { s, pk: programKey(s['Program']), quota, emp, hq, obt, tot, agg, dob, fee, late: !emp && !!(last && fee && fee > last), flag: '', why: '',
        feeTotal, subFee: !emp && feePaid > 0 && feeTotal <= Number(cfg.subFee || 60000) };
      if (emp && agg !== null && agg < 50) { o.flag = 'red'; o.why = 'UoP Employee Quota needs at least 50% marks: her Aggregate is ' + agg + '. Kept on the subsidized seat; check her admission.'; }
      if (agg === null) notes.push([s['Student Name'], s['Father Name'], s['Program'], 'No matric marks on the portal: Aggregate and merit left empty, put at the end of the list.']);
      if (!dob) notes.push([s['Student Name'], s['Father Name'], s['Program'], 'No date of birth on the portal (age decides equal Aggregates).']);
      if (!fee && !emp) notes.push([s['Student Name'], s['Father Name'], s['Program'], 'No paid admission fee (above Rs 3,000) found on the portal.']);
      return o;
    }).filter(o => { if (!o.pk) { notes.push([o.s['Student Name'], o.s['Father Name'], o.s['Program'], 'Program not known: left out.']); return false; } return true; });
    /* merit order: on time first, higher Aggregate, then older (earlier DOB), then earlier fee date */
    const cmp = (a, b) => (a.late - b.late) || ((b.agg ?? -1) - (a.agg ?? -1)) || ((a.dob || 99999999) - (b.dob || 99999999)) || ((a.fee || 99999999) - (b.fee || 99999999))
      || sp(a.s['Student Name']).localeCompare(sp(b.s['Student Name']));
    S.sort(cmp);
    const sheetOf = new Map();
    // 1. Pre-Medical: UoP Employee -> (S); special quotas -> (S) up to their seats; top Open Quota (on time) -> (S)
    const PM = S.filter(o => o.pk === 'PM'), used = {};
    const pool = {}; Object.keys(POOLS).forEach(q => { pool[q] = 0; });
    // pooled quotas: one merit list across the programs of the pool (all programs, in merit order)
    S.filter(o => POOLS[o.quota] && POOLS[o.quota].programs.includes(o.pk === 'PM' ? 'PMS' : o.pk)).forEach(o => {   // a program outside the pool uses its own seats
      const P = POOLS[o.quota];
      if (!o.late && pool[o.quota] < P.seats) { pool[o.quota]++; o.inPool = true; }
      else if (o.pk !== 'PM') notes.push([o.s['Student Name'], o.s['Father Name'], o.s['Program'], o.quota + ': outside the ' + P.seats + ' shared seats (' + P.programs.join(', ') + '). Check her quota.']);
    });
    PM.forEach(o => {
      let k = 'PMM';
      if (o.quota === UOP) k = 'PMS';
      else if (POOLS[o.quota]) k = o.inPool ? 'PMS' : 'PMM';
      else if (SUB_SEATS[o.quota] !== undefined) { used[o.quota] = used[o.quota] || 0; if (!o.late && used[o.quota] < SUB_SEATS[o.quota]) { used[o.quota]++; k = 'PMS'; } }
      else if (o.quota === OPEN) {
        used[OPEN] = used[OPEN] || 0;
        if (!o.late && o.agg !== null && used[OPEN] < cfg.openSub) { used[OPEN]++; k = 'PMS'; used.cut = o.agg; }   // used.cut = Open Quota subsidized stopping merit
      }
      // the fee she paid decides (every quota): subsidized fee -> (S); in (S) but paid the self-finance fee -> stays, flagged
      const rs = n => 'Rs ' + n.toLocaleString('en-US');
      if (k !== 'PMS' && o.subFee) {
        k = 'PMS'; o.flag = 'yellow';
        const paid = 'Paid the subsidized fee (' + rs(o.feeTotal) + ')';
        o.why = o.late ? paid + ' on ' + sp(o.s['Fee Paid Date']) + ', after the last date of admission (' + cfg.lastDate + '), so the merit list gave the subsidized seats to on-time students (her Aggregate ' + (o.agg ?? '-') + '). Kept in Pre-Medical (S). Check whether her late admission was allowed on a subsidized seat, or her quota.'
          : o.agg === null ? paid + ' but she has no matric marks on the portal, so she has no merit. Kept in Pre-Medical (S). Add her marks and check her quota.'
          : o.quota === OPEN ? paid + ' but her Aggregate ' + o.agg + ' is below the Open Quota subsidized merit (' + used.cut + '): she must be on another quota. Kept in Pre-Medical (S). Ask her and change the Quota.'
          : paid + ' but the ' + o.quota + ' subsidized seats are full (her Aggregate ' + o.agg + '): kept in Pre-Medical (S). Check her quota and seat.';
      } else if (k === 'PMS' && !o.emp && o.feeTotal > Number(cfg.subFee || 60000)) {
        o.flag = 'orange';
        o.why = 'On a subsidized seat (' + o.quota + (o.agg !== null ? ', Aggregate ' + o.agg : '') + ') but paid the self-finance fee (' + rs(o.feeTotal) + '). Check her quota, or refund / adjust the fee.';
      }
      if (k === 'PMM' && o.late && cfg.evening) k = 'PME';
      sheetOf.set(o, k);
    });
    S.filter(o => o.pk !== 'PM').forEach(o => sheetOf.set(o, o.pk));
    // 2. every sheet: rolls in merit order, sections in turn (A, B, C, A …), MeritNo and Age-wise per quota
    const out = {}, marks = {}, seats = [['Sheet', 'Quota', 'Students', 'Seats', 'Highest Aggregate', 'Lowest Aggregate (stopping merit)']];
    let sno = Number(cfg.snoStart) || 1;
    SHEETS.forEach(sh => {
      const L = S.filter(o => sheetOf.get(o) === sh.key);
      if (!L.length) return;
      if (L.length > sh.roll[1] - sh.roll[0] + 1) notes.push(['', '', sh.name, 'More students (' + L.length + ') than roll numbers ' + sh.roll[0] + '–' + sh.roll[1] + '. Change the range in the script.']);
      // MeritNo: per quota, by Aggregate, equal Aggregate = the same number (1, 2, 2, 3); Age-wise among equal Aggregates, older first
      const byQ = {}; L.forEach(o => { (byQ[o.quota] = byQ[o.quota] || []).push(o); });
      Object.keys(byQ).forEach(q => {
        const G = byQ[q].filter(o => o.agg !== null).slice().sort((a, b) => (b.agg - a.agg) || ((a.dob || 99999999) - (b.dob || 99999999))); let rank = 0, prev = null;   // MeritNo by Aggregate only
        G.forEach(o => { if (o.agg !== prev) { rank++; prev = o.agg; } o.merit = rank; });
        const tie = {}; G.forEach(o => { (tie[o.agg] = tie[o.agg] || []).push(o); });
        Object.values(tie).forEach(T => { if (T.length > 1) T.sort((a, b) => (a.dob || 99999999) - (b.dob || 99999999)).forEach((o, i) => { o.agewise = ordinal(i + 1); }); });
        const inPool = POOLS[q] && POOLS[q].programs.includes(sh.key === 'PMM' || sh.key === 'PME' ? 'PMS' : sh.key);
        const lim = sh.key === 'PMS' ? (q === OPEN ? cfg.openSub : q === UOP ? 'no limit' : inPool ? POOLS[q].seats + ' shared' : SUB_SEATS[q]) : (q === OPEN ? 'no limit' : q === UOP ? 'no limit' : inPool ? POOLS[q].seats + ' shared' : (OTHER_SEATS[sh.key] || {})[q]);
        if (typeof lim === 'number' && G.length > lim && sh.key !== 'PMS') notes.push(['', '', sh.name, q + ': ' + G.length + ' students for ' + lim + ' seat(s).']);
        seats.push([sh.name, q, byQ[q].length, lim == null ? '-' : lim, G.length ? G[0].agg : '', G.length ? G[G.length - 1].agg : '']);   // G is by Aggregate: first = highest
      });
      marks[sh.name] = [];
      L.forEach((o, i) => { if (o.flag) { marks[sh.name].push([i, o.flag === 'orange' ? 'F8CBAD' : o.flag === 'red' ? 'FF9999' : 'FFFF00']); notes.push([o.s['Student Name'], o.s['Father Name'], sh.name + ' · row ' + (i + 2) + ' · ' + o.quota, o.why]); } });
      out[sh.name] = L.map((o, i) => {
        const s = o.s, sec = sh.sections[i % sh.sections.length], roll = 'JCW-F' + cfg.year + '-' + (sh.roll[0] + i);
        let subs = []; for (let k = 1; k <= 7; k++) subs.push(sp(s['sub' + k + ' 1st year']).toUpperCase());
        if (!subs.some(Boolean)) subs = COMPULSORY.concat(sh.subjects);
        while (subs.length < 7) subs.push('');
        if (sh.key === 'FA' && subs.slice(4).every(x => !x)) notes.push([s['Student Name'], s['Father Name'], sh.name, 'No elective subjects on the portal: Sub5-Sub7 empty.']);
        const photo = sp(s['PhotoName']);
        return [sno++, roll, sp(s['Student Name']), sp(s['Father Name']), sh.program + ' - 1st Year - ' + sec[0], sh.program, '1st Year', sec[0], sec[1]]
          .concat(subs.slice(0, 7))
          .concat([sh.appeared, o.quota, sp(s['DOB']), '', o.obt ?? '', o.tot ?? '', o.merit ?? '', o.hq, o.agg ?? '', sec[2], photo, roll, sp(s['Batch']), cfg.session, 'Enrolled',
            sp(s['StudentContact']), sp(s['EmailAddress']), photo, sp(s['Board / University']), sp(s['Passing Year']), sp(s['Roll.No.']), o.agg ?? '',
            sp(s['Challan Details']), sp(s['Student Id']), o.agewise || '', sp(s['Fee Paid Date']), '', o.late ? 'Late admission (fee after ' + cfg.lastDate + ')' : '']);
      });
    });
    return { sheets: out, notes, seats, marks };   // marks: [row (0 = first student), colour] whose Quota cell is highlighted
  }
/*ENGINE-END*/

  /* ===================== PORTAL READING (as in JCW Portal Sync, read-only) ===================== */
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const clean = v => sp(String(v ?? '').replace(/[*:]/g, ''));
  const txt = el => el ? sp(el.textContent || '') : '';
  const val = el => el ? sp(el.value || '') : '';
  const abs = u => { try { return new URL(u, location.href).href; } catch (e) { return u || ''; } };
  const parseHTML = html => new DOMParser().parseFromString(html, 'text/html');
  const first = (o, keys) => { for (const k of keys) if (o[k] !== undefined && String(o[k]).trim() !== '') return sp(o[k]); return ''; };
  const idb = (mode, fn) => new Promise((res, rej) => {
    const q = indexedDB.open('JCW_NEW_LIST', 1);
    q.onupgradeneeded = e => e.target.result.createObjectStore('p', { keyPath: 'key' });
    q.onsuccess = () => { const t = q.result.transaction('p', mode).objectStore('p'), r = fn(t); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); };
    q.onerror = () => rej(q.error);
  });
  const loadSaved = () => idb('readonly', s => s.get(SAVE_KEY)).catch(() => null);
  const putSaved = o => idb('readwrite', s => s.put(o)).catch(() => null);
  const dropSaved = () => idb('readwrite', s => s.delete(SAVE_KEY)).catch(() => null);
  const expired = h => /\/account\/login/i.test(h) || /session\s*(expired|timeout)/i.test(h) || /<title[^>]*>\s*(login|sign\s*in)/i.test(h) || (/<html/i.test(h) && /<input[^>]+type=["']password["']/i.test(h));
  async function getText(url, tries = 3) {
    let err;
    for (let a = 1; a <= tries; a++) {
      try { const r = await fetch(url, { credentials: 'include', cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); const t = await r.text(); if (expired(t)) throw new Error('LOGIN'); return t; }
      catch (e) { err = e; if (e.message === 'LOGIN') break; await sleep(600 * a); }
    }
    throw err;
  }
  async function post(url, params, tries = 3) {
    let err;
    for (let a = 1; a <= tries; a++) {
      try {
        const r = await fetch(url, { method: 'POST', credentials: 'include', cache: 'no-store',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' }, body: new URLSearchParams(params) });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const t = await r.text(); if (expired(t)) throw new Error('LOGIN'); return t;
      } catch (e) { err = e; if (e.message === 'LOGIN') break; await sleep(1000 * a); }
    }
    throw err;
  }
  function studentTable() {
    const d = document.querySelector('#tblDataStudents'); if (d) return d;
    let best = null, sc = -1;
    document.querySelectorAll('table').forEach(t => { const x = sp(t.textContent); let s = 0; if (/enrollment/i.test(x)) s += 3; if (/batch/i.test(x)) s += 2; if (/session/i.test(x)) s += 2; if (s > sc) { sc = s; best = t; } });
    return best;
  }
  const headersOf = t => { const r = t.querySelector('thead tr') || t.querySelector('tr'); return r ? [...r.children].map(c => clean(txt(c))) : []; };
  function rowInfo(tr, headers) {
    const cells = [...tr.children], off = Math.max(0, cells.length - headers.length), o = {};
    headers.forEach((h, i) => { if (h) o[h] = txt(cells[i + off]); });
    const links = [...tr.querySelectorAll('a[href]')].map(a => ({ text: clean(txt(a)), href: a.getAttribute('href') || '' }))
      .filter(l => l.href && !/^javascript:|^#/i.test(l.href)).map(l => ({ text: l.text, href: abs(l.href) }));
    const idFrom = s => (s.match(/[?&]id=(\d+)/i) || s.match(/(?:Students|Edit|Details|NewStudent)[^0-9]*(\d+)/i) || [])[1] || '';
    let id = ''; for (const l of links) { id = idFrom(l.href); if (id) break; }
    if (!id) id = idFrom(tr.outerHTML || '');
    const ck = Object.keys(o).find(h => /course|subject/i.test(h));
    return { id: sp(id), links, listCourses: ck ? o[ck] : '',
      row: { 'Student Id': sp(id), 'Enrollment#': first(o, ['Enrollment#', 'Enrollment No', 'EnrollmentNo', 'Enrollment']), 'Batch': first(o, ['Batch']), 'Session': first(o, ['Session']),
        'Student Name': first(o, ['Student Name', 'StudentName', 'Name']), 'Father Name': first(o, ['Father Name', 'FatherName']), 'Category': first(o, ['Category']),
        'Program': first(o, ['Program']), 'Class': first(o, ['Class']), 'Section': first(o, ['Section']), 'Status': first(o, ['Status', 'StudentStatus']) || 'Enrolled' } };
  }
  async function collectList() {
    const t = studentTable(); if (!t) throw new Error('Open the Students list page first (Student > Students).');
    const headers = headersOf(t), all = [], seen = new Set();
    for (let page = 1; page <= 100; page++) {
      say('Reading the list of enrolled students, page ' + page + ' … (' + all.length + ' so far)');
      const html = await post('/Student/GetStudents', { PageNumber: String(page), SearchName: '', SortOrder: '1', PageSize: String(LIST_PAGE_SIZE), SessionId: '0', ProgramId: '0',
        ClassId: '0', CategoryId: '--All--', Gender: 'all', InstituteId: INSTITUTE_ID, SortingBy: 'Enrollment', Status: 'Enrolled', BatchId: '0' });
      const doc = parseHTML('<table><tbody>' + html + '</tbody></table>');
      const trs = [...doc.querySelectorAll('tbody tr')].filter(tr => tr.children.length >= headers.length - 1);
      let added = 0;
      trs.forEach(tr => { const it = rowInfo(tr, headers), k = it.id || it.row['Enrollment#'] || it.row['Student Name']; if (!k || seen.has(k)) return; seen.add(k); all.push(it); added++; });
      const pages = parseInt(val(doc.querySelector('#txtTotalPages')), 10) || 0;
      if (!added || trs.length < LIST_PAGE_SIZE || (pages && page >= pages)) break;
    }
    return all;
  }
  function editFields(html) {
    const doc = parseHTML(html), out = {};
    doc.querySelectorAll('input, select, textarea').forEach(el => {
      const key = el.getAttribute('name') || el.getAttribute('id'); if (!key || /^__|RequestVerificationToken|password/i.test(key)) return;
      const tag = el.tagName.toLowerCase(), type = (el.getAttribute('type') || '').toLowerCase();
      if (['button', 'submit', 'file', 'image', 'reset'].includes(type)) return;
      let v = '';
      if (tag === 'select') { const s = el.selectedOptions && el.selectedOptions[0]; v = s ? txt(s) : val(el); if (/^[-* ]*select/i.test(v)) v = ''; }
      else if (type === 'radio') { if (!el.checked) return; v = val(el); }
      else if (type === 'checkbox') v = el.checked ? 'Yes' : 'No';
      else v = val(el);
      if (v !== '' && !(key in out)) out[key] = v;
    });
    out.__HQ = '';
    let hq = doc.querySelector('#cmbHafizQuran, select[name="HafizQuran"], select[name="Hafiz"], select[name="IsHafiz"]');
    if (!hq) { const lb = [...doc.querySelectorAll('label')].find(l => /hafiz|hifz/i.test(txt(l))); const row = lb && (lb.closest('.form-group') || lb.parentElement); hq = row ? row.querySelector('select, input[type=checkbox]') : null; }
    if (hq) {
      let v = '';
      if (hq.tagName.toLowerCase() === 'select') { const o = hq.querySelector('option[selected]'); v = o ? (o.getAttribute('value') || txt(o)) : ''; }
      else v = hq.hasAttribute('checked') ? 'Yes' : 'No';
      out.__HQ = /^(yes|true|1|y)$/i.test(sp(v)) ? 'Yes' : /^(no|false|0|n)$/i.test(sp(v)) ? 'No' : '';
    }
    return out;
  }
  const dmy = raw => { const s = sp(raw), m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/); return m && Number(m[1]) >= 1000 ? `${m[3]}/${m[2]}/${m[1]}` : s; };
  const photo = p => { let v = sp(p); if (!v) return ''; if (/^https?:\/\//i.test(v)) return v; v = v.replace(/^\/+/, '').replace(/^images\/StudentPhoto\//i, '').replace(/^StudentPhoto\//i, ''); return PHOTO_BASE_URL + v; };
  const programId = h => (String(h || '').match(/function\s+GetPrograms\s*\([\s\S]*?var\s+selectedId\s*=\s*'(\d+)'/) || [])[1] || '';
  function controlValue(el) {
    if (!el) return '';
    if (el.tagName.toLowerCase() === 'select') { const s = el.selectedOptions && el.selectedOptions[0]; if (!s) return ''; const v = sp(s.value), t = sp(s.textContent); return (v === '' || v === '0' || /^[-* ]*(select|choose)/i.test(t)) ? '' : t; }
    return /input|textarea/i.test(el.tagName) ? val(el) : txt(el);
  }
  const QUAL = [['Board / University', '.board-class', /board|universit/i], ['Passing Year', '.passing-year-class', /passing|year/i], ['Roll.No.', '.roll-no-class', /roll/i],
    ['Obtain Marks/CGPA', '.obt-marks-class', /obtain|obt/i], ['Total Marks/CGPA', '.total-marks-class', /total/i], ['Division', '.division-class', /division/i], ['%age Marks', '.percentage-marks-class', /%|percent|age\s*marks/i]];
  function qualification(html) {
    const doc = parseHTML(html), t = doc.querySelector('#tblStuQualification') || doc.querySelector('table'); if (!t) return {};
    const hr = t.querySelector('thead tr'), ht = hr ? [...hr.children].map(th => clean(txt(th))) : [], hi = {};
    QUAL.forEach(([n, , re]) => { const i = ht.findIndex((h, k) => re.test(h) && !Object.values(hi).includes(k)); if (i >= 0) hi[n] = i; });
    let trs = [...t.querySelectorAll('tbody tr')]; if (!trs.length) trs = [...t.querySelectorAll('tr')].slice(hr ? 1 : 0);
    for (const tr of trs) {
      const rec = {};
      QUAL.forEach(([n, cls]) => { const el = tr.querySelector(cls); let v = ''; if (el) v = controlValue(el); else if (hi[n] !== undefined && tr.children[hi[n]]) { const c = tr.children[hi[n]], ctl = c.querySelector('select, input, textarea'); v = ctl ? controlValue(ctl) : clean(txt(c)); } rec[n] = sp(v); });
      if (Object.values(rec).some(Boolean)) return rec;
    }
    return {};
  }
  function challans(text) {
    text = String(text || '').trim(); challans.paidOn = ''; if (!text) return '';
    let recs = [];
    if (/^\s*[\[{]/.test(text)) { try { const j = JSON.parse(text); recs = Array.isArray(j) ? j : (j.data || j.rows || j.result || []); } catch (e) {} }
    if (!recs.length) {
      const H = ['SNo', 'Challan', 'Programe', 'Amount', 'Created Date', 'Due Date', 'Status', 'Paid Date', 'Remarks', 'Print'];
      parseHTML('<table><tbody>' + text + '</tbody></table>').querySelectorAll('tr').forEach(tr => {
        const v = [...tr.children].map(c => clean(txt(c))); if (v.length <= 1 || !v.some(Boolean)) return;
        const off = v.length - H.length; if (off < 0 || off > 3) return; const o = {}; H.forEach((h, i) => { o[h] = v[i + off] || ''; }); recs.push(o);
      });
    }
    let paidOn = '', paidKey = '';
    const out = recs.map(r => { const ks = Object.keys(r), ak = ks.find(k => /amount|fee|total/i.test(k)), amt = numOf(ak ? r[ak] : '') || 0; if (!amt) return '';
      const sk = ks.find(k => /status/i.test(k)), st = sk ? String(r[sk] || '').trim() : '', paid = /^p(aid)?/i.test(st) || /1/.test(st) || /^true$/i.test(st);
      const dk = ks.find(k => /paid\s*_?date|paiddate|paid_on|paidon/i.test(k)), d = dk ? clean(String(r[dk] || '')) : '';
      if (paid && amt > 3000 && d) { const m = d.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/) || d.match(/(\d{4})-(\d\d)-(\d\d)/);
        const key = m ? (m[3].length === 4 ? m[3] + m[2].padStart(2, '0') + m[1].padStart(2, '0') : m[1] + m[2] + m[3]) : d;
        const show = m ? (m[3].length === 4 ? m[1].padStart(2, '0') + '/' + m[2].padStart(2, '0') + '/' + m[3] : m[3] + '/' + m[2] + '/' + m[1]) : d;
        if (!paidKey || key < paidKey) { paidKey = key; paidOn = show; } }
      return (paid ? 'P' : 'U') + '-' + amt.toFixed(2); }).filter(Boolean).join(', ');
    challans.paidOn = paidOn;
    return out;
  }
  function courses(html) {
    const doc = parseHTML(html), t = doc.querySelector('table.tblcurrentcourses') || doc.querySelector('table'), out = {}; if (!t) return out;
    let ti = 2; const hr = t.querySelector('thead tr'); if (hr) { const i = [...hr.children].findIndex(th => /course\s*title|subject/i.test(txt(th))); if (i >= 0) ti = i; }
    const yr = []; let lab = '';
    t.querySelectorAll('tr').forEach(tr => { const c = [...tr.children]; if (!c.length) return;
      if (c.length < 4 && /(1st|2nd|first|second)\s*year/i.test(txt(tr))) { lab = /2nd|second/i.test(txt(tr)) ? '2nd' : '1st'; return; }
      if (c.length >= 4 && /^\d+$/.test(clean(txt(c[0])))) { const s = clean(txt(c[ti])), rt = txt(tr); const y = /(^|[-\s])II\s*-/.test(rt) ? '2nd' : (lab || '1st'); if (s && y === '1st') yr.push(s.toUpperCase()); } });
    for (let i = 0; i < 7; i++) out['sub' + (i + 1) + ' 1st year'] = yr[i] || '';
    return out;
  }
  function listCourses(text) {
    const yr = [];
    String(text || '').split(/(?:^|\s)\d+\)\s*/).map(x => x.trim()).filter(Boolean).forEach(c => {
      c = c.replace(/\s*\(CH:[^)]*\).*$/i, '').trim(); const m = c.match(/(?:^|[-\s])(II|I)\s*-\s*(.+)$/); if (m && m[1] === 'I') yr.push(sp(m[2]).toUpperCase()); });
    return yr;
  }
  async function details(it) {
    const row = Object.assign({}, it.row);
    const ed = it.links.find(l => /^edit$/i.test(l.text)) || it.links.find(l => /(edit|newstudent)/i.test(l.href) && /student/i.test(l.href)) || it.links.find(l => /edit/i.test(l.href));
    let eh = '';
    if (ed) {
      try { eh = await getText(ed.href); const f = editFields(eh);
        row['DOB'] = dmy(first(f, ['DOB', 'Dob', 'DateOfBirth', 'txtDOB'])); row['StudentContact'] = first(f, ['StudentContact', 'studentContact', 'Contact', 'Phone', 'Mobile', 'txtStudentContact']);
        row['EmailAddress'] = first(f, ['EmailAddress', 'emailAddress', 'Email', 'txtEmailAddress']); row['PhotoName'] = photo(first(f, ['PhotoName', 'photoName', 'Photo', 'photo']));
        if (!row['Category']) row['Category'] = first(f, ['CategoryId', 'categoryId', 'Category']); row['HQ'] = f.__HQ || '';
      } catch (e) { if (e.message === 'LOGIN') throw e; }
    }
    if (it.id) {
      try { Object.assign(row, qualification(await post('/Student/StudentQualificationPartail', { Id: it.id, ProgramId: programId(eh) || '0' }))); } catch (e) { if (e.message === 'LOGIN') throw e; }
      try { row['Challan Details'] = challans(await post('/Student/GetStudentFeeChallans', { PageNumber: '1', SearchName: '', SortOrder: '1', PageSize: '500', StudentId: it.id })); row['Fee Paid Date'] = challans.paidOn || ''; } catch (e) { if (e.message === 'LOGIN') throw e; }
    }
    const cu = it.links.find(l => /^courses$/i.test(l.text)) || it.links.find(l => /courses/i.test(l.text)) || it.links.find(l => /courses/i.test(l.href));
    if (cu) { try { Object.assign(row, courses(await getText(cu.href))); } catch (e) { if (e.message === 'LOGIN') throw e; } }
    let have = false; for (let i = 1; i <= 7; i++) if (row['sub' + i + ' 1st year']) have = true;
    if (!have) { const lc = listCourses(it.listCourses); for (let i = 0; i < 7; i++) row['sub' + (i + 1) + ' 1st year'] = lc[i] || ''; }
    return row;
  }

  /* ===================== PANEL ===================== */
  const box = document.createElement('div');
  box.id = 'jcwNew';
  box.innerHTML = `<style>
    #jcwNew{position:fixed;left:16px;bottom:16px;z-index:99999;width:320px;background:#fff;color:#101828;border:1px solid #d0d5dd;border-radius:14px;box-shadow:0 12px 32px -12px rgba(16,24,40,.35);font:13.5px/1.4 system-ui,Segoe UI,Arial,sans-serif;padding:12px}
    #jcwNew b.t{display:block;font-size:15px;margin-bottom:6px;color:#6B3423}
    #jcwNew label{display:flex;justify-content:space-between;align-items:center;gap:8px;margin:4px 0;font-size:12.5px}
    #jcwNew input,#jcwNew select{width:130px;height:28px;border:1px solid #d0d5dd;border-radius:7px;padding:0 6px;font:inherit}
    #jcwNew input[type=checkbox]{width:auto;height:auto}
    #jcwNew button{width:100%;height:36px;margin-top:6px;border:0;border-radius:10px;font-weight:700;cursor:pointer;background:#f4ebe8;color:#6B3423}
    #jcwNew button.p{background:#6B3423;color:#fff}#jcwNew button:disabled{opacity:.5;cursor:default}
    #jcwNew .s{margin-top:8px;font-size:12.5px;color:#475467;white-space:pre-line;max-height:140px;overflow:auto}
    #jcwNew .bar{height:6px;background:#eef2f6;border-radius:6px;margin-top:6px;overflow:hidden}#jcwNew .bar i{display:block;height:100%;width:0;background:#6B3423}
    #jcwNew .x{position:absolute;right:8px;top:6px;border:0;background:none;width:auto;height:auto;margin:0;font-size:18px;color:#98a2b3}
    #jcwNew.min>*:not(b):not(.x){display:none}</style>
    <button class="x" id="jnMin" title="Hide">–</button><b class="t">JCW New Session List</b>
    <label>Session <input id="jnSes"></label>
    <label>Enroll# year (JCW-F<i>yy</i>-) <input id="jnYear"></label>
    <label>First S.No <input id="jnSno" type="number"></label>
    <label>Last date of admission <input id="jnLast" placeholder="dd/mm/yyyy (optional)"></label>
    <label>Pre-Medical (S) Open seats <input id="jnOpen" type="number"></label>
    <label>Pre-Medical subsidized fee (Rs) <input id="jnFee" type="number"></label>
    <label>Evening Pre-Medical this year <input id="jnEve" type="checkbox"></label>
    <label>Batch of the new 1st Year <select id="jnBatch"><option value="">(read the list first)</option></select></label>
    <button id="jnList">1. Read the list</button>
    <button class="p" id="jnGo" disabled>2. Read details &amp; make the Excel file</button>
    <button id="jnResume" style="display:none">Resume</button>
    <div class="bar"><i id="jnBar"></i></div><div class="s" id="jnMsg">Reads the portal only. Makes one Excel file with a sheet for each program in the Transform columns.</div>`;
  document.body.appendChild(box);
  const $ = id => box.querySelector('#' + id);
  const say = (m, pct) => { $('jnMsg').textContent = m; if (pct != null) $('jnBar').style.width = Math.max(0, Math.min(100, pct)) + '%'; };
  const cfg = Object.assign({}, DEFAULTS, GM_getValue('jcwNewCfg', {}));
  $('jnSes').value = cfg.session; $('jnYear').value = cfg.year; $('jnSno').value = cfg.snoStart; $('jnLast').value = cfg.lastDate; $('jnOpen').value = cfg.openSub; $('jnFee').value = cfg.subFee; $('jnEve').checked = !!cfg.evening;
  const readCfg = () => { const c = { session: sp($('jnSes').value), year: sp($('jnYear').value).replace(/\D/g, '').slice(-2), snoStart: Number($('jnSno').value) || 1, lastDate: sp($('jnLast').value),
    openSub: Number($('jnOpen').value) || 0, subFee: Number($('jnFee').value) || 60000, evening: $('jnEve').checked }; GM_setValue('jcwNewCfg', c); return c; };
  $('jnMin').onclick = () => box.classList.toggle('min');
  let LIST = null, busy = false;
  const lock = on => { busy = on; ['jnList', 'jnGo', 'jnResume'].forEach(i => { $(i).disabled = on || (i === 'jnGo' && !LIST); }); };
  loadSaved().then(s => { if (s && s.items && Object.keys(s.done || {}).length < s.items.length) { $('jnResume').style.display = ''; $('jnResume').textContent = 'Resume (' + Object.keys(s.done).length + ' of ' + s.items.length + ' done)'; } });

  $('jnList').onclick = async () => {
    if (busy) return; lock(true);
    try {
      const all = await collectList(), first = all.filter(it => /1st/i.test(it.row['Class']));
      const cnt = {}; first.forEach(it => { const b = it.row['Batch'] || '(no batch)'; cnt[b] = (cnt[b] || 0) + 1; });
      const B = Object.keys(cnt).sort((x, y) => cnt[y] - cnt[x]);   // the portal's Batch is often empty or old: "All 1st Year" is the default
      $('jnBatch').innerHTML = `<option value="*" selected>All 1st Year (${first.length})</option>` + B.map(b => `<option value="${b}">only batch ${b} (${cnt[b]})</option>`).join('');
      LIST = first; say(first.length + ' enrolled 1st Year students on the portal (all of them are chosen). Check the settings, then press 2.', 0);
    } catch (e) { say(e.message === 'LOGIN' ? 'The portal logged you out. Log in again and open Students.' : 'Stopped: ' + e.message); }
    lock(false);
  };
  async function run(S) {
    lock(true);
    try {
      const todo = S.items.filter(it => !S.done[it.id || it.row['Enrollment#'] || it.row['Student Name']]), total = S.items.length;
      let i = 0, n = total - todo.length, stop = null; const t0 = Date.now(), start = n;
      const worker = async () => {
        while (!stop) {
          const it = todo[i++]; if (!it) return;
          try { S.done[it.id || it.row['Enrollment#'] || it.row['Student Name']] = await details(it); }
          catch (e) { if (e.message === 'LOGIN') { stop = 'The portal logged you out. Log in again, open Students and press "Resume".'; return; } }
          n++;
          if (n % 10 === 0) { await putSaved(S); const left = (Date.now() - t0) / Math.max(1, n - start) * (total - n); say('Details: ' + n + ' of ' + total + ' · about ' + Math.ceil(left / 60000) + ' min left', n / total * 95); }
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      await putSaved(S);
      if (stop) throw new Error(stop);
      const res = build(S.items.map(it => S.done[it.id || it.row['Enrollment#'] || it.row['Student Name']] || it.row), S.cfg);
      const wb = XLSX.utils.book_new(), counts = [];
      Object.keys(res.sheets).forEach(name => {
        const ws = XLSX.utils.aoa_to_sheet([TRANSFORM_HEAD].concat(res.sheets[name]));
        ws['!cols'] = TRANSFORM_HEAD.map((h, k) => ({ wch: [2, 3, 14, 26].includes(k) ? 24 : k === 4 ? 34 : 12 }));
        const qc = TRANSFORM_HEAD.indexOf('Quota');
        (res.marks[name] || []).forEach(([i, rgb]) => { const a = XLSX.utils.encode_cell({ r: i + 1, c: qc }); if (ws[a]) ws[a].s = { fill: { patternType: 'solid', fgColor: { rgb } }, font: { bold: true, color: { rgb: 'C00000' } } }; });
        XLSX.utils.book_append_sheet(wb, ws, name); counts.push(name + ' ' + res.sheets[name].length);
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(res.seats), 'Seats & merit');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Student Name', 'Father Name', 'Program / sheet', 'Check']].concat(res.notes)), 'Check these');
      XLSX.writeFile(wb, 'JCW 1st Year ' + S.cfg.session + ' (Transform).xlsx');
      await dropSaved(); $('jnResume').style.display = 'none';
      say('Done: ' + counts.join(' · ') + '.\n' + res.notes.length + ' point(s) to check on the sheet "Check these".\nPaste each sheet\'s rows (not the heading) under the last row of Transform-ALL-COLLEGE-STRENGTH.', 100);
    } catch (e) { say('Stopped: ' + e.message); $('jnResume').style.display = ''; }
    lock(false);
  }
  $('jnGo').onclick = async () => {
    if (busy || !LIST) return;
    const c = readCfg(), b = $('jnBatch').value, items = LIST.filter(it => b === '*' || (it.row['Batch'] || '(no batch)') === b);
    if (!items.length) { say('No students in that batch.'); return; }
    if (!/^\d{2}$/.test(c.year)) { say('Write the Enroll# year as two digits, e.g. 27.'); return; }
    if (!confirm('Read the details of ' + items.length + ' students (about ' + Math.ceil(items.length / 40) + ' minutes) and make the Excel file for session ' + c.session + ' (JCW-F' + c.year + '-…)?')) return;
    await run({ key: SAVE_KEY, cfg: c, items: items.map(it => ({ id: it.id, links: it.links, listCourses: it.listCourses, row: it.row })), done: {} });
  };
  $('jnResume').onclick = async () => { const S = await loadSaved(); if (!S) { $('jnResume').style.display = 'none'; return; } await run(S); };
})();
