// End-to-end tests for the litrpg-tracker bridge (tracker-bridge.js), run
// in a real NEO window: the right-edge hover panel and its sharing with
// Stickies, Refs tinting and jumps, the New entry and Ctrl+D gestures,
// Escape, and what NEO posts to the tracker (chapter, selection, cursor,
// text, darlings) in what order. The tracker server is a stand-in per test
// (`withStub`: window.fetch answering by URL, restored after); `reset()`
// runs before every test, so none depends on the one before it. Run with
// `npm run test:tracker`.

'use strict';

const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

for (const name of fs.readdirSync(os.tmpdir())) {
  const pid = /^neo-tracker-test-(\d+)-/.exec(name);
  if (!pid || +pid[1] === process.pid) continue;
  try { process.kill(+pid[1], 0); continue; } catch (err) { if (err.code === 'EPERM') continue; }
  fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-tracker-test-${process.pid}-`));
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
const lib = path.join(tmp, 'NEO Library');
fs.mkdirSync(lib);
fs.writeFileSync(path.join(lib, 'library.json'), JSON.stringify({
  authorName: '', penNames: [], firstRunDone: true, pageTheme: 'night',
  shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: [] }]
}));
const loadFile = BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile = function (file, opts) {
  return loadFile.call(this, path.resolve(__dirname, '..', file), opts);
};
require('../main.js');

/* ================================================================== */
/*  harness                                                             */
/* ================================================================== */

let wc, win;
const js = (code) => wc.executeJavaScript(code, true);
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
/** Polls `expr` in the page until it's truthy. For "something happens";
 * a fixed `tick` stays only where the claim is that nothing does. */
const waitFor = async (expr, timeout = 3000) => {
  for (const end = Date.now() + timeout; Date.now() < end; await tick(25)) if (await js(expr)) return;
  throw new Error('timed out waiting for ' + expr);
};

/**
 * A stand-in tracker server for one test. `routes` is the source of an
 * object literal evaluated in the page: each key a URL substring, each
 * value a reply body or a function (url, init) => body | Promise<body>
 * (undefined is `{}`; every reply is ok). A function may read and change
 * `window.__stub.state` (seeded from `state`). Every call is recorded in
 * `window.__stub.calls` as {url, body}. `trackerReadyUrl` points at the
 * stub for the test's duration; fetch and the url are put back after,
 * whatever happened.
 */
const withStub = async (routes, fn, state = {}) => {
  await js(`(() => {
    if (window.__stub) throw new Error('a stub is already installed');
    const routes = ${routes};
    window.__stub = { routes, state: ${JSON.stringify(state)}, calls: [], prev: { fetch: window.fetch, url: trackerReadyUrl } };
    window.fetch = (u, init) => {
      const url = String(u);
      window.__stub.calls.push({ url, body: init && typeof init.body === 'string' ? init.body : null });
      const key = Object.keys(routes).find((k) => url.includes(k));
      const reply = key === undefined ? undefined : typeof routes[key] === 'function' ? routes[key](url, init) : routes[key];
      return Promise.resolve(reply).then((r) => ({ ok: true, json: async () => (r === undefined ? {} : r) }));
    };
    stopTrackerMailbox(); // a watcher on the real server (a hover started the tracker) would sit in its long-poll
    trackerReadyUrl = 'http://stub/';
    watchTrackerMailbox(); // as ensureTrackerPane would, with the real server
    return 0;
  })()`);
  try { return await fn(); } finally { await unstub(); }
};
const unstub = () => js(`(() => {
  const s = window.__stub; if (!s) return 0;
  stopTrackerMailbox(); window.fetch = s.prev.fetch; trackerReadyUrl = s.prev.url; delete window.__stub; return 0;
})()`);
/** The stub's calls whose url has `part`, as {url, body}. */
const calls = (part) => js(`window.__stub.calls.filter((c) => c.url.includes(${JSON.stringify(part)}))`);
const clearCalls = () => js(`window.__stub.calls = []; 0`);
/** The intents posted so far, as their query strings. */
const intents = async () => (await calls('__neo-intent')).map((c) => decodeURIComponent(c.url.split('?')[1]));
const setStub = (patch) => js(`Object.assign(window.__stub.state, ${JSON.stringify(patch)}); 0`);
/** Refs from the stub: one chapter's list, the mailbox with nothing new. */
const mailbox = (extra = '') => `'__neo-mailbox': () => ({ version: 1, writes: 1, goto: null, wantsManuscript: false, editing: false${extra} })`;
// the references carry the same write counter the mailbox reports, as the
// real server's do, so an unchanged counter never repaints
const refsStub = (refs) => `{
  '__references': () => ({ version: 1, byChapter: { 1: ${JSON.stringify(refs)} } }),
  ${mailbox()},
}`;

const paneState = () => js(`(() => {
  const p = document.getElementById('side-pane');
  return { open: p.classList.contains('open'), mode: p.dataset.mode, ariaLabel: p.getAttribute('aria-label') };
})()`);
const hover = (id, on) => js(`document.getElementById('${id}').dispatchEvent(new MouseEvent('${on ? 'mouseenter' : 'mouseleave'}', { bubbles: false }))`);
const openPane = async () => { await hover('side-hotzone', true); await waitFor(`document.getElementById('side-pane').classList.contains('open')`); await tick(250); }; // the 0.18s CSS transition, plus a little slack
const clickOutside = () => js(`document.getElementById('back-to-shelf').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
const toggleStickies = () => js(`document.getElementById('side-pane-toggle').click()`);
const chapterId = () => js(`document.querySelector('.chapter[data-id]').dataset.id`);
// The mouse at the pane's edge, inside or just outside — see the
// selection-release tests for why the two readings matter.
const moveTo = (where) => js(`(() => {
  const r = document.getElementById('side-pane').getBoundingClientRect();
  const x = ${where === 'inside' ? 'r.left + 5' : 'Math.max(5, r.left - 200)'}, y = r.top + r.height / 2;
  document.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }));
})()`);
/** A normal exit: inside, then outside a moment later. */
const exitPane = async () => { await moveTo('inside'); await tick(20); await moveTo('outside'); await tick(50); };
// "Hello", the test chapter's one word: selected, or its middle on screen.
const selectHello = () => js(`(() => {
  const body = document.querySelector('.chapter-body');
  const node = document.createTreeWalker(body, NodeFilter.SHOW_TEXT).nextNode();
  const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, 5);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range); return sel.toString();
})()`);
const helloPoint = () => js(`(() => {
  const body = document.querySelector('.chapter-body');
  body.scrollIntoView({ block: 'center' });
  const node = document.createTreeWalker(body, NodeFilter.SHOW_TEXT).nextNode();
  const r = document.createRange(); r.setStart(node, 1); r.setEnd(node, 3);
  const b = r.getBoundingClientRect();
  return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
})()`);
const ctrlClickHello = async () => {
  const p = await helloPoint();
  await tick(50);
  return js(`document.querySelector('.chapter-body').dispatchEvent(new MouseEvent('mousedown', { clientX: ${p.x}, clientY: ${p.y}, ctrlKey: true, button: 0, bubbles: true, cancelable: true })) ? 'not prevented' : 'prevented'`);
};
const highlights = (name = 'neo-tracker-refs') => js(`CSS.highlights.get(${JSON.stringify(name)})?.size ?? 0`);

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// The bridge's state as a fresh window has it, run before every test: a
// stub a test leaked is taken down, the palette and pane closed, Refs
// off, nothing selected, no pending debounces or sent-text memory.
const reset = () => js(`(() => {
  if (window.__stub) { stopTrackerMailbox(); window.fetch = window.__stub.prev.fetch; trackerReadyUrl = window.__stub.prev.url; delete window.__stub; }
  if (palette) closePalette(false);
  setTrackerRefs(false, false); localStorage.setItem('neo-tracker-refs-extra', '0');
  closeSidePane(); document.getElementById('side-pane').classList.remove('open');
  getSelection().removeAllRanges();
  trackerFlowActive = false; trackerEditing = false; trackerNotifiedSelection = null;
  trackerNotifiedChapter = null; trackerNotifiedWords = null; trackerRefsVersion = null; trackerRefsReply = null;
  trackerSentText.clear(); trackerSentDarlings = null; trackerSentOrder = null; trackerMeasured.clear();
  clearTimeout(trackerNotifySelectionTimer); clearTimeout(trackerSettleTimer); clearTimeout(trackerEditingLapse);
  clearTimeout(trackerNotifyTimer); clearTimeout(trackerNotifyWordsTimer); return 0;
})()`);

/* ================================================================== */
/*  the pane                                                            */
/* ================================================================== */

test('hovering the right edge opens the pane in tracker mode', async () => {
  await openPane();
  const state = await paneState();
  assert.equal(state.open, true);
  assert.equal(state.mode, 'tracker');
  assert.equal(state.ariaLabel, 'litrpg-tracker');
});

test('leaving the edge no longer closes tracker mode (a genuine fix: crossing onto the iframe fires a spurious mouseleave in Chromium, which used to close the pane before a click inside it could land)', async () => {
  await openPane();
  await hover('side-hotzone', false);
  await tick(250);
  const state = await paneState();
  assert.equal(state.open, true, 'tracker mode must stay open so clicks inside the iframe can land');
  assert.equal(state.mode, 'tracker');
});

test('clicking outside the open tracker pane still closes it', async () => {
  await openPane();
  await clickOutside();
  await waitFor(`!document.getElementById('side-pane').classList.contains('open')`);
});

test('the Stickies button switches an open tracker pane to stickies mode, rather than just closing it', async () => {
  await openPane();
  assert.equal((await paneState()).mode, 'tracker');
  await toggleStickies();
  await tick(100);
  const state = await paneState();
  assert.equal(state.open, true);
  assert.equal(state.mode, 'stickies');
  assert.equal(state.ariaLabel, 'Notes & Comments');
  assert.equal(await js(`getComputedStyle(document.getElementById('sticky-list')).display`), 'block');
  assert.equal(await js(`getComputedStyle(document.getElementById('tracker-pane-body')).display`), 'none');
});

test('clicking Stickies again, now that it is the open mode, closes it as a normal toggle', async () => {
  await openPane();
  await toggleStickies();
  await tick(100);
  assert.equal((await paneState()).mode, 'stickies');
  await toggleStickies();
  await tick(100);
  assert.equal((await paneState()).open, false);
});

test('hovering again after using Stickies correctly switches back to tracker mode', async () => {
  await openPane();
  await toggleStickies();
  await tick(100);
  await toggleStickies();
  await tick(100);
  await openPane();
  const state = await paneState();
  assert.equal(state.mode, 'tracker');
  assert.equal(await js(`getComputedStyle(document.getElementById('tracker-pane-body')).display`), 'block');
  assert.equal(await js(`getComputedStyle(document.getElementById('sticky-list')).display`), 'none');
});

// The rest covers what tracker-bridge.js builds itself (its markup and the
// observer that keeps the Stickies button honest), so an upstream merge
// that breaks the bridge's footing shows up here, not in use.
test('the Stickies button lights up only while the pane is open on Stickies', async () => {
  const lit = () => js(`document.getElementById('side-pane-toggle').classList.contains('active')`);
  await openPane();
  assert.equal(await lit(), false, 'tracker mode is open — the button stays unlit');
  await toggleStickies();
  await tick(100);
  assert.equal(await lit(), true);
  await toggleStickies();
  await tick(100);
  assert.equal(await lit(), false);
});

test('the full-screen button shows only in tracker mode, and toggles the pane wide', async () => {
  const wideDisplay = () => js(`getComputedStyle(document.getElementById('side-wide')).display`);
  const wide = () => js(`document.getElementById('side-pane').dataset.wide`);
  await openPane();
  assert.equal(await wideDisplay(), 'block');
  await js(`document.getElementById('side-wide').click()`);
  await tick(50);
  assert.equal(await wide(), '1');
  await js(`document.getElementById('side-wide').click()`);
  await tick(50);
  assert.equal(await wide(), '0');
  await toggleStickies(); // over to Stickies
  await tick(100);
  assert.equal(await wideDisplay(), 'none');
});

test('leaving the Manuscript tab hides the Stickies button and closes the unpinned pane', async () => {
  const hidden = () => js(`document.getElementById('side-pane-toggle').hidden`);
  await openPane();
  await toggleStickies();
  await tick(100);
  assert.equal((await paneState()).open, true, 'Stickies is open');
  await js(`sidePaneForTab('notes')`);
  await tick(100);
  assert.equal(await hidden(), true);
  assert.equal((await paneState()).open, false);
  await js(`sidePaneForTab('manuscript')`);
  await tick(100);
  assert.equal(await hidden(), false);
});

// A selection dragged out of a tracker field: the iframe holds the mouse,
// so this document's next reading after release is already outside, with
// its last inside one long gone. That mustn't close the pane; a normal
// exit (inside, then outside a moment later) still does.
test('a selection let go outside the pane leaves it open; a normal exit still closes it', async () => {
  await openPane();
  await moveTo('inside');
  await tick(450); // the iframe has the mouse; this document hears nothing
  await moveTo('outside');
  await tick(50);
  assert.equal((await paneState()).open, true, 'stays open after an unseen exit');
  await moveTo('outside');
  await tick(50);
  assert.equal((await paneState()).open, true, 'and keeps staying open until the cursor comes back');
  await exitPane();
  assert.equal((await paneState()).open, false, 'a normal exit closes it');
});

test('after an unseen exit, a click elsewhere still closes the pane', async () => {
  await openPane();
  await moveTo('inside');
  await tick(450);
  await moveTo('outside');
  await tick(50);
  assert.equal((await paneState()).open, true);
  await clickOutside();
  await waitFor(`!document.getElementById('side-pane').classList.contains('open')`);
});

test('while a tracker dialog is open, neither leaving the pane nor a click outside closes it', async () => {
  await withStub(`{ ${mailbox(', editing: window.__stub.state.editing')} }`, async () => {
    await openPane();
    await waitFor(`trackerEditing === true`); // the mailbox said so
    await exitPane();
    assert.equal((await paneState()).open, true, 'held through the cursor leaving');
    await clickOutside();
    await tick(50);
    assert.equal((await paneState()).open, true, 'held through a click outside');
    await setStub({ editing: false }); // the dialog closed
    await waitFor(`trackerEditing === false`);
    await exitPane();
    assert.equal((await paneState()).open, false, 'released once the dialog closed');
  }, { editing: true });
});

test('a click that closes the pane also releases the flow hold', async () => {
  await openPane();
  await js(`trackerFlowActive = true; 0`);
  await clickOutside();
  await waitFor(`!document.getElementById('side-pane').classList.contains('open')`);
  assert.equal(await js(`trackerFlowActive`), false, 'closing released the hold');
  await openPane();
  await exitPane();
  assert.equal((await paneState()).open, false, 'so the next open auto-closes on a normal exit again');
});

/* ================================================================== */
/*  Refs                                                                */
/* ================================================================== */

test('Refs tints referenced passages, names them on hover, and Alt+D turns it off', async () => {
  await withStub(refsStub([
    { kind: 'item', id: 'hello', name: 'Hello Sword', label: 'item', quote: 'Hello' },
    { kind: 'quest', id: 'gone', name: 'Gone Quest', label: 'quest', quote: 'not in this text' },
  ]), async () => {
    await js(`document.getElementById('tracker-refs-toggle').click()`);
    await waitFor(`(CSS.highlights.get('neo-tracker-refs')?.size ?? 0) === 1`);
    assert.equal(await highlights(), 1, 'the one quote that exists is tinted');
    assert.equal(await js(`document.getElementById('tracker-refs-toggle').classList.contains('active')`), true);
    // hover the middle of "Hello" (on screen: hit-testing only sees what's visible)
    const p = await helloPoint();
    await tick(100);
    await js(`document.querySelector('.chapter-body').dispatchEvent(new MouseEvent('mousemove', { clientX: ${p.x}, clientY: ${p.y}, bubbles: true }))`);
    await waitFor(`(() => { const t = document.getElementById('tracker-refs-tip'); return t && !t.hidden; })()`);
    assert.equal(await js(`document.getElementById('tracker-refs-tip').firstChild.textContent`), 'Hello Sword (item)');
    assert.equal(await js(`document.querySelector('#tracker-refs-tip .tr-hint')?.textContent`), 'Ctrl+click to open');
    // and somewhere that isn't referenced
    await js(`document.querySelector('.chapter-body').dispatchEvent(new MouseEvent('mousemove', { clientX: 2, clientY: 2, bubbles: true }))`);
    await waitFor(`(() => { const t = document.getElementById('tracker-refs-tip'); return !t || t.hidden; })()`);
    assert.equal(await js(`localStorage.getItem('neo-tracker-refs')`), '1', 'remembered for next launch');
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD', key: 'd', altKey: true, bubbles: true, cancelable: true }))`);
    await waitFor(`!CSS.highlights.has('neo-tracker-refs')`);
    assert.equal(await js(`localStorage.getItem('neo-tracker-refs')`), '0', 'Alt+D turned it off');
  });
});

test('Refs follow a tracker write on their own, and a typing pause re-reads nothing', async () => {
  await withStub(`{
    '__references': () => { window.__stub.state.refFetches += 1; return { version: window.__stub.state.version, byChapter: { 1: window.__stub.state.refs } }; },
    '__neo-mailbox': () => ({ version: window.__stub.state.version, writes: window.__stub.state.version, goto: null, wantsManuscript: false, editing: false }),
  }`, async () => {
    await js(`setTrackerRefs(true); 0`);
    await tick(300);
    assert.equal(await highlights(), 0, 'nothing referenced yet');
    // the tracker writes: its counter moves and the references change — no manuscript event
    await setStub({ version: 2, refs: [{ kind: 'item', id: 'hello', name: 'Hello Sword', label: 'item', quote: 'Hello' }] });
    await waitFor(`(CSS.highlights.get('neo-tracker-refs')?.size ?? 0) === 1`);
    const fetches = await js(`window.__stub.state.refFetches`);
    await js(`window.neoHooks.countersUpdated(); 0`);
    await tick(1200);
    assert.equal(await highlights(), 1, 'still tinted after a typing pause');
    assert.equal(await js(`window.__stub.state.refFetches`), fetches, 'a typing pause re-reads nothing');
  }, { version: 1, refs: [], refFetches: 0 });
});

test('Alt+Shift+D adds the event passages, in their own highlight', async () => {
  await withStub(refsStub([
    { kind: 'item', id: 'hello', name: 'Hello Sword', label: 'item', quote: 'Hello' },
    { kind: 'character', id: 'jake', name: 'Jake', label: 'HP −3', quote: 'llo', extra: true },
  ]), async () => {
    const key = (shiftKey) => js(`document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD', key: 'd', altKey: true, shiftKey: ${shiftKey}, bubbles: true, cancelable: true })); 0`);
    const sizes = async () => [await highlights(), await highlights('neo-tracker-refs-extra')];
    await key(false);
    await waitFor(`(CSS.highlights.get('neo-tracker-refs')?.size ?? 0) === 1`);
    assert.deepEqual(await sizes(), [1, 0], 'plain Refs leave the event passage out');
    await key(true);
    await waitFor(`(CSS.highlights.get('neo-tracker-refs-extra')?.size ?? 0) === 1`);
    assert.deepEqual(await sizes(), [1, 1], 'Refs+ tints it separately');
    assert.equal(await js(`document.querySelector('#tracker-refs-toggle span').textContent`), '◎ Refs+');
    assert.equal(await js(`localStorage.getItem('neo-tracker-refs-extra')`), '1');
    await key(true);
    await waitFor(`(CSS.highlights.get('neo-tracker-refs-extra')?.size ?? 0) === 0`);
    assert.deepEqual(await sizes(), [1, 0], 'and takes it away again, Refs staying on');
  });
});

test('a passage in a darling is tinted on the Darlings tab, from byDarling', async () => {
  await withStub(`{
    '__references': () => ({ version: 1, byChapter: {}, byDarling: { 'd-test': [{ passage: 'p-1-1', kind: 'item', id: 'hello', name: 'Hello Sword', label: 'item', quote: 'kept words' }] } }),
    ${mailbox()},
  }`, async () => {
    await js(`(() => {
      const list = document.getElementById('darlings-list');
      const el = document.createElement('div'); el.className = 'darling'; el.dataset.did = 'd-test';
      const content = document.createElement('div'); content.className = 'darling-text'; content.innerHTML = '<p>Some kept words here.</p>';
      el.appendChild(content); list.appendChild(el); return 0;
    })()`);
    try {
      await js(`setTrackerRefs(true); 0`);
      await waitFor(`(CSS.highlights.get('neo-tracker-refs')?.size ?? 0) === 1`);
      assert.equal(await highlights(), 1, 'the darling passage is tinted');
    } finally {
      await js(`document.querySelector('#darlings-list .darling[data-did="d-test"]').remove(); 0`);
    }
  });
});

// Ctrl+click a tinted passage: one entity opens straight away, several ask
// first. The intent post is recorded instead of made.
test('Ctrl+click a tinted passage opens its entity in the drawer', async () => {
  await withStub(refsStub([{ kind: 'item', id: 'hello', name: 'Hello Sword', label: 'item', quote: 'Hello' }]), async () => {
    await js(`setTrackerRefs(true); 0`);
    await waitFor(`(CSS.highlights.get('neo-tracker-refs')?.size ?? 0) === 1`);
    assert.equal(await ctrlClickHello(), 'prevented', 'the click was claimed, so the caret stays put');
    await waitFor(`window.__stub.calls.some((c) => c.url.includes('__neo-intent'))`);
    assert.deepEqual(await intents(), ['type=open&text=item:hello']);
    const state = await paneState();
    assert.equal(state.open, true);
    assert.equal(state.mode, 'tracker');
    // a plain click on the same passage is left alone
    const p = await helloPoint();
    assert.equal(await js(`document.querySelector('.chapter-body').dispatchEvent(new MouseEvent('mousedown', { clientX: ${p.x}, clientY: ${p.y}, button: 0, bubbles: true, cancelable: true })) ? 'not prevented' : 'prevented'`), 'not prevented');
  });
});

test('Ctrl+click a passage several entities reference asks which one', async () => {
  await withStub(refsStub([
    { kind: 'item', id: 'hello', name: 'Hello Sword', label: 'item', quote: 'Hello' },
    { kind: 'character', id: 'greeter', name: 'Greeter', label: 'character', quote: 'Hello' },
  ]), async () => {
    await js(`setTrackerRefs(true); 0`);
    await waitFor(`(CSS.highlights.get('neo-tracker-refs')?.size ?? 0) === 1`);
    await ctrlClickHello();
    await waitFor(`document.querySelectorAll('.pop-menu button').length === 2`);
    assert.deepEqual(await js(`[...document.querySelectorAll('.pop-menu button')].map((b) => b.textContent)`), ['Hello Sword (item)', 'Greeter (character)']);
    await js(`[...document.querySelectorAll('.pop-menu button')][1].click()`);
    await waitFor(`window.__stub.calls.some((c) => c.url.includes('__neo-intent'))`);
    assert.deepEqual(await intents(), ['type=open&text=character:greeter']);
  });
});

// Both the outside-click closer and the Ctrl+click opener are capture
// listeners on document, the closer registered first — so without the
// closer stepping aside, a Ctrl+click with the drawer open closed it and
// the opener reopened it a moment later.
test('Ctrl+click a tinted passage while the drawer is already open keeps it open, without a close-and-reopen', async () => {
  await withStub(refsStub([{ kind: 'item', id: 'hello', name: 'Hello Sword', label: 'item', quote: 'Hello' }]), async () => {
    await js(`setTrackerRefs(true); 0`);
    await waitFor(`(CSS.highlights.get('neo-tracker-refs')?.size ?? 0) === 1`);
    await openPane();
    // count closes at the source: closeSidePane is the one way the pane shuts
    await js(`window.__closes = 0; window.__realClose = closeSidePane; closeSidePane = () => { window.__closes++; window.__realClose(); }; 0`);
    try {
      await ctrlClickHello();
      await waitFor(`window.__stub.calls.some((c) => c.url.includes('__neo-intent'))`);
      assert.equal(await js(`window.__closes`), 0, 'the outside-click closer left the Ctrl+click alone');
      assert.equal((await paneState()).open, true);
      assert.deepEqual(await intents(), ['type=open&text=item:hello']);
    } finally {
      await js(`closeSidePane = window.__realClose; delete window.__realClose; 0`);
    }
  });
});

/* ================================================================== */
/*  what NEO posts                                                      */
/* ================================================================== */

test('a caret in the manuscript is posted with its chapter and offset, measured as chapterText is', async () => {
  await withStub(`{}`, async () => {
    const posts = async () => (await calls('__neo-selection')).map((c) => c.url.split('__neo-selection')[1] + ' ' + c.body);
    // the caret after "Hel", collapsed
    await js(`(() => {
      const body = document.querySelector('.chapter-body');
      const node = document.createTreeWalker(body, NodeFilter.SHOW_TEXT).nextNode();
      const range = document.createRange(); range.setStart(node, 3); range.collapse(true);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range); return 0;
    })()`);
    await waitFor(`window.__stub.calls.some((c) => c.url.includes('__neo-selection'))`);
    const chId = await chapterId();
    const expected = await js(`chapterText(${JSON.stringify(chId)}).indexOf('lo')`);
    const bookId = await js(`book.id`);
    assert.deepEqual(await posts(), ['?chapter=1&chapterId=' + encodeURIComponent(chId) + '&caret=' + expected + '&book=' + encodeURIComponent(bookId) + ' ']);
    // the same spot again isn't reposted; a selection from it carries the caret too
    await js(`trackerNotifiedSelection = null; 0`);
    await selectHello();
    await waitFor(`window.__stub.calls.filter((c) => c.url.includes('__neo-selection')).length === 2`);
    assert.equal((await posts()).at(-1), '?chapter=1&chapterId=' + encodeURIComponent(chId) + '&caret=0&end=5&book=' + encodeURIComponent(bookId) + ' Hello');
  });
});

test('pushes leave in order: the chapter text before the selection made in it', async () => {
  await withStub(`{
    '__neo-manuscript-text': () => new Promise((resolve) => setTimeout(() => { window.__stub.state.order.push('text'); resolve({}); }, 150)),
    '__neo-selection': () => { window.__stub.state.order.push('selection'); return {}; },
  }`, async () => {
    await selectHello();
    await waitFor(`window.__stub.state.order.length === 2`);
    assert.deepEqual(await js(`window.__stub.state.order`), ['text', 'selection']);
  }, { order: [] });
});

test('every push names the chapter by NEO\'s id and carries the book\'s chapter order', async () => {
  await withStub(`{}`, async () => {
    await selectHello();
    await waitFor(`window.__stub.calls.some((c) => c.url.includes('__neo-selection'))`);
    const chId = await chapterId();
    const body = JSON.parse((await calls('__neo-manuscript-text'))[0].body);
    assert.deepEqual(body.order, [{ id: chId, number: 1 }]);
    assert.equal(body.chapters[0].id, chId);
    assert.equal(body.chapters[0].number, 1);
    const sel = (await calls('__neo-selection'))[0].url;
    assert.ok(sel.includes('chapterId=' + encodeURIComponent(chId)), 'the selection names the chapter by id: ' + sel);
    assert.ok(sel.includes('chapter=1&'), 'and by number: ' + sel);
  });
});

test('a jump and a "send the manuscript" arrive through the mailbox; nothing polls on an interval', async () => {
  await withStub(`{
    '__neo-mailbox': () => {
      const mail = window.__stub.state.mail.shift() || { goto: null, wantsManuscript: false };
      return new Promise((resolve) => setTimeout(() => resolve({ version: ++window.__stub.state.n, writes: 1, editing: false, ...mail }), 20));
    },
  }`, async () => {
    const chId = await chapterId();
    await js(`window.__stub.state.mail.push({ goto: { chapter: 99, chapterId: ${JSON.stringify(chId)}, quote: 'Hello' } }, { wantsManuscript: true }); 0`);
    await waitFor(`CSS.highlights.has('neo-tracker-jump')`, 3000);
    await waitFor(`window.__stub.calls.some((c) => c.url.includes('__neo-manuscript-text'))`);
    assert.equal((await calls('__tracker-goto')).length, 0, 'no goto poll');
    assert.equal((await calls('__request-manuscript-text')).length, 0, 'no wants poll');
    assert.equal((await calls('__tracker-editing')).length, 0, 'no editing poll');
    assert.equal((await calls('__version')).length, 0, 'no version watch');
  }, { mail: [], n: 1 });
});

test('the book\'s order changing with no typing is pushed on its own', async () => {
  await withStub(`{}`, async () => {
    await selectHello();
    await waitFor(`window.__stub.calls.some((c) => c.url.includes('__neo-manuscript-text'))`);
    await clearCalls();
    // nothing changed: a settle sends nothing
    await js(`sendCurrentChapterSoon(); 0`);
    await tick(500);
    assert.equal((await calls('__neo-manuscript-text')).length, 0, 'an unchanged order is not re-sent');
    // a second chapter joins the book (the order changes, no text typed)
    await js(`book.chapterOrder.push('ch-test-extra'); book.chapterKinds = book.chapterKinds || {}; 0`);
    try {
      await js(`sendCurrentChapterSoon(); 0`);
      await waitFor(`window.__stub.calls.some((c) => c.url.includes('__neo-manuscript-text'))`);
      const body = JSON.parse((await calls('__neo-manuscript-text'))[0].body);
      assert.equal(body.order.length, 2, 'the new order went');
      assert.deepEqual(body.chapters, [], 'with no text, since none changed');
    } finally {
      await js(`book.chapterOrder = book.chapterOrder.filter((id) => id !== 'ch-test-extra'); 0`);
    }
  });
});

test('a section that is not a story chapter never posts as one', async () => {
  await withStub(`{}`, async () => {
    await js(`(() => {
      const ch = document.querySelector('.chapter[data-id]');
      book.chapterKinds = book.chapterKinds || {};
      window.__kind = book.chapterKinds[ch.dataset.id];
      book.chapterKinds[ch.dataset.id] = 'epilogue'; return 0;
    })()`);
    try {
      await selectHello();
      await tick(400); // nothing should happen
      assert.deepEqual(await js(`window.__stub.calls.filter((c) => c.url.includes('__neo-manuscript-text') || c.url.includes('chapter=')).map((c) => c.url)`), []);
    } finally {
      await js(`(() => { const ch = document.querySelector('.chapter[data-id]'); if (window.__kind) book.chapterKinds[ch.dataset.id] = window.__kind; else delete book.chapterKinds[ch.dataset.id]; delete window.__kind; return 0; })()`);
    }
  });
});

/* ================================================================== */
/*  Escape, New entry, the palette                                      */
/* ================================================================== */

test('Escape with a tracker dialog up closes it and the drawer; the book stays open', async () => {
  await withStub(`{ ${mailbox(', editing: window.__stub.state.editing')} }`, async () => {
    await js(`const pane = document.getElementById('side-pane'); pane.dataset.mode = 'tracker'; pane.classList.add('open'); 0`);
    await waitFor(`trackerEditing === true`); // the mailbox said so
    const esc = () => js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))`);
    assert.equal(await esc(), false, 'claimed: app.js never saw it');
    await waitFor(`window.__stub.calls.some((c) => c.url.includes('__neo-intent'))`);
    assert.deepEqual(await intents(), ['type=close&text=']);
    assert.equal((await paneState()).open, false);
    assert.equal(await js(`document.getElementById('editor-view').hidden`), false, 'still in the book');
    // no dialog up: Escape is left to app.js
    await setStub({ editing: false });
    await js(`document.getElementById('side-pane').classList.add('open'); 0`);
    await waitFor(`trackerEditing === false`);
    // peeked at just after the bridge's own capture listener, then kept from app.js
    assert.equal(await js(`(() => {
      let claimed = null;
      const peek = (e) => { claimed = e.defaultPrevented; e.stopImmediatePropagation(); };
      window.addEventListener('keydown', peek, true);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
      window.removeEventListener('keydown', peek, true);
      return claimed;
    })()`), false, 'not claimed: app.js has it');
    assert.deepEqual(await intents(), ['type=close&text='], 'and nothing more sent');
  }, { editing: true });
});

// Right-click / Ctrl+Shift+A: a single "new" intent carrying the selection,
// no menus here — the tracker's own chooser asks for kind and owner — and
// the keyboard handed to the drawer so that chooser's number keys work.
test('right-clicking a selection opens the drawer and asks for a New entry — no menu', async () => {
  await withStub(`{}`, async () => {
    assert.equal(await selectHello(), 'Hello');
    const p = await helloPoint();
    const claimed = await js(`!document.querySelector('.chapter-body').dispatchEvent(new MouseEvent('contextmenu', { clientX: ${p.x}, clientY: ${p.y}, button: 2, bubbles: true, cancelable: true }))`);
    assert.equal(claimed, true, 'the bridge claimed the right-click');
    await waitFor(`window.__stub.calls.some((c) => c.url.includes('__neo-intent'))`);
    assert.equal(await js(`!!document.querySelector('.pop-menu')`), false, 'no kind or owner menu');
    assert.deepEqual(await intents(), ['type=new&text=Hello&chapter=1&chapterId=' + await chapterId()]);
    const state = await paneState();
    assert.equal(state.open, true);
    assert.equal(state.mode, 'tracker');
  });
});

test('Ctrl+Shift+A asks for a New entry from the keyboard: the selection as its name, or nothing', async () => {
  const ctrlShiftA = () => js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'A', code: 'KeyA', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }))`);
  await withStub(`{}`, async () => {
    // a stand-in drawer frame when the real one was never built (no tracker
    // server in this run), so the focus hand-off has something to land on
    await js(`window.__stubFrame = !trackerFrame; if (window.__stubFrame) { trackerFrame = document.createElement('iframe'); document.body.appendChild(trackerFrame); } 0`);
    try {
      assert.equal(await selectHello(), 'Hello');
      await ctrlShiftA();
      await waitFor(`window.__stub.calls.some((c) => c.url.includes('__neo-intent'))`);
      assert.deepEqual(await intents(), ['type=new&text=Hello&chapter=1&chapterId=' + await chapterId()]);
      assert.equal(await js(`document.activeElement === trackerFrame`), true, 'the keyboard is in the drawer');
    } finally {
      await js(`if (window.__stubFrame) { trackerFrame.remove(); trackerFrame = null; } delete window.__stubFrame; 0`);
    }
    await clearCalls();
    await js(`getSelection().removeAllRanges(); 0`);
    await ctrlShiftA();
    await waitFor(`window.__stub.calls.some((c) => c.url.includes('__neo-intent'))`);
    assert.deepEqual(await intents(), ['type=new&text='], 'an empty dialog with nothing selected');
    // the second "l" of "Hello": the tracker is told which one
    await clearCalls();
    await js(`(() => {
      const node = document.createTreeWalker(document.querySelector('.chapter-body'), NodeFilter.SHOW_TEXT).nextNode();
      const range = document.createRange(); range.setStart(node, 3); range.setEnd(node, 4);
      getSelection().removeAllRanges(); getSelection().addRange(range); return 0;
    })()`);
    await ctrlShiftA();
    await waitFor(`window.__stub.calls.some((c) => c.url.includes('__neo-intent'))`);
    assert.deepEqual(await intents(), ['type=new&text=l&chapter=1&chapterId=' + await chapterId() + '&occurrence=2']);
  });
});

// The Ctrl+D palette, against a stand-in tracker server: a canned search
// hit, and a recorded quick-reference post.
const ctrlD = () => js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, bubbles: true, cancelable: true }))`);
const paletteInput = () => js(`(() => { const i = document.querySelector('#tracker-palette input'); return i ? { value: i.value, focused: document.activeElement === i, selected: i.value.slice(i.selectionStart, i.selectionEnd) } : null; })()`);
const paletteStub = `{
  '__search': { hits: [{ kind: 'item', id: 'sword', name: 'Sword', label: 'item' }] },
  '__quick-reference': { ok: true, name: 'Sword', references: [], presentAdded: false },
}`;

test('Ctrl+D opens the palette prefilled with the selection; Enter files it and puts the selection back', async () => {
  await withStub(paletteStub, async () => {
    assert.equal(await selectHello(), 'Hello');
    await ctrlD();
    await waitFor(`document.querySelector('#tracker-palette li.active .tp-name')`);
    assert.deepEqual(await paletteInput(), { value: 'Hello', focused: true, selected: 'Hello' });
    assert.equal(await js(`document.querySelector('#tracker-palette li.active .tp-name')?.textContent`), 'Sword', 'the prefilled query already found a hit');
    await js(`const i = document.querySelector('#tracker-palette input'); i.value = 'sw'; i.dispatchEvent(new Event('input')); 0`);
    await tick(200);
    assert.equal(await js(`document.querySelectorAll('#tracker-palette li').length`), 1);
    await js(`document.querySelector('#tracker-palette input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))`);
    await waitFor(`!document.getElementById('tracker-palette')`);
    assert.deepEqual((await calls('__quick-reference')).map((c) => JSON.parse(c.body)), [{ target: 'item', id: 'sword', chapter: 1, chapterId: await chapterId(), quote: 'Hello' }]);
    assert.equal(await js(`getSelection().toString()`), 'Hello', 'the selection is back');
    assert.equal(await js(`document.activeElement === document.querySelector('.chapter-body')`), true, 'and so is focus');
  });
});

test('Escape closes the palette without posting, selection intact', async () => {
  await withStub(paletteStub, async () => {
    assert.equal(await selectHello(), 'Hello');
    await ctrlD();
    await waitFor(`document.querySelector('#tracker-palette input')`);
    assert.equal((await paletteInput())?.value, 'Hello');
    await js(`document.querySelector('#tracker-palette input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
    await waitFor(`!document.getElementById('tracker-palette')`);
    assert.equal((await calls('__quick-reference')).length, 0, 'nothing was posted');
    assert.equal(await js(`getSelection().toString()`), 'Hello');
  });
});

/* ================================================================== */
/*  paste                                                               */
/* ================================================================== */

// A stat block copied from the tracker (its HTML carries the
// data-luckmode-block mark) pastes as poetry paragraphs, one per line, with
// no dialogue-dash rewriting; an unmarked paste is NEO's own, as before.
const pasteAtEnd = (html, text) => js(`(() => {
  const body = document.querySelector('.chapter-body');
  const p = body.querySelector('p');
  const r = document.createRange(); r.selectNodeContents(p); r.collapse(false);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  const dt = new DataTransfer();
  dt.setData('text/html', ${JSON.stringify(html)});
  dt.setData('text/plain', ${JSON.stringify(text)});
  (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement)
    .dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  return [...body.querySelectorAll('p')].map((x) => [x.className, x.textContent, !!x.querySelector('i')]);
})()`);

test('a stat block copied from the tracker pastes as poetry lines; any other paste stays prose', async () => {
  const saved = await js(`document.querySelector('.chapter-body').innerHTML`);
  try {
    const marked = await pasteAtEnd(
      '<div data-luckmode-block="1"><p>LV 1</p><p>- LCK 99</p></div>', 'LV 1\n\n- LCK 99\n');
    assert.deepEqual(marked.slice(1), [['poetry', 'LV 1', true], ['poetry', '- LCK 99', true]],
      'one italic poetry paragraph per line, blank lines dropped, the hyphen left alone');
    assert.equal(marked[0][1], 'Hello.', 'the paragraph it was pasted after is untouched');
    await js(`(() => { const b = document.querySelector('.chapter-body'); b.innerHTML = ${JSON.stringify('<p>Hello.</p>')}; return 0; })()`);
    const plain = await pasteAtEnd('<p>plain words</p>', 'plain words');
    assert.equal(plain.some(([cls]) => cls.includes('poetry')), false, 'an unmarked paste is not poetry');
  } finally {
    await js(`(() => { const b = document.querySelector('.chapter-body'); b.innerHTML = ${JSON.stringify(saved)}; syncChapter(b, b.closest('.chapter').dataset.id); return 0; })()`);
  }
});

/* ================================================================== */
/*  runner                                                              */
/* ================================================================== */

async function main() {
  await app.whenReady();
  let failed = 0;
  try {
    while (!(win = BrowserWindow.getAllWindows()[0])) await tick(50);
    wc = win.webContents;
    while (!(await js(`typeof library !== 'undefined' && !!library`).catch(() => false))) await tick(50);
    await js(`(async () => {
      document.getElementById('firstrun').hidden = true;
      await addImportedBooks([{ name: 'Tracker Test Book', chapters: [{ title: 'One', paras: [{ text: 'Hello.' }] }] }], library.shelves[0]);
      const ids = library.shelves[0].bookIds;
      await openBook(ids[ids.length - 1]);
    })()`);
    await waitFor(`document.querySelector('.chapter[data-id] .chapter-body')`, 10000);
    win.focus();
    for (const t of tests) {
      try {
        win.focus(); // the window can lose OS focus mid-run, which would correctly auto-close an unpinned pane
        await reset();
        await t.fn();
        console.log('ok   ' + t.name);
      } catch (err) {
        failed++;
        console.log('FAIL ' + t.name + '\n     ' + String(err && err.message || err).replace(/\n/g, '\n     '));
      }
    }
    console.log(`\n${tests.length - failed} passed, ${failed} failed`);
  } catch (err) {
    failed++;
    console.log('FAIL setup\n     ' + String(err && err.stack || err).replace(/\n/g, '\n     '));
  } finally {
    app.quit();
  }
  process.exitCode = failed ? 1 : 0;
}

main();
