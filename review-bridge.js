// litrpg-tracker fork — reader comments, out and back: a review copy of
// the book as Word (.docx, NEO's own export) or LibreOffice (.odt, built
// here), and the comments readers leave in either (or in a Google Docs
// download of either) brought back as placeholders with stickies at the
// words they were on. A summary comes first and nothing is placed until
// Place is clicked; the whole import is one undo step.
'use strict';

(() => {
  const $ = (s) => document.querySelector(s);
  // NEO's own t() is script-scope; without it, the key with its {vars} filled
  const t = typeof window.t === 'function' ? window.t : typeof globalThis.t === 'function' ? globalThis.t
    : (s, vars) => String(s).replace(/\{(\w+)\}/g, (m, k) => (vars && k in vars ? String(vars[k]) : m));
  const bookNow = () => (typeof book !== 'undefined' ? book : null);
  if (!$('#side-pane-toggle') || !window.ReviewCore) return;

  // the bottom-bar button and its little menu
  const button = document.createElement('button');
  button.id = 'review-toggle';
  button.title = t('A review copy for readers, and their comments back');
  button.innerHTML = '<span>✎ ' + t('Review') + '</span>';
  ($('#echo-toggle') || $('#tracker-rr-copy') || $('#side-pane-toggle')).after(button);
  const menu = document.createElement('ul');
  menu.id = 'review-menu';
  menu.className = 'review-pop';
  menu.hidden = true;
  const item = (label, run) => { const li = document.createElement('li'); const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.addEventListener('click', () => { menu.hidden = true; run(); }); li.appendChild(b); menu.appendChild(li); };
  item(t('Review copy for Word (.docx)…'), () => exportReview('docx'));
  item(t('Review copy for LibreOffice (.odt)…'), () => exportReview('odt'));
  item(t('Import reader comments…'), () => importComments());
  document.body.appendChild(menu);
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!menu.hidden) { menu.hidden = true; return; }
    const r = button.getBoundingClientRect();
    menu.style.left = r.left + 'px';
    menu.style.bottom = (window.innerHeight - r.top + 6) + 'px';
    menu.hidden = false;
  });
  document.addEventListener('mousedown', (e) => { if (!menu.contains(e.target) && e.target !== button) menu.hidden = true; }, true);
  const refs = $('#tracker-refs-toggle');
  if (refs) new MutationObserver(() => { button.hidden = refs.hidden; }).observe(refs, { attributes: true, attributeFilter: ['hidden'] });
  button.hidden = refs ? refs.hidden : false;

  // ------------------------------------------------------------ export

  async function exportReview(format) {
    const b = bookNow();
    if (!b) { toast(t('Open a book first')); return; }
    flushAllSaves();
    const defaultName = safeName(b.title) + '-review';
    try {
      const zipEntries = format === 'docx'
        ? buildDocxEntries()
        : ReviewCore.odtEntries({ title: b.title, author: b.author || '', sections: exportChapters().sections.filter((s) => s.kind === 'chapter' || s.paras.length) });
      const saved = await window.neo.exportSave({ format, defaultName, zipEntries });
      if (saved) toast(t('Review copy saved: {file}', { file: saved.split('/').pop() }));
    } catch (err) {
      window.neo.logError('review export ' + format + ': ' + (err && err.stack || err));
      toast(t('Couldn’t export: {error}', { error: (err && err.message) || String(err) }), 8000);
    }
  }

  // ------------------------------------------------------------ import

  // Where a comment's words are in the book: the chapter whose heading the
  // document gave, else every story chapter; the quote searched case
  // aside, repeats told apart by the words around them.
  function findSpot(c) {
    const b = bookNow();
    const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const chapters = (b.chapterOrder || []).filter((id) => document.querySelector(`.chapter[data-id="${id}"] .chapter-body`));
    const byHeading = chapters.filter((id) => c.heading && norm(chapterHeading(id)) === norm(c.heading));
    const candidates = byHeading.length ? byHeading : chapters;
    const needle = norm(c.quote || c.before.slice(-20));
    if (!needle) return null;
    let best = null;
    for (const chId of candidates) {
      const body = document.querySelector(`.chapter[data-id="${chId}"] .chapter-body`);
      const model = bodyTextModel(body);
      const hay = model.text.toLowerCase().replace(/\s+/g, ' ');
      for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + 1)) {
        const score = agreement(hay.slice(Math.max(0, at - 40), at), norm(c.before)) + agreement(hay.slice(at + needle.length, at + needle.length + 40), norm(c.after), true) + (byHeading.length ? 100 : 0);
        if (!best || score > best.score) best = { chId, start: at, end: at + needle.length, score, point: !c.quote };
      }
    }
    return best;
  }
  // how much of the context agrees, from the near end
  function agreement(have, want, fromStart = false) {
    if (!want) return 0;
    let n = 0;
    if (fromStart) while (n < have.length && n < want.length && have[n] === want[n]) n++;
    else while (n < have.length && n < want.length && have[have.length - 1 - n] === want[want.length - 1 - n]) n++;
    return n;
  }

  const stickyText = (c) => {
    const when = c.date ? ' ' + String(c.date).slice(0, 10) : '';
    const lines = [(c.quote ? '“' + c.quote + '” — ' : '') + (c.author || t('a reader')) + when + ': ' + c.text];
    for (const r of c.replies || []) lines.push('  ↳ ' + (r.author || '') + (r.date ? ' ' + String(r.date).slice(0, 10) : '') + ': ' + r.text);
    return lines.join('\n');
  };

  async function importComments() {
    const b = bookNow();
    if (!b) { toast(t('Open a book first')); return; }
    let got;
    try { got = await window.neo.reviewImport(); } catch (err) { toast((err && err.message) || String(err), 8000); return; }
    if (!got) return;
    let seen = [];
    try { seen = (await window.neo.readJSON(b.id, 'review-imports', [])) || []; } catch { seen = []; }
    const seenKeys = new Set(seen.map((s) => s.key));
    const rows = got.comments.map((c) => {
      const key = ReviewCore.commentKey(c);
      const spot = findSpot(c);
      return { c, key, spot, already: seenKeys.has(key) };
    });
    showSummary(got.file, rows, async (chosen, loose) => {
      await place(b, got.file, chosen, loose, seen);
    });
  }

  // The summary: what was found where, what wasn't, what was already in.
  function showSummary(file, rows, onPlace) {
    const bd = document.createElement('div');
    bd.className = 'modal-backdrop';
    const found = rows.filter((r) => r.spot && !r.already);
    const lost = rows.filter((r) => !r.spot && !r.already);
    const already = rows.filter((r) => r.already);
    const li = (r, note) => `<li><b>${escHtml(r.c.author || t('a reader'))}</b> ${r.c.quote ? '— “' + escHtml(r.c.quote.length > 60 ? r.c.quote.slice(0, 60) + '…' : r.c.quote) + '”' : ''}<br><span class="rv-text">${escHtml(r.c.text)}</span>${note ? '<br><span class="rv-note">' + note + '</span>' : ''}</li>`;
    bd.innerHTML = `<div class="modal review-summary" style="width:520px">
      <h2 style="font-size:16px">${t('Comments in {file}', { file: escHtml(file) })}</h2>
      <p class="rv-count">${t('{n} found in the text', { n: found.length })}${lost.length ? ' · ' + t('{n} not found', { n: lost.length }) : ''}${already.length ? ' · ' + t('{n} already in', { n: already.length }) : ''}</p>
      ${found.length ? '<h3>' + t('Will be placed') + '</h3><ul class="rv-list">' + found.map((r) => li(r, escHtml(chapterHeading(r.spot.chId)))).join('') + '</ul>' : ''}
      ${lost.length ? '<h3>' + t('Not found') + '</h3><ul class="rv-list">' + lost.map((r) => li(r, r.c.heading ? t('under “{h}”', { h: escHtml(r.c.heading) }) : '')).join('') + '</ul><label class="rv-loose"><input type="checkbox" class="rv-loose-box" checked> ' + t('File these as notes on their chapter, with no mark in the text') + '</label>' : ''}
      <div class="modal-actions"><button class="rv-cancel">${t('Cancel')}</button><button class="rv-place primary"${found.length || lost.length ? '' : ' disabled'}>${t('Place')}</button></div>
    </div>`;
    document.body.appendChild(bd);
    const close = () => bd.remove();
    bd.querySelector('.rv-cancel').addEventListener('click', close);
    bd.addEventListener('mousedown', (e) => { if (e.target === bd) close(); });
    bd.querySelector('.rv-place').addEventListener('click', async () => {
      const loose = bd.querySelector('.rv-loose-box') && bd.querySelector('.rv-loose-box').checked ? lost : [];
      close();
      await onPlace(found, loose);
    });
  }

  // The marks and stickies, as ⌘⇧X drops them — one structural undo step.
  async function place(b, file, found, loose, seen) {
    if (!found.length && !loose.length) return;
    snapshotStructure('import reader comments');
    const sel = window.getSelection();
    const touched = new Set();
    let placed = 0;
    for (const r of found) {
      const body = document.querySelector(`.chapter[data-id="${r.spot.chId}"] .chapter-body`);
      if (!body) continue;
      const model = bodyTextModel(body);
      const at = model.rangeAt(r.spot.end, 'end');
      if (!at) continue;
      const sid = 's-' + Date.now().toString(36) + placed.toString(36);
      const span = document.createElement('span');
      span.className = 'ph-mark';
      span.dataset.sid = sid;
      span.contentEditable = 'false';
      span.textContent = '⚑';
      const range = document.createRange();
      range.setStart(at.startContainer, at.startOffset);
      range.collapse(true);
      range.insertNode(span);
      stickies.push({ id: sid, chapterId: r.spot.chId, text: stickyText(r.c), resolved: false });
      touched.add(r.spot.chId);
      seen.push({ key: r.key, file, at: new Date().toISOString() });
      placed += 1;
    }
    for (const r of loose) {
      const chId = (b.chapterOrder || []).find((id) => r.c.heading && chapterHeading(id).toLowerCase() === r.c.heading.toLowerCase()) || currentChapterId || b.chapterOrder[0];
      if (!chId) continue;
      stickies.push({ id: 's-' + Date.now().toString(36) + 'l' + placed.toString(36), chapterId: chId, text: stickyText(r.c) + '\n' + t('(not found in the text)'), resolved: false });
      seen.push({ key: r.key, file, at: new Date().toISOString() });
      placed += 1;
    }
    sel.removeAllRanges();
    for (const chId of touched) {
      chapterHTML[chId] = captureBody(document.querySelector(`.chapter[data-id="${chId}"] .chapter-body`));
      scheduleChapterSave(chId);
    }
    writeSidecar(b.id, 'stickies', stickies);
    writeSidecar(b.id, 'review-imports', seen);
    renderStickies();
    scheduleNavRefresh();
    toast(t('{n} comments placed', { n: placed }));
  }

  window.reviewTools = { exportReview, importComments, findSpot };
})();
