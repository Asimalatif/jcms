// ==UserScript==
// @name         UOP Status Check (Admission Quota Manager)
// @namespace    jcw-admissions
// @version      1.0
// @description  Answers the "Check portal status" button of the Admission Quota Manager: reads the Cancelled, Migrated, Disenrolled and Enrolled lists for Jinnah College for Women. Read-only.
// @match        https://portal.uop.edu.pk/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

/*
 * Install once in Tampermonkey. After that it waits silently in every UOP portal tab and only
 * reads the lists when the Admission Quota Manager asks (Portal status tab > Check portal status).
 * READ-ONLY: nothing is saved or changed on the portal.
 */
(() => {
  'use strict';
  if (window.__uopStatusCheck) return;
  window.__uopStatusCheck = true;

  const STATUSES = ['Cancelled', 'Migrated', 'Disenrolled'];
  const INSTITUTE_ID = '1212';          // Jinnah College for Women
  const PAGE_SIZE = 500;
  const MAX_AGE_MS = 5 * 60 * 1000;     // re-read the portal if the lists are older than 5 minutes
  const APP_ORIGIN = /^https:\/\/([a-z0-9-]+\.)*(googleusercontent\.com|script\.google\.com)$/i;
  const DEFAULT_HEADERS = ['S.No', '', 'Enrollment#', 'Reg#', 'Batch', 'Session', 'Student Name', 'Father Name',
    'Category', 'Program', 'Class', 'Section', 'Status', 'Updated By', 'Updated Date', 'Action'];

  const sp = v => String(v ?? '').replace(/\s+/g, ' ').trim();
  const clean = v => sp(String(v ?? '').replace(/[*:]/g, ''));

  function headers() {
    const tr = document.querySelector('#tblDataStudents thead tr');
    const h = tr ? [...tr.children].map(c => clean(c.textContent)) : [];
    return h.includes('Student Name') ? h : DEFAULT_HEADERS;
  }

  function looksLoggedOut(text) {
    return /\/account\/login/i.test(text) || /<title[^>]*>\s*(login|sign\s*in)/i.test(text) ||
      (/<html/i.test(text) && /<input[^>]+type=["']password["']/i.test(text));
  }

  async function getPage(status, page) {
    const body = new URLSearchParams({
      PageNumber: String(page), SearchName: '', SortOrder: '1', PageSize: String(PAGE_SIZE),
      SessionId: '0', ProgramId: '0', ClassId: '0', CategoryId: '--All--', Gender: 'all',
      InstituteId: INSTITUTE_ID, SortingBy: 'Enrollment', Status: status, BatchId: '0'
    });
    let last;
    for (let a = 1; a <= 3; a++) {
      try {
        const r = await fetch('/Student/GetStudents', {
          method: 'POST', credentials: 'include', cache: 'no-store', body,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' }
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const text = await r.text();
        if (looksLoggedOut(text)) throw new Error('You are logged out of the portal. Log in again in the portal window, then click Check portal status again.');
        return text;
      } catch (e) {
        last = e;
        if (/logged out/.test(e.message)) throw e;
        await new Promise(r => setTimeout(r, 1000 * a));
      }
    }
    throw last;
  }

  function studentIdOf(tr, cells, offset) {
    const html = tr.outerHTML || '';
    const patterns = [
      /OpenChangePasswordModal\(\s*['"]?(\d+)/i,
      /\/Student\/(?:Edit|EditStudent|Details|NewStudent)[^0-9"'<>]*?(\d+)/i,
      /[?&](?:amp;)?id=(\d+)/i,
      /data-(?:id|student-?id)=["']?(\d+)/i,
      /id=["']row_(\d+)/i
    ];
    for (const re of patterns) { const m = html.match(re); if (m) return m[1]; }
    if (offset >= 1) { const v = sp(cells[0] && cells[0].textContent); if (/^\d+$/.test(v)) return v; }
    return '';
  }

  async function readStatus(status, hdrs, say) {
    const out = [], seen = new Set();
    for (let page = 1; page <= 100; page++) {
      const html = await getPage(status, page);
      const doc = new DOMParser().parseFromString('<table><tbody>' + html + '</tbody></table>', 'text/html');
      const trs = [...doc.querySelectorAll('tbody tr')].filter(tr => tr.children.length >= hdrs.length - 1);
      let added = 0;
      trs.forEach(tr => {
        const cells = [...tr.children];
        const offset = Math.max(0, cells.length - hdrs.length);
        const o = {};
        hdrs.forEach((h, i) => { if (h) o[h] = sp(cells[i + offset] && cells[i + offset].textContent); });
        const item = {
          id: studentIdOf(tr, cells, offset),
          enrollment: o['Enrollment#'] || '', reg: o['Reg#'] || '',
          name: o['Student Name'] || '', father: o['Father Name'] || '',
          program: o['Program'] || '', batch: o['Batch'] || '', session: o['Session'] || '',
          status: o['Status'] || status, updatedBy: o['Updated By'] || '', updatedDate: o['Updated Date'] || ''
        };
        const key = item.id || item.enrollment || (item.name + '|' + item.father);
        if (!item.name || seen.has(key)) return;
        seen.add(key); out.push(item); added++;
      });
      say(status + ': ' + out.length + ' students');
      if (!added || trs.length < PAGE_SIZE) break;
    }
    return out;
  }

  // ---------------- answer the Admission Quota Manager ----------------
  let data = null, readAt = 0, loading = null;
  const requesters = new Map();   // request id -> { src, origin }
  const answered = new Set();

  function tell(text) {
    console.log('[UOP status] ' + text);
    requesters.forEach((r, id) => { try { r.src.postMessage({ type: 'uopStatusProgress', id, text }, r.origin); } catch (e) {} });
  }

  function load() {
    if (loading) return loading;
    loading = (async () => {
      const hdrs = headers();
      const items = [], counts = {};
      for (const st of STATUSES) {
        const list = await readStatus(st, hdrs, tell);
        counts[st] = list.length;
        items.push(...list);
      }
      tell('Enrolled list (used to avoid wrong matches)...');
      const enrolled = (await readStatus('Enrolled', hdrs, tell))
        .map(x => ({ id: x.id, name: x.name, father: x.father, program: x.program }));
      data = { items, enrolled, counts, statuses: STATUSES, institution: 'Jinnah College for Women', at: new Date().toISOString() };
      readAt = Date.now();
      tell('Done. ' + STATUSES.map(s => counts[s] + ' ' + s).join(', ') + ', ' + enrolled.length + ' Enrolled.');
      return data;
    })().finally(() => { loading = null; });
    return loading;
  }

  window.addEventListener('message', async ev => {
    if (!APP_ORIGIN.test(ev.origin) || !ev.data || ev.data.type !== 'uopStatusReq') return;
    const id = String(ev.data.id || '');
    if (!id || answered.has(id) || requesters.has(id)) return;   // the app repeats its request until it hears back
    requesters.set(id, { src: ev.source, origin: ev.origin });
    try {
      tell('Starting...');
      if (!data || Date.now() - readAt > MAX_AGE_MS) await load();
      ev.source.postMessage({ type: 'uopStatusList', id, ok: true, payload: data }, ev.origin);
    } catch (e) {
      ev.source.postMessage({ type: 'uopStatusList', id, ok: false, msg: e.message }, ev.origin);
      console.error('[UOP status]', e);
    } finally {
      requesters.delete(id); answered.add(id);
    }
  });
})();