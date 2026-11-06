// litrpg-tracker fork — the Echoes panel: words repeated close together,
// phrases that come round, words a chapter leans on more than the book
// does. Counting only (echo-core.js), on this machine, and only when
// asked: it runs when the panel opens or Refresh is clicked, never while
// typing, and nothing is marked in the text until a row is clicked. The
// marks are CSS highlights, never saved in the chapter.
'use strict';

(() => {
  const $ = (s) => document.querySelector(s);
  const t = window.NeoI18n.t; // NEO's own translator (app.js destructures it at script scope)
  const pane = $('#side-pane');
  if (!pane || !window.EchoCore) return;
  // app.js's own state is script-scope, not window's
  const bookNow = () => (typeof book !== 'undefined' ? book : null);

  // the pane's third mode, beside Notes & Comments and the tracker
  const titleNotes = $('#side-head > .side-title-notes');
  const title = document.createElement('span');
  title.className = 'side-title-echoes';
  title.textContent = t('Echoes');
  if (titleNotes) titleNotes.after(title);
  const body = document.createElement('div');
  body.id = 'echo-pane-body';
  const trackerBody = $('#tracker-pane-body');
  (trackerBody || $('#sticky-list')).after(body);

  const button = document.createElement('button');
  button.id = 'echo-toggle';
  button.title = t('Words and phrases this chapter repeats ({key}) — counted when opened, never while typing', { key: (typeof IS_MAC !== 'undefined' && IS_MAC) ? '⌃⌥E' : 'Alt+E' });
  button.setAttribute('aria-pressed', 'false');
  button.innerHTML = '<span>≋ ' + t('Echoes') + '</span>';
  ($('#tracker-rr-copy') || $('#tracker-refs-toggle') || $('#side-pane-toggle')).after(button);

  const HIGHLIGHT = 'neo-echo';
  let windowWords = Number(localStorage.getItem('neo-echo-window')) || 100;
  let withBook = localStorage.getItem('neo-echo-book') !== '0';
  let ignoreOwn = [];   // the author's own ignore list, kept with the book
  let trackerNames = []; // the tracker's names and aliases, when it answers
  let namesFor = null;   // the tracker url the names were read from
  let current = null;    // { chId, report }
  let active = null;     // the group lit up, by key

  const isOpen = () => pane.classList.contains('open') && pane.dataset.mode === 'echoes';
  const syncButton = () => { const on = isOpen(); button.classList.toggle('active', on); button.setAttribute('aria-pressed', on ? 'true' : 'false'); };
  new MutationObserver(() => { syncButton(); if (!isOpen()) clearMarks(); }).observe(pane, { attributes: true, attributeFilter: ['class', 'data-mode'] });

  function clearMarks() {
    active = null;
    if (window.CSS && CSS.highlights) CSS.highlights.delete(HIGHLIGHT);
    body.querySelectorAll('.echo-row.on').forEach((r) => r.classList.remove('on'));
  }

  function open() {
    pane.dataset.mode = 'echoes';
    pane.setAttribute('aria-label', t('Echoes'));
    pane.classList.add('open');
    run();
  }
  const close = () => closeSidePane(); // app.js's own, via the bridge: its bookkeeping too
  button.addEventListener('click', () => (isOpen() ? close() : open()));
  // Alt+E — on a Mac Option+E is the acute accent's dead key, so Ctrl+Option+E there
  const mac = typeof IS_MAC !== 'undefined' && IS_MAC;
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyE' || !e.altKey || e.metaKey || e.shiftKey || (mac ? !e.ctrlKey : e.ctrlKey)) return;
    if (button.hidden) return;
    e.preventDefault();
    if (isOpen()) close(); else open();
  });

  // The chapter the caret is in, else the one NEO is on.
  function chapterId() {
    const sel = getSelection();
    const node = sel && sel.anchorNode;
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    const ch = el && el.closest && el.closest('.chapter[data-id]');
    return (ch && ch.dataset.id) || (typeof currentChapterId !== 'undefined' ? currentChapterId : null);
  }

  async function loadIgnore() {
    const b = bookNow();
    if (!b || !window.neo || !window.neo.readJSON) { ignoreOwn = []; return; }
    try { ignoreOwn = (await window.neo.readJSON(b.id, 'echo-ignore', [])) || []; } catch { ignoreOwn = []; }
  }
  function saveIgnore() {
    const b = bookNow();
    if (b && typeof writeSidecar === 'function') writeSidecar(b.id, 'echo-ignore', ignoreOwn);
  }
  // the tracker's names, so a character's name said twice is not an echo
  async function loadNames() {
    const url = typeof trackerReadyUrl !== 'undefined' ? trackerReadyUrl : null;
    if (!url) { trackerNames = []; namesFor = null; return; }
    if (namesFor === url) return;
    try {
      const reply = await (await fetch(url + '__names')).json();
      trackerNames = Array.isArray(reply.names) ? reply.names : [];
      namesFor = url;
    } catch { trackerNames = []; }
  }

  async function run() {
    const chId = chapterId();
    const b = bookNow();
    if (!chId || !b) { body.innerHTML = '<p class="echo-empty">' + t('Put the cursor in a chapter.') + '</p>'; return; }
    body.innerHTML = '<p class="echo-empty">' + t('Counting…') + '</p>';
    await Promise.all([loadIgnore(), loadNames()]);
    const text = chapterText(chId);
    // the whole book, for what this chapter leans on more than the rest
    const bookText = withBook ? (b.chapterOrder || []).map((id) => chapterText(id)) : null;
    const ignore = [...ignoreOwn, ...trackerNames.flatMap((n) => n.split(/\s+/))];
    const report = EchoCore.report(text, { window: windowWords, ignore, book: bookText ? EchoCore.countStems(bookText, ignore) : null });
    current = { chId, report, text };
    clearMarks();
    render();
  }

  function render() {
    if (!current) return;
    const { report } = current;
    body.innerHTML = '';
    const bar = document.createElement('div');
    bar.className = 'echo-bar';
    bar.innerHTML = '<button type="button" class="echo-refresh">↻ ' + t('Refresh') + '</button>'
      + '<label>' + t('within') + ' <select class="echo-window"><option value="50">50</option><option value="100">100</option><option value="200">200</option></select> ' + t('words') + '</label>'
      + '<label><input type="checkbox" class="echo-book"> ' + t('against the book') + '</label>'
      + '<span class="echo-count">' + report.words.toLocaleString() + ' ' + t('words') + '</span>';
    body.appendChild(bar);
    bar.querySelector('.echo-window').value = String(windowWords);
    bar.querySelector('.echo-book').checked = withBook;
    bar.querySelector('.echo-refresh').addEventListener('click', run);
    bar.querySelector('.echo-window').addEventListener('change', (e) => { windowWords = Number(e.target.value); localStorage.setItem('neo-echo-window', String(windowWords)); run(); });
    bar.querySelector('.echo-book').addEventListener('change', (e) => { withBook = e.target.checked; localStorage.setItem('neo-echo-book', withBook ? '1' : '0'); run(); });

    const section = (heading, rows, empty) => {
      const h = document.createElement('h3');
      h.textContent = heading + (rows.length ? ' · ' + rows.length : '');
      body.appendChild(h);
      if (!rows.length) { const p = document.createElement('p'); p.className = 'echo-empty'; p.textContent = empty; body.appendChild(p); return; }
      const ul = document.createElement('ul');
      ul.className = 'echo-list';
      for (const row of rows) ul.appendChild(row);
      body.appendChild(ul);
    };
    const rowOf = (key, label, detail, positions, ignoreWord) => {
      const li = document.createElement('li');
      li.className = 'echo-row';
      li.dataset.key = key;
      const main = document.createElement('button');
      main.type = 'button';
      main.className = 'echo-main';
      main.innerHTML = '<b></b> <span class="echo-detail"></span>';
      main.querySelector('b').textContent = label;
      main.querySelector('.echo-detail').textContent = detail;
      main.addEventListener('click', () => light(key, positions));
      li.appendChild(main);
      if (ignoreWord) {
        const ig = document.createElement('button');
        ig.type = 'button';
        ig.className = 'echo-ignore';
        ig.title = t('Leave this word out from now on, in this book');
        ig.textContent = '×';
        ig.addEventListener('click', (e) => { e.stopPropagation(); if (!ignoreOwn.includes(ignoreWord)) ignoreOwn.push(ignoreWord); saveIgnore(); run(); });
        li.appendChild(ig);
      }
      return li;
    };
    section(t('Close together'), report.echoes.map((g) => rowOf('e:' + g.stem + ':' + g.positions[0].start, g.word, t('×{n} within {w} words', { n: g.positions.length, w: g.span }), g.positions, g.stem)), t('No word repeats within ' + windowWords + ' words.'));
    section(t('Repeated phrases'), report.phrases.map((p) => rowOf('p:' + p.phrase, p.phrase, '×' + p.positions.length, p.positions, null)), t('No phrase comes round twice.'));
    section(t('Leaned on'), report.overused.map((o) => rowOf('o:' + o.stem, o.word, withBook ? t('×{n} here · {r}‰ vs {b}‰ in the book', { n: o.count, r: o.rate, b: o.bookRate }) : '×' + o.count, o.positions, o.stem)), withBook ? t('Nothing this chapter uses far more than the book does.') : t('Nothing used four times or more.'));
    if (ignoreOwn.length) {
      const p = document.createElement('p');
      p.className = 'echo-ignored';
      p.textContent = t('Left out: ') + ignoreOwn.join(', ') + ' ';
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'echo-ignore';
      reset.textContent = t('clear');
      reset.addEventListener('click', () => { ignoreOwn = []; saveIgnore(); run(); });
      p.appendChild(reset);
      body.appendChild(p);
    }
  }

  // A row clicked: every instance lit in the text, the first scrolled to.
  // The text may have moved since the count; a spot that no longer reads
  // its word is skipped.
  function light(key, positions) {
    if (!current) return;
    if (active === key) { clearMarks(); return; }
    clearMarks();
    active = key;
    body.querySelectorAll('.echo-row').forEach((r) => r.classList.toggle('on', r.dataset.key === key));
    const bodyEl = document.querySelector('.chapter[data-id="' + current.chId + '"] .chapter-body');
    if (!bodyEl || !(window.CSS && CSS.highlights && window.Highlight)) return;
    const model = bodyTextModel(bodyEl);
    const ranges = [];
    for (const p of positions) {
      if (model.text.slice(p.start, p.end).toLowerCase() !== current.text.slice(p.start, p.end).toLowerCase()) continue;
      const a = model.rangeAt(p.start, 'start'), b = model.rangeAt(p.end, 'end');
      if (!a || !b) continue;
      const r = document.createRange();
      r.setStart(a.startContainer, a.startOffset);
      r.setEnd(b.startContainer, b.startOffset);
      ranges.push(r);
    }
    if (!ranges.length) return;
    CSS.highlights.set(HIGHLIGHT, new Highlight(...ranges));
    const first = ranges[0].startContainer.parentElement;
    if (first && first.scrollIntoView) first.scrollIntoView({ behavior: typeof scrollBehavior === 'function' ? scrollBehavior() : 'smooth', block: 'center' });
  }

  // off the Manuscript tab the button goes with the others
  const refs = $('#tracker-refs-toggle');
  if (refs) new MutationObserver(() => { button.hidden = refs.hidden; }).observe(refs, { attributes: true, attributeFilter: ['hidden'] });
  button.hidden = refs ? refs.hidden : false;

  window.echoTools = { run, open, close, light, clearMarks };
})();
