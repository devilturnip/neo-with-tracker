// End-to-end tests for the litrpg-tracker hover panel: the right-edge hover
// gesture, the dual-mode #side-pane sharing with Stickies, and that neither
// entry point leaves the pane in the wrong mode. Deliberately doesn't depend
// on the litrpg-tracker repo actually being checked out (ensureTrackerPane()
// degrades to a "not available" message when it isn't, by design) — this
// suite only exercises the DOM/mode mechanics, which must hold either way.
// Run with `npm run test:tracker`.

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

let wc, win;
const js = (code) => wc.executeJavaScript(code, true);
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
const paneState = () => js(`(() => {
  const p = document.getElementById('side-pane');
  return { open: p.classList.contains('open'), mode: p.dataset.mode, ariaLabel: p.getAttribute('aria-label') };
})()`);
const hover = (id, on) => js(`document.getElementById('${id}').dispatchEvent(new MouseEvent('${on ? 'mouseenter' : 'mouseleave'}', { bubbles: false }))`);

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('hovering the right edge opens the pane in tracker mode', async () => {
  await hover('side-hotzone', true);
  await tick(250); // the 0.18s CSS transition, plus a little slack
  const state = await paneState();
  assert.equal(state.open, true);
  assert.equal(state.mode, 'tracker');
  assert.equal(state.ariaLabel, 'litrpg-tracker');
});

test('leaving the edge no longer closes tracker mode (a genuine fix: crossing onto the iframe fires a spurious mouseleave in Chromium, which used to close the pane before a click inside it could land)', async () => {
  await hover('side-hotzone', false);
  await tick(250);
  const state = await paneState();
  assert.equal(state.open, true, 'tracker mode must stay open so clicks inside the iframe can land');
  assert.equal(state.mode, 'tracker');
});

test('clicking outside the open tracker pane still closes it', async () => {
  await js(`document.getElementById('back-to-shelf').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
  await tick(100);
  const state = await paneState();
  assert.equal(state.open, false);
});

test('the Stickies button switches an open tracker pane to stickies mode, rather than just closing it', async () => {
  await hover('side-hotzone', true);
  await tick(250);
  assert.equal((await paneState()).mode, 'tracker'); // reopened in tracker mode, same as before
  await js(`document.getElementById('side-pane-toggle').click()`);
  await tick(100);
  const state = await paneState();
  const stickyDisplay = await js(`getComputedStyle(document.getElementById('sticky-list')).display`);
  const trackerDisplay = await js(`getComputedStyle(document.getElementById('tracker-pane-body')).display`);
  assert.equal(state.open, true);
  assert.equal(state.mode, 'stickies');
  assert.equal(state.ariaLabel, 'Notes & Comments');
  assert.equal(stickyDisplay, 'block');
  assert.equal(trackerDisplay, 'none');
});

test('clicking Stickies again, now that it is the open mode, closes it as a normal toggle', async () => {
  await js(`document.getElementById('side-pane-toggle').click()`);
  await tick(100);
  assert.equal((await paneState()).open, false);
});

test('hovering again after using Stickies correctly switches back to tracker mode', async () => {
  await hover('side-hotzone', true);
  await tick(250);
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
  assert.equal(await lit(), false, 'tracker mode is open from the previous test — the button stays unlit');
  await js(`document.getElementById('side-pane-toggle').click()`);
  await tick(100);
  assert.equal(await lit(), true);
  await js(`document.getElementById('side-pane-toggle').click()`);
  await tick(100);
  assert.equal(await lit(), false);
});

test('the full-screen button shows only in tracker mode, and toggles the pane wide', async () => {
  const wideDisplay = () => js(`getComputedStyle(document.getElementById('side-wide')).display`);
  const wide = () => js(`document.getElementById('side-pane').dataset.wide`);
  await hover('side-hotzone', true);
  await tick(250);
  assert.equal(await wideDisplay(), 'block');
  await js(`document.getElementById('side-wide').click()`);
  await tick(50);
  assert.equal(await wide(), '1');
  await js(`document.getElementById('side-wide').click()`);
  await tick(50);
  assert.equal(await wide(), '0');
  await js(`document.getElementById('side-pane-toggle').click()`); // over to Stickies
  await tick(100);
  assert.equal(await wideDisplay(), 'none');
});

test('leaving the Manuscript tab hides the Stickies button and closes the unpinned pane', async () => {
  const hidden = () => js(`document.getElementById('side-pane-toggle').hidden`);
  assert.equal((await paneState()).open, true, 'Stickies is open from the previous test');
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
const moveTo = (where) => js(`(() => {
  const r = document.getElementById('side-pane').getBoundingClientRect();
  const x = ${where === 'inside' ? 'r.left + 5' : 'Math.max(5, r.left - 200)'}, y = r.top + r.height / 2;
  document.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }));
})()`);

test('a selection let go outside the pane leaves it open; a normal exit still closes it', async () => {
  await hover('side-hotzone', true);
  await tick(300);
  assert.equal((await paneState()).open, true);
  await moveTo('inside');
  await tick(450); // the iframe has the mouse; this document hears nothing
  await moveTo('outside');
  await tick(50);
  assert.equal((await paneState()).open, true, 'stays open after an unseen exit');
  await moveTo('outside');
  await tick(50);
  assert.equal((await paneState()).open, true, 'and keeps staying open until the cursor comes back');
  await moveTo('inside');
  await tick(20);
  await moveTo('outside');
  await tick(50);
  assert.equal((await paneState()).open, false, 'a normal exit closes it');
});

test('after an unseen exit, a click elsewhere still closes the pane', async () => {
  await hover('side-hotzone', true);
  await tick(300);
  await moveTo('inside');
  await tick(450);
  await moveTo('outside');
  await tick(50);
  assert.equal((await paneState()).open, true);
  await js(`document.getElementById('back-to-shelf').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
  await tick(100);
  assert.equal((await paneState()).open, false);
});

test('while a tracker dialog is open, neither leaving the pane nor a click outside closes it', async () => {
  await js(`
    window.__prevUrl2 = trackerReadyUrl; trackerReadyUrl = 'http://stub/';
    window.__editing = true; window.__realFetch2 = window.fetch;
    window.fetch = (u) => String(u).includes('__tracker-editing')
      ? Promise.resolve({ ok: true, json: async () => ({ editing: window.__editing }) })
      : Promise.resolve({ ok: true, json: async () => ({}) }); 0`);
  await hover('side-hotzone', true);
  await tick(600); // past the slide-in, and a couple of polls
  await moveTo('inside');
  await tick(20);
  await moveTo('outside');
  await tick(50);
  assert.equal((await paneState()).open, true, 'held through the cursor leaving');
  await js(`document.getElementById('back-to-shelf').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
  await tick(50);
  assert.equal((await paneState()).open, true, 'held through a click outside');
  await js(`window.__editing = false; 0`); // the dialog closed
  await tick(400);
  await moveTo('inside');
  await tick(20);
  await moveTo('outside');
  await tick(50);
  assert.equal((await paneState()).open, false, 'released once the dialog closed');
  await js(`window.fetch = window.__realFetch2; trackerReadyUrl = window.__prevUrl2; 0`);
});

test('Refs tints referenced passages, names them on hover, and Alt+D turns it off', async () => {
  await js(`
    window.__prevUrl3 = trackerReadyUrl; trackerReadyUrl = 'http://stub/';
    window.__realFetch3 = window.fetch;
    window.fetch = (u) => {
      const url = String(u);
      if (url.includes('__references')) return Promise.resolve({ ok: true, json: async () => ({ version: 1, byChapter: { 1: [
        { kind: 'item', id: 'hello', name: 'Hello Sword', label: 'item', quote: 'Hello' },
        { kind: 'quest', id: 'gone', name: 'Gone Quest', label: 'quest', quote: 'not in this text' },
      ] } }) });
      if (url.includes('__version')) return Promise.resolve({ ok: true, json: async () => ({ version: 1 }) });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    };
    getSelection().removeAllRanges(); 0`);
  await js(`document.getElementById('tracker-refs-toggle').click()`);
  await tick(300);
  assert.equal(await js(`CSS.highlights.get('neo-tracker-refs')?.size ?? 0`), 1, 'the one quote that exists is tinted');
  assert.equal(await js(`document.getElementById('tracker-refs-toggle').classList.contains('active')`), true);
  // hover the middle of "Hello" (on screen: hit-testing only sees what's visible)
  await js(`document.querySelector('.chapter-body').scrollIntoView({ block: 'center' }); 0`);
  await tick(100);
  await js(`(() => {
    const body = document.querySelector('.chapter-body');
    const node = document.createTreeWalker(body, NodeFilter.SHOW_TEXT).nextNode();
    const r = document.createRange(); r.setStart(node, 1); r.setEnd(node, 3);
    const b = r.getBoundingClientRect();
    body.dispatchEvent(new MouseEvent('mousemove', { clientX: b.left + b.width / 2, clientY: b.top + b.height / 2, bubbles: true }));
  })()`);
  await tick(100);
  assert.equal(await js(`(() => { const t = document.getElementById('tracker-refs-tip'); return t && !t.hidden ? t.firstChild.textContent : null; })()`), 'Hello Sword (item)');
  assert.equal(await js(`document.querySelector('#tracker-refs-tip .tr-hint')?.textContent`), 'Ctrl+click to open');
  // and somewhere that isn't referenced
  await js(`document.querySelector('.chapter-body').dispatchEvent(new MouseEvent('mousemove', { clientX: 2, clientY: 2, bubbles: true }))`);
  await tick(100);
  assert.equal(await js(`document.getElementById('tracker-refs-tip').hidden`), true);
  assert.equal(await js(`localStorage.getItem('neo-tracker-refs')`), '1', 'remembered for next launch');
  await js(`document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD', key: 'd', altKey: true, bubbles: true, cancelable: true }))`);
  await tick(100);
  assert.equal(await js(`CSS.highlights.has('neo-tracker-refs')`), false, 'Alt+D turned it off');
  assert.equal(await js(`localStorage.getItem('neo-tracker-refs')`), '0');
  await js(`window.fetch = window.__realFetch3; trackerReadyUrl = window.__prevUrl3; 0`);
});

test('Refs follow a tracker write on their own, and a typing pause re-reads nothing', async () => {
  await js(`
    window.__prevUrl5 = trackerReadyUrl; trackerReadyUrl = 'http://stub/';
    window.__realFetch5 = window.fetch;
    window.__stub = { version: 1, refs: [], refFetches: 0 };
    window.fetch = (u) => {
      const url = String(u);
      if (url.includes('__references')) { window.__stub.refFetches += 1; return Promise.resolve({ ok: true, json: async () => ({ version: window.__stub.version, byChapter: { 1: window.__stub.refs } }) }); }
      if (url.includes('__version')) return Promise.resolve({ ok: true, json: async () => ({ version: window.__stub.version }) });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    };
    getSelection().removeAllRanges(); 0`);
  await js(`setTrackerRefs(true); 0`);
  await tick(300);
  assert.equal(await js(`CSS.highlights.get('neo-tracker-refs')?.size ?? 0`), 0, 'nothing referenced yet');
  // the tracker writes: its counter moves and the references change — no manuscript event
  await js(`window.__stub.version = 2; window.__stub.refs = [{ kind: 'item', id: 'hello', name: 'Hello Sword', label: 'item', quote: 'Hello' }]; 0`);
  await tick(1500);
  assert.equal(await js(`CSS.highlights.get('neo-tracker-refs')?.size ?? 0`), 1, 'tinted without touching the manuscript');
  const fetches = await js(`window.__stub.refFetches`);
  await js(`window.neoHooks.countersUpdated(); 0`);
  await tick(1200);
  assert.equal(await js(`CSS.highlights.get('neo-tracker-refs')?.size ?? 0`), 1, 'still tinted after a typing pause');
  assert.equal(await js(`window.__stub.refFetches`), fetches, 'a typing pause re-reads nothing');
  await js(`setTrackerRefs(false); window.fetch = window.__realFetch5; trackerReadyUrl = window.__prevUrl5; 0`);
});

// Ctrl+click a tinted passage: one entity opens straight away, several ask
// first. The intent post is recorded instead of made.
const helloPoint = () => js(`(() => {
  const body = document.querySelector('.chapter-body');
  body.scrollIntoView({ block: 'center' });
  const node = document.createTreeWalker(body, NodeFilter.SHOW_TEXT).nextNode();
  const r = document.createRange(); r.setStart(node, 1); r.setEnd(node, 3);
  const b = r.getBoundingClientRect();
  return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
})()`);
const stubRefs = (refs) => js(`
  window.__prevUrl4 = window.__prevUrl4 ?? trackerReadyUrl; trackerReadyUrl = 'http://stub/';
  window.__realFetch4 = window.__realFetch4 ?? window.fetch;
  window.__intents = [];
  window.fetch = (u) => {
    const url = String(u);
    if (url.includes('__references')) return Promise.resolve({ ok: true, json: async () => ({ version: Math.random(), byChapter: { 1: ${JSON.stringify(refs)} } }) });
    if (url.includes('__neo-intent')) window.__intents.push(decodeURIComponent(url.split('?')[1]));
    return Promise.resolve({ ok: true, json: async () => ({ version: 1 }) });
  }; 0`);
const ctrlClickHello = async () => {
  const p = await helloPoint();
  await tick(50);
  return js(`document.querySelector('.chapter-body').dispatchEvent(new MouseEvent('mousedown', { clientX: ${p.x}, clientY: ${p.y}, ctrlKey: true, button: 0, bubbles: true, cancelable: true })) ? 'not prevented' : 'prevented'`);
};

test('Alt+Shift+D adds the event passages, in their own highlight', async () => {
  await stubRefs([
    { kind: 'item', id: 'hello', name: 'Hello Sword', label: 'item', quote: 'Hello' },
    { kind: 'character', id: 'jake', name: 'Jake', label: 'HP −3', quote: 'llo', extra: true },
  ]);
  const key = (shiftKey) => js(`document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD', key: 'd', altKey: true, shiftKey: ${shiftKey}, bubbles: true, cancelable: true })); 0`);
  const sizes = () => js(`[CSS.highlights.get('neo-tracker-refs')?.size ?? 0, CSS.highlights.get('neo-tracker-refs-extra')?.size ?? 0]`);
  await key(false);
  await tick(300);
  assert.deepEqual(await sizes(), [1, 0], 'plain Refs leave the event passage out');
  await key(true);
  await tick(300);
  assert.deepEqual(await sizes(), [1, 1], 'Refs+ tints it separately');
  assert.equal(await js(`document.querySelector('#tracker-refs-toggle span').textContent`), '◎ Refs+');
  assert.equal(await js(`localStorage.getItem('neo-tracker-refs-extra')`), '1');
  await key(true);
  await tick(300);
  assert.deepEqual(await sizes(), [1, 0], 'and takes it away again, Refs staying on');
  await js(`setTrackerRefs(false); localStorage.setItem('neo-tracker-refs-extra', '0'); window.fetch = window.__realFetch4; trackerReadyUrl = window.__prevUrl4; delete window.__realFetch4; delete window.__prevUrl4; 0`);
});

test('Ctrl+click a tinted passage opens its entity in the drawer', async () => {
  await js(`document.getElementById('back-to-shelf').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
  await stubRefs([{ kind: 'item', id: 'hello', name: 'Hello Sword', label: 'item', quote: 'Hello' }]);
  await js(`setTrackerRefs(true); 0`);
  await tick(300);
  assert.equal(await ctrlClickHello(), 'prevented', 'the click was claimed, so the caret stays put');
  await tick(300);
  assert.deepEqual(await js(`window.__intents`), ['type=open&text=item:hello']);
  const state = await paneState();
  assert.equal(state.open, true);
  assert.equal(state.mode, 'tracker');
  // a plain click on the same passage is left alone
  const p = await helloPoint();
  assert.equal(await js(`document.querySelector('.chapter-body').dispatchEvent(new MouseEvent('mousedown', { clientX: ${p.x}, clientY: ${p.y}, button: 0, bubbles: true, cancelable: true })) ? 'not prevented' : 'prevented'`), 'not prevented');
});

test('Ctrl+click a passage several entities reference asks which one', async () => {
  await stubRefs([
    { kind: 'item', id: 'hello', name: 'Hello Sword', label: 'item', quote: 'Hello' },
    { kind: 'character', id: 'greeter', name: 'Greeter', label: 'character', quote: 'Hello' },
  ]);
  await js(`paintTrackerRefs(true); 0`);
  await tick(300);
  await ctrlClickHello();
  await tick(200);
  const items = await js(`[...document.querySelectorAll('.pop-menu button')].map((b) => b.textContent)`);
  assert.deepEqual(items, ['Hello Sword (item)', 'Greeter (character)']);
  await js(`[...document.querySelectorAll('.pop-menu button')][1].click()`);
  await tick(300);
  assert.deepEqual(await js(`window.__intents`), ['type=open&text=character:greeter']);
  await js(`setTrackerRefs(false); window.fetch = window.__realFetch4; trackerReadyUrl = window.__prevUrl4; delete window.__realFetch4; delete window.__prevUrl4; 0`);
});

// Both the outside-click closer and the Ctrl+click opener are capture
// listeners on document, the closer registered first — so without the
// closer stepping aside, a Ctrl+click with the drawer open closed it and
// the opener reopened it a moment later.
test('Ctrl+click a tinted passage while the drawer is already open keeps it open, without a close-and-reopen', async () => {
  await stubRefs([{ kind: 'item', id: 'hello', name: 'Hello Sword', label: 'item', quote: 'Hello' }]);
  await js(`setTrackerRefs(true); 0`);
  await hover('side-hotzone', true);
  await tick(300);
  assert.equal((await paneState()).open, true);
  // count closes at the source: closeSidePane is the one way the pane shuts
  await js(`window.__closes = 0; window.__realClose = closeSidePane; closeSidePane = () => { window.__closes++; window.__realClose(); }; 0`);
  await ctrlClickHello();
  await tick(300);
  assert.equal(await js(`window.__closes`), 0, 'the outside-click closer left the Ctrl+click alone');
  assert.equal((await paneState()).open, true);
  assert.deepEqual(await js(`window.__intents`), ['type=open&text=item:hello']);
  await js(`closeSidePane = window.__realClose; setTrackerRefs(false); 0`);
});

test('a click that closes the pane also releases the flow hold', async () => {
  assert.equal((await paneState()).open, true, 'still open from the Ctrl+click above');
  await js(`trackerFlowActive = true; 0`);
  await js(`document.getElementById('back-to-shelf').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
  await tick(100);
  assert.equal((await paneState()).open, false);
  assert.equal(await js(`trackerFlowActive`), false, 'closing released the hold');
  await hover('side-hotzone', true);
  await tick(300);
  await moveTo('inside');
  await tick(20);
  await moveTo('outside');
  await tick(50);
  assert.equal((await paneState()).open, false, 'so the next open auto-closes on a normal exit again');
  await js(`window.fetch = window.__realFetch4; trackerReadyUrl = window.__prevUrl4; delete window.__realFetch4; delete window.__prevUrl4; 0`);
});

// Right-click / Ctrl+Shift+A: a single "new" intent carrying the selection,
// no menus here — the tracker's own chooser asks for kind and owner — and
// the keyboard handed to the drawer so that chooser's number keys work.
const selectHello = () => js(`(() => {
  const body = document.querySelector('.chapter-body');
  const node = document.createTreeWalker(body, NodeFilter.SHOW_TEXT).nextNode();
  const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, 5);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range); return sel.toString();
})()`);

test('right-clicking a selection opens the drawer and asks for a New entry — no menu', async () => {
  await js(`document.getElementById('back-to-shelf').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
  await stubRefs([]);
  assert.equal(await selectHello(), 'Hello');
  const p = await helloPoint();
  const claimed = await js(`!document.querySelector('.chapter-body').dispatchEvent(new MouseEvent('contextmenu', { clientX: ${p.x}, clientY: ${p.y}, button: 2, bubbles: true, cancelable: true }))`);
  assert.equal(claimed, true, 'the bridge claimed the right-click');
  await tick(300);
  assert.equal(await js(`!!document.querySelector('.pop-menu')`), false, 'no kind or owner menu');
  assert.deepEqual(await js(`window.__intents`), ['type=new&text=Hello&chapter=1']);
  const state = await paneState();
  assert.equal(state.open, true);
  assert.equal(state.mode, 'tracker');
});

test('Ctrl+Shift+A asks for a New entry from the keyboard: the selection as its name, or nothing', async () => {
  // a stand-in drawer frame when the real one was never built (no tracker
  // server in this run), so the focus hand-off has something to land on
  await js(`window.__stubFrame = !trackerFrame; if (window.__stubFrame) { trackerFrame = document.createElement('iframe'); document.body.appendChild(trackerFrame); } window.__intents = []; 0`);
  assert.equal(await selectHello(), 'Hello');
  await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'A', code: 'KeyA', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }))`);
  await tick(300);
  assert.deepEqual(await js(`window.__intents`), ['type=new&text=Hello&chapter=1']);
  assert.equal(await js(`document.activeElement === trackerFrame`), true, 'the keyboard is in the drawer');
  await js(`if (window.__stubFrame) { trackerFrame.remove(); trackerFrame = null; } delete window.__stubFrame; 0`);
  await js(`window.__intents = []; getSelection().removeAllRanges(); 0`);
  await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'A', code: 'KeyA', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }))`);
  await tick(300);
  assert.deepEqual(await js(`window.__intents`), ['type=new&text='], 'an empty dialog with nothing selected');
  // the second "l" of "Hello": the tracker is told which one
  await js(`(() => {
    const node = document.createTreeWalker(document.querySelector('.chapter-body'), NodeFilter.SHOW_TEXT).nextNode();
    const range = document.createRange(); range.setStart(node, 3); range.setEnd(node, 4);
    getSelection().removeAllRanges(); getSelection().addRange(range); window.__intents = [];
  })()`);
  await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'A', code: 'KeyA', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }))`);
  await tick(300);
  assert.deepEqual(await js(`window.__intents`), ['type=new&text=l&chapter=1&occurrence=2']);
  await js(`document.getElementById('back-to-shelf').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
  await js(`window.fetch = window.__realFetch4; trackerReadyUrl = window.__prevUrl4; delete window.__realFetch4; delete window.__prevUrl4; 0`);
});

// The Ctrl+D palette, against a stand-in tracker server: a canned search
// hit, and a recorded quick-reference post. Nothing here needs the real
// tracker; trackerReadyUrl is pointed at the stub for these two cases.
const ctrlD = () => js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, bubbles: true, cancelable: true }))`);
const paletteInput = () => js(`(() => { const i = document.querySelector('#tracker-palette input'); return i ? { value: i.value, focused: document.activeElement === i, selected: i.value.slice(i.selectionStart, i.selectionEnd) } : null; })()`);

test('Ctrl+D opens the palette prefilled with the selection; Enter files it and puts the selection back', async () => {
  await js(`document.getElementById('back-to-shelf').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
  await tick(100);
  await js(`
    window.__prevUrl = trackerReadyUrl; trackerReadyUrl = 'http://stub/';
    window.__posts = []; window.__realFetch = window.fetch;
    window.fetch = (u, o) => {
      const url = String(u);
      if (url.includes('__search')) return Promise.resolve({ ok: true, json: async () => ({ hits: [{ kind: 'item', id: 'sword', name: 'Sword', label: 'item' }] }) });
      if (url.includes('__quick-reference')) { window.__posts.push(JSON.parse(o.body)); return Promise.resolve({ ok: true, json: async () => ({ ok: true, name: 'Sword', references: [], presentAdded: false }) }); }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    };
    // select the first word of the test chapter
    const body = document.querySelector('.chapter-body');
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    const node = walker.nextNode();
    const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, 5);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range); 0`);
  assert.equal(await js(`getSelection().toString()`), 'Hello');
  await ctrlD();
  await tick(400);
  assert.deepEqual(await paletteInput(), { value: 'Hello', focused: true, selected: 'Hello' });
  assert.equal(await js(`document.querySelector('#tracker-palette li.active .tp-name')?.textContent`), 'Sword', 'the prefilled query already found a hit');
  await js(`const i = document.querySelector('#tracker-palette input'); i.value = 'sw'; i.dispatchEvent(new Event('input')); 0`);
  await tick(200);
  assert.equal(await js(`document.querySelectorAll('#tracker-palette li').length`), 1);
  await js(`document.querySelector('#tracker-palette input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))`);
  await tick(300);
  assert.deepEqual(await js(`window.__posts`), [{ target: 'item', id: 'sword', chapter: 1, quote: 'Hello' }]);
  assert.equal(await js(`!!document.getElementById('tracker-palette')`), false, 'the palette closed');
  assert.equal(await js(`getSelection().toString()`), 'Hello', 'the selection is back');
  assert.equal(await js(`document.activeElement === document.querySelector('.chapter-body')`), true, 'and so is focus');
});

test('Escape closes the palette without posting, selection intact', async () => {
  await ctrlD();
  await tick(300);
  assert.equal((await paletteInput())?.value, 'Hello');
  await js(`document.querySelector('#tracker-palette input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
  await tick(100);
  assert.equal(await js(`!!document.getElementById('tracker-palette')`), false);
  assert.equal(await js(`window.__posts.length`), 1, 'nothing new was posted');
  assert.equal(await js(`getSelection().toString()`), 'Hello');
  await js(`window.fetch = window.__realFetch; trackerReadyUrl = window.__prevUrl; 0`);
});

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
    await tick(400);
    win.focus();
    for (const t of tests) {
      try {
        win.focus(); // the window can lose OS focus mid-run, which would correctly auto-close an unpinned pane
        await t.fn();
        console.log('ok   ' + t.name);
      } catch (err) {
        failed++;
        console.log('FAIL ' + t.name + '\n     ' + String(err.message).replace(/\n/g, '\n     '));
      }
    }
    console.log(`\n${tests.length - failed} passed, ${failed} failed`);
  } finally {
    app.quit();
  }
  process.exitCode = failed ? 1 : 0;
}

main();
