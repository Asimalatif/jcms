// ==UserScript==
// @name         UOP Lookup Bridge (Admission Quota Manager)
// @namespace    jcw-admissions
// @version      2.1
// @description  Starts the read-only lookup bridge automatically in the window opened by "Connect portal".
// @match        https://portal.uop.edu.pk/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(async () => {
  'use strict';
  /* Only run in the window opened by the admission app (window.name is kept across page changes). */
  if (window.name !== 'uopLookupBridge' || !window.opener) return;
  const path = location.pathname.toLowerCase();
  if (/\/account\/login/.test(path)) return;               // wait for the person to log in; script runs again after redirect
  if (!/^\/student\/students\/?$/.test(path)) {            // not on the Students page: go there (max 3 tries)
    const n = Number(sessionStorage.getItem('uopBridgeRedirects') || 0);
    if (n >= 3) { window.opener.postMessage({ type: 'uopError', msg: 'Could not reach Student > Students. Open it by hand.' }, '*'); return; }
    sessionStorage.setItem('uopBridgeRedirects', String(n + 1));
    location.replace('/Student/Students');
    return;
  }
  sessionStorage.removeItem('uopBridgeRedirects');
  if (window.__uopBridgeOn) return;
  window.__uopBridgeOn = true;

  const tell = o => { try { window.opener.postMessage(o, '*'); } catch (e) {} };
  const PHOTO_BASE_URL = 'https://portal.uop.edu.pk/images/StudentPhoto/';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, timeout = 25000) => { const t = Date.now(); while (Date.now() - t < timeout) { try { if (fn()) return true; } catch (e) {} await sleep(150); } return false; };
  const sp = v => String(v ?? '').replace(/\s+/g, ' ').trim();
  const clean = v => sp(String(v ?? '').replace(/[*:]/g, ''));
  const txt = el => el ? sp(el.textContent || '') : '';
  const val = el => el ? sp(el.value || '') : '';
  const num = v => { const n = parseFloat(String(v ?? '').replace(/,/g, '').replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : 0; };
  const absoluteURL = u => { try { return new URL(u, location.href).href; } catch (e) { return u || ''; } };
  const parseHTML = h => new DOMParser().parseFromString(h, 'text/html');
  const normName = s => String(s || '').toLowerCase().replace(/[^a-z\u0600-\u06ff\s]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
  /* v2.1 moved inside: it uses sp() and val() of this script (outside, it stopped with "sp is not defined" and the quota stayed empty) */
  function quotaOf(doc) {
      const els = [...doc.querySelectorAll('select, input')].filter(e => /quota/i.test((e.name || '') + ' ' + (e.id || '')));
      for (const el of els) {
        if (el.tagName.toLowerCase() === 'select') {
          const o = el.selectedOptions && el.selectedOptions[0]; const t = o ? sp(o.textContent) : '';
          if (t && !/^[-* ]*(select|choose)/i.test(t)) return t;
        } else if (el.type !== 'checkbox' && el.type !== 'hidden') { const v = val(el); if (v) return v; }
      }
      return '';
    }

  async function fetchText(url, tries = 3) {
    let err;
    for (let a = 1; a <= tries; a++) {
      try { const r = await fetch(url, { credentials: 'include', cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.text(); }
      catch (e) { err = e; await sleep(500 * a); }
    }
    throw err;
  }
  async function postForm(url, params) {
    const r = await fetch(url, { method: 'POST', credentials: 'include', cache: 'no-store',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
      body: new URLSearchParams(params) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  }
  const expired = h => /\/account\/login/i.test(h) || /<input[^>]+type=["']password["']/i.test(h);

  /* ---------- student list ---------- */
  function findStudentTable() {
    let best = null, bs = -1;
    document.querySelectorAll('table').forEach(t => {
      const x = sp(t.textContent); let s = 0;
      if (/student/i.test(x)) s += 2; if (/enrollment/i.test(x)) s += 3; if (/batch/i.test(x)) s += 2; if (/session/i.test(x)) s += 2;
      if (s > bs) { bs = s; best = t; }
    });
    return bs >= 3 ? best : null;
  }
  const getHeaders = t => { const r = t.querySelector('thead tr') || t.querySelector('tr'); return r ? [...r.children].map(c => clean(txt(c))) : []; };
  const getTRs = t => { let r = [...t.querySelectorAll('tbody tr')]; if (!r.length) r = [...t.querySelectorAll('tr')].slice(1); return r.filter(x => sp(x.textContent).length); };
  function rowInfo(tr, headers) {
    const cells = [...tr.children], off = Math.max(0, cells.length - headers.length), o = {};
    headers.forEach((h, i) => { if (h) o[h] = txt(cells[i + off]); });
    const links = [...tr.querySelectorAll('a[href]')].map(a => ({ text: clean(txt(a)), href: a.getAttribute('href') || '' }))
      .filter(l => l.href && !/^javascript:|^#/i.test(l.href)).map(l => ({ text: l.text, href: absoluteURL(l.href) }));
    const idFrom = s => (s.match(/[?&]id=(\d+)/i) || s.match(/(?:Students|Edit|Details|NewStudent)[^0-9]*(\d+)/i) || [])[1] || '';
    let id = ''; for (const l of links) { id = idFrom(l.href); if (id) break; }
    if (!id) id = idFrom(tr.outerHTML || '');
    return { id: sp(id), links, name: sp(o['Student Name'] || o['StudentName'] || o['Name'] || ''), father: sp(o['Father Name'] || o['FatherName'] || ''),
      enrollment: sp(o['Enrollment#'] || o['Enrollment No'] || o['Enrollment'] || ''), reg: sp(o['Reg#'] || o['Registration No'] || ''),
      batch: sp(o['Batch'] || ''), program: sp(o['Program'] || ''), section: sp(o['Section'] || ''), status: sp(o['Status'] || '') };
  }
  const pageSig = () => { const t = findStudentTable(); if (!t) return ''; const r = getTRs(t); return r.length + '|' + sp((r[0] && r[0].textContent) || '').slice(0, 100); };
  async function settled() { await sleep(1000); let prev = pageSig(), st = 0; for (let i = 0; i < 40 && st < 2; i++) { await sleep(400); const c = pageSig(); if (c === prev) st++; else { st = 0; prev = c; } } }
  async function maxPageSize() {
    const sel = document.querySelector('#cmbPageSize, select[name*="PageSize" i]'); if (!sel) return;
    const o = [...sel.options].map(x => ({ v: x.value, n: parseInt(x.value, 10) || 0 })).sort((a, b) => b.n - a.n);
    if (!o.length || sel.value === o[0].v) return;
    sel.value = o[0].v; if (window.jQuery) window.jQuery(sel).trigger('change'); else sel.dispatchEvent(new Event('change', { bubbles: true }));
    await settled();
  }
  let LIST = [];
  async function loadList() {
    if (!(await waitFor(findStudentTable, 30000))) throw new Error('Student table not found on the Students page.');
    await maxPageSize();
    const all = [], seen = new Set();
    for (let page = 1; page <= 300; page++) {
      const t = findStudentTable(), h = getHeaders(t);
      getTRs(t).map(tr => rowInfo(tr, h)).forEach(it => { const k = it.id || it.enrollment || it.name; if (!k || seen.has(k)) return; seen.add(k); all.push(it); });
      tell({ type: 'uopProgress', count: all.length });
      const total = parseInt(val(document.querySelector('#txtTotalPages')), 10) || 1;
      const cur = parseInt(val(document.querySelector('#txtpageIndex, #txtPageIndex')), 10) || page;
      if (cur >= total || typeof window.Next !== 'function') break;
      const before = pageSig(); window.Next();
      if (!(await waitFor(() => pageSig() !== before, 20000))) break;
      await settled();
    }
    LIST = all; return LIST.length;
  }

  /* ---------- search ---------- */
  function search(query, father) {
    const q = normName(query), qd = sp(query).toLowerCase(), fn = normName(father);
    return LIST.map((s, i) => {
      let sc = 0; const n = normName(s.name);
      if (qd && (s.enrollment.toLowerCase() === qd || s.reg.toLowerCase() === qd)) sc = 100;
      else if (q && n === q) sc = 90;
      else if (q) { const qt = q.split(' '), nt = n.split(' '), hit = qt.filter(t => nt.includes(t)).length;
        if (hit === qt.length) sc = 70; else if (hit >= 2 && hit >= qt.length - 1) sc = 55; }
      if (sc && fn) { const f = normName(s.father); if (f === fn) sc += 20; else if (f && fn.split(' ').some(t => f.split(' ').includes(t))) sc += 5; }
      return { s, i, sc };
    }).filter(x => x.sc >= 55).sort((a, b) => b.sc - a.sc).slice(0, 10)
      .map(x => ({ key: x.i, id: x.s.id, name: x.s.name, father: x.s.father, enrollment: x.s.enrollment, reg: x.s.reg, batch: x.s.batch, program: x.s.program, section: x.s.section, score: x.sc }));
  }

  /* ---------- detail ---------- */
  const findLink = (links, label) => { const w = label.toLowerCase(); const h = links.find(l => l.text && l.text.toLowerCase() === w) || links.find(l => l.text && l.text.toLowerCase().includes(w)); return h ? h.href : ''; };
  const findEdit = links => (links.find(l => /^edit$/i.test(l.text)) || links.find(l => /(edit|newstudent)/i.test(l.href) && /student/i.test(l.href)) || links.find(l => /edit/i.test(l.href)) || {}).href || '';
  function field(doc, names) {
    for (const n of names) {
      let el = null; try { el = doc.querySelector('[name="' + n + '"],[id="' + n + '"]'); } catch (e) {}
      if (!el) continue;
      if (el.tagName.toLowerCase() === 'select') { const s = el.selectedOptions && el.selectedOptions[0]; const t = s ? sp(s.textContent) : ''; if (t && !/^[-* ]*(select|choose)/i.test(t)) return t; }
      else if (el.type === 'checkbox') return el.checked ? 'Yes' : 'No';
      else { const v = val(el) || txt(el); if (v) return v; }
    }
    return '';
  }
  const visibleDate = raw => { const s = sp(raw), m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/); if (!m || Number(m[1]) < 1000) return s; return m[3] + '/' + m[2] + '/' + m[1]; };
  const photoURL = p => { let v = sp(p); if (!v) return ''; if (/^https?:\/\//i.test(v)) return v; v = v.replace(/^\/+/, '').replace(/^images\/StudentPhoto\//i, '').replace(/^StudentPhoto\//i, ''); return PHOTO_BASE_URL + v; };
  function institution(doc) {
    for (const s of doc.querySelectorAll('select[name*="Institution" i], select[id*="Institution" i]')) {
      const o = s.selectedOptions && s.selectedOptions[0]; const t = o ? sp(o.textContent) : '';
      if (t && !/^[-* ]*(select|choose)/i.test(t)) return t;
    }
    return /jinnah\s+college\s+for\s+women/i.test(sp(doc.body && doc.body.textContent)) ? 'Jinnah College for Women' : '';
  }
  function parseQual(html) {
    const doc = parseHTML(html), t = doc.querySelector('#tblStuQualification') || doc.querySelector('table');
    if (!t) return {};
    const ctl = (tr, cls) => { const el = tr.querySelector(cls); if (!el) return ''; if (el.tagName.toLowerCase() === 'select') { const o = el.selectedOptions && el.selectedOptions[0]; return o ? sp(o.textContent) : ''; } return el.tagName.toLowerCase() === 'input' ? val(el) : txt(el); };
    for (const tr of t.querySelectorAll('tbody tr')) {
      const r = { board: ctl(tr, '.board-class'), year: ctl(tr, '.passing-year-class'), roll: ctl(tr, '.roll-no-class'), obt: ctl(tr, '.obt-marks-class'), total: ctl(tr, '.total-marks-class') };
      if (r.obt || r.total || r.board) return r;
    }
    return {};
  }
  function courses(html) {
    const doc = parseHTML(html), t = doc.querySelector('table.tblcurrentcourses'); if (!t) return [];
    let ti = 2; const hr = t.querySelector('thead tr'); if (hr) { const i = [...hr.children].findIndex(th => /course\s*title|subject/i.test(txt(th))); if (i >= 0) ti = i; }
    const out = []; let yr = '';
    t.querySelectorAll('tr').forEach(tr => {
      const c = [...tr.children]; if (!c.length) return;
      if (c.length < 4 && /(1st|2nd|first|second)\s*year/i.test(txt(tr))) { yr = clean(txt(tr)); return; }
      if (c.length >= 4 && /^\d+$/.test(clean(txt(c[0])))) { const title = clean(txt(c[ti])); if (title) out.push({ title, first: /1st|first/i.test(yr) }); }
    });
    const f = out.filter(x => x.first); return (f.length ? f : out).map(x => x.title.toUpperCase());
  }
  function challans(text) {
    const doc = parseHTML('<table><tbody>' + text + '</tbody></table>'), out = [];
    doc.querySelectorAll('tr').forEach(tr => {
      const v = [...tr.children].map(c => clean(txt(c))); if (v.length < 7) return;
      const off = v.length - 10; if (off < 0 || off > 3) return;
      const amount = num(v[off + 3]); if (!amount) return;
      out.push((/^p/i.test(v[off + 6]) ? 'P' : 'U') + '-' + amount.toFixed(2));
    });
    return out.join(', ');
  }
  async function detail(key) {
    const s = LIST[key]; if (!s) throw new Error('Student not in the loaded list. Reconnect the portal.');
    const info = { id: s.id, name: s.name, father: s.father, enrollment: s.enrollment, reg: s.reg, batch: s.batch, program: s.program, section: s.section, status: s.status,
      dob: '', email: '', contact: '', address: '', hafiz: '', photo: '', institution: '', metric: '', total: '', board: '',quota: '', subjects: [], challan: '', notes: [] };
    const editURL = findEdit(s.links); let editHTML = '';
    if (editURL) {
      try {
        editHTML = await fetchText(editURL); if (expired(editHTML)) throw new Error('Session expired. Log in again.');
        const doc = parseHTML(editHTML);
        info.dob = visibleDate(field(doc, ['DOB', 'Dob', 'DateOfBirth', 'txtDOB']));
        info.email = field(doc, ['EmailAddress', 'Email', 'txtEmailAddress']);
        info.contact = field(doc, ['StudentContact', 'Contact', 'Mobile', 'txtStudentContact']);
        info.address = field(doc, ['PermanentAddress', 'txtPermanentAddress']);
        info.hafiz = field(doc, ['HafizQuran', 'hafizQuran']);
        info.photo = photoURL(field(doc, ['PhotoName', 'Photo', 'photoName']));
        info.institution = institution(doc);
        info.quota = quotaOf(doc);
        if (!info.quota) info.notes.push('No quota field found on the portal edit page.');
      } catch (e) { info.notes.push('edit page: ' + e.message); }
    } else info.notes.push('no edit link');
    if (s.id) {
      try {
        const m = editHTML.match(/function\s+GetPrograms\s*\([\s\S]*?var\s+selectedId\s*=\s*'(\d+)'/);
        const q = parseQual(await postForm('/Student/StudentQualificationPartail', { Id: s.id, ProgramId: m ? m[1] : '0' }));
        info.metric = q.obt || ''; info.total = q.total || ''; info.board = q.board || '';
      } catch (e) { info.notes.push('qualification: ' + e.message); }
      try { info.challan = challans(await postForm('/Student/GetStudentFeeChallans', { PageNumber: '1', SearchName: '', SortOrder: '1', PageSize: '500', StudentId: s.id })); }
      catch (e) { info.notes.push('challan: ' + e.message); }
    }
    const cu = findLink(s.links, 'Courses');
    if (cu) { try { info.subjects = courses(await fetchText(cu)); } catch (e) { info.notes.push('courses: ' + e.message); } }
    return info;
  }

  /* ---------- messages from the admission app ---------- */
  let ready = loadList().then(n => { tell({ type: 'uopReady', count: n }); return n; });
  ready.catch(e => { console.error(e); tell({ type: 'uopError', msg: e.message }); });
  window.addEventListener('message', async ev => {
    if (ev.source !== window.opener) return;
    const m = ev.data || {}; if (!m.id) return;
    const reply = o => ev.source.postMessage(Object.assign({ id: m.id }, o), ev.origin);
    try {
      await ready;
      if (m.type === 'ping') reply({ ok: true, count: LIST.length });
      else if (m.type === 'search') reply({ ok: true, total: LIST.length, items: search(m.query, m.father) });
      else if (m.type === 'detail') reply({ ok: true, info: await detail(Number(m.key)) });
      else if (m.type === 'reload') { ready = loadList(); reply({ ok: true, count: await ready }); }
    } catch (e) { reply({ ok: false, msg: e.message }); }
  });
})();