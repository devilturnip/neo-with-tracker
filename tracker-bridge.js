// litrpg-tracker bridge — everything this fork adds to NEO's renderer.
//
// Loaded by index.html right after app.js (desktop only; Pocket never gets
// it). It is a classic script like app.js, so app.js's top-level functions
// and state ($, t, book, currentChapterId, chapterNumber, popMenu, toast,
// bodyPlainText, textPosToRange, goToChapterTop, ...) are globals here, and
// app.js reaches back through the window.neoHooks table installed at the
// bottom of this file — those `neoHooks` one-liners are the only tracker
// lines app.js carries (see README.md, "The tracker bridge").
//
// What it does, in order: adds the fork's few extra controls to the DOM,
// gives the right-edge pane a second mode (the tracker, beside Notes &
// Comments / Stickies), embeds the tracker's dev server in that pane, and
// runs the NEO <-> tracker traffic: current chapter, word count, live
// selection, one-shot "create this" intents, the manuscript text for
// stale-quote checks, and jump-to-passage requests coming back the other way.
'use strict';

/* ================================================================== */
/*  Markup the fork adds                                                */
/* ================================================================== */

// Built here rather than in index.html so the HTML stays upstream's.
// applyStaticI18n (app.js) translates the data-i18n* marks the same way it
// does for index.html's own.
function trackerElement(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  applyStaticI18n(tpl.content);
  return tpl.content.firstElementChild;
}
// the pane's title: the Notes & Comments span shows in stickies mode, the
// tracker one in tracker mode (tracker.css picks by data-mode)
$('#side-head > span[data-i18n]').classList.add('side-title-notes');
$('#side-head > .side-title-notes').after(trackerElement('<span class="side-title-tracker" data-i18n>litrpg-tracker</span>'));
// "full screen" for the tracker, beside the pin (see setTrackerWide)
$('#side-pin').before(trackerElement('<button id="side-wide" data-i18n-title title="Full screen" data-i18n-label="Full screen" aria-pressed="false">&#8599;</button>'));
// the litrpg-tracker dev server lives here once the pane opens in tracker mode
$('#sticky-list').after(trackerElement('<div id="tracker-pane-body"></div>'));
// the side pane (Notes & Comments) opens from this bottombar button now that
// the right edge belongs to the tracker (see openSidePane)
$('#tabs .tab[data-tab="manuscript"]').after(trackerElement('<button id="side-pane-toggle" data-i18n-title title="Notes & Comments" data-i18n-label="Notes & Comments" aria-pressed="false"><span data-i18n>Stickies</span></button>'));
// tint every passage the tracker has a reference on (see paintTrackerRefs)
$('#side-pane-toggle').after(trackerElement('<button id="tracker-refs-toggle" data-i18n-title title="Show the tracker’s references in the text (Alt+D); every other tracked passage too (Shift+click or Alt+Shift+D)" aria-pressed="false"><span data-i18n>◎ Refs</span></button>'));

/* ================================================================== */
/*  The side pane's two modes                                           */
/* ================================================================== */

// The side pane has more than one thing it can show (the tracker, Notes &
// Comments) — pinning it only remembers *that* it's open, not which, so a
// pin left on the tracker reopened to Notes & Comments at next launch
// instead. Kept in step by the observer below, so the saved mode always
// matches what's actually on screen, not just whatever it was when the pin
// was first clicked.
function rememberPinnedSideMode() {
  const pane = $('#side-pane');
  if (pane.dataset.pinned !== '1') return;
  try {
    const kept = JSON.parse(localStorage.getItem('neo-pinned-panes') || '{}');
    kept.sideMode = pane.dataset.mode || '';
    localStorage.setItem('neo-pinned-panes', JSON.stringify(kept));
  } catch { /* fine: it just won't be remembered */ }
}

// The bottombar button lights up while the pane is open on Stickies. Driven
// off the pane's own attributes rather than from every place that opens or
// closes it, so app.js's own paths (pinPane, closeUnpinnedPanes, the tab
// switch) need no tracker code to keep the button honest.
function syncSideToggle() {
  const pane = $('#side-pane');
  const on = pane.classList.contains('open') && pane.dataset.mode === 'stickies';
  $('#side-pane-toggle').classList.toggle('active', on);
  $('#side-pane-toggle').setAttribute('aria-pressed', on ? 'true' : 'false');
}
new MutationObserver((records) => {
  syncSideToggle();
  if (records.some((r) => r.attributeName !== 'class')) rememberPinnedSideMode();
}).observe($('#side-pane'), { attributes: true, attributeFilter: ['class', 'data-mode', 'data-pinned'] });

// The side pane (Notes & Comments) opens from the bottombar button instead
// of a right-edge hover, so the right edge is free for the tracker.
function openSidePane() {
  const pane = $('#side-pane');
  pane.dataset.mode = 'stickies';
  pane.setAttribute('aria-label', t('Notes & Comments'));
  pane.classList.add('open');
  sideCardsUpdate(true); // the "cards beside the page" preview, same as the old hover used to trigger
}
function closeSidePane() {
  $('#side-pane').classList.remove('open');
  // whatever flow was holding the pane open is over once it's closed — a
  // hold left set here would make the next open ignore the cursor leaving
  // until it had visited the pane once
  trackerFlowActive = false;
}
$('#side-pane-toggle').onclick = () => {
  const pane = $('#side-pane');
  // open in some OTHER mode (the tracker, now that it can stay open while
  // you work in it) switches to stickies rather than just closing it
  if (pane.classList.contains('open') && pane.dataset.mode === 'stickies') closeSidePane();
  else openSidePane();
};
// a click outside the (unpinned) open pane closes it, the way a pop-menu does
document.addEventListener('mousedown', (e) => {
  const pane = $('#side-pane');
  if (!pane.classList.contains('open') || pane.dataset.pinned === '1') return;
  if ($('#editor-view').classList.contains('darlings-tab')) return; // snapshots stay
  // a tracker dialog is open (see trackerEditing): a click into the
  // manuscript — to select a passage for it, say — mustn't take it away
  if (trackerEditing && pane.dataset.mode === 'tracker') return;
  if (pane.contains(e.target) || e.target.closest('#side-pane-toggle')) return;
  // a pop-menu (the Ctrl+click "Open in the tracker" picker) renders at
  // document.body, not inside #side-pane, at whatever position the
  // triggering click happened — so picking an item in one reads as
  // "clicked outside the pane" here and would otherwise close it out from
  // under the flow this click is part of.
  if (e.target.closest('.pop-menu')) return;
  // a Ctrl+click (⌘ on a Mac) on a tinted passage belongs to the ref opener
  // further down, which keeps the pane — both listeners are capture-phase on
  // document and this one runs first, so closing here would only flicker
  // the pane shut and open again
  if (e.button === 0 && (IS_MAC ? e.metaKey : e.ctrlKey) && !e.altKey && !e.shiftKey &&
      trackerRefsAt(e.clientX, e.clientY, e.target).length) return;
  closeSidePane();
}, true);

// the litrpg-tracker panel opens the same way Notes & Comments used to:
// hovering the right edge. app.js's own wireHoverPane listener on the same
// hotzone has already added .open by the time this runs; both happen inside
// one event dispatch, so the pane never paints in the wrong mode.
let trackerPaneOpenedAt = 0;
// Set while a gesture out in the manuscript (a right-click or Ctrl+Shift+A for a
// New entry, a Ctrl+click on a tinted passage, a new chapter) is bringing
// the pane up — while true, the mousemove listener below never closes the
// pane, since the cursor is wherever that gesture happened, not over the
// pane. Cleared the moment the cursor is actually seen inside the pane
// (the user looking at the dialog that just opened), which hands auto-
// close back to normal; a deliberate click elsewhere still closes it
// regardless (see the mousedown listener above, and closeSidePane).
let trackerFlowActive = false;
// Shared by the hover gesture and the New entry gesture (further down) —
// either one puts the pane in tracker mode and gets the dev server
// starting, without waiting on it.
function openTrackerPane() {
  const pane = $('#side-pane');
  pane.dataset.mode = 'tracker';
  pane.setAttribute('aria-label', t('litrpg-tracker'));
  pane.classList.add('open');
  trackerPaneOpenedAt = Date.now(); // the slide-in transition takes 0.18s — see the mousemove listener below
  return ensureTrackerPane();
}
$('#side-hotzone').addEventListener('mouseenter', (e) => {
  if (e.buttons) return; // dragging something — stand down, same guard wireHoverPane uses
  openTrackerPane();
});

// "Full screen" for the tracker: an overlay you step into and back out of
// (see the CSS comment on [data-wide="1"]) — unlike pinPane, this never
// forces the pane open on its own; it only changes how big the pane gets
// while something else (hover, pin, the right-click flow) has it open.
function setTrackerWide(on) {
  const pane = $('#side-pane');
  pane.dataset.wide = on ? '1' : '0';
  $('#side-wide').classList.toggle('on', on);
  $('#side-wide').setAttribute('aria-pressed', on ? 'true' : 'false');
  try {
    const kept = JSON.parse(localStorage.getItem('neo-pinned-panes') || '{}');
    kept.trackerWide = on;
    localStorage.setItem('neo-pinned-panes', JSON.stringify(kept));
  } catch { /* fine: it just won't be remembered */ }
}
$('#side-wide').onclick = () => setTrackerWide($('#side-pane').dataset.wide !== '1');

// app.js has already re-pinned the pane open at this point (its own
// neo-pinned-panes restore); this puts back which mode it was showing.
if (!NO_HOVER) {
  try {
    const kept = JSON.parse(localStorage.getItem('neo-pinned-panes') || '{}');
    if (kept.side) {
      if (kept.sideMode === 'tracker') openTrackerPane();
      else openSidePane();
    }
    if (kept.trackerWide) setTrackerWide(true);
  } catch { /* nothing kept */ }
}

// Closes the tracker panel once the mouse has genuinely left it — but not
// via mouseleave, which fires the instant the cursor crosses onto the
// iframe (a separate renderer) and can't be trusted here; that's why the
// hover hook below holds the pane open against wireHoverPane's own close.
// This instead checks real cursor position against the pane's own bounding
// box on every mousemove the parent document actually receives. That
// naturally stops firing the moment the cursor enters the iframe (its
// content never bubbles mouse events up to this document at all), so the
// last reading just holds "still inside" for as long as the cursor is in
// there, and resumes — accurately — the instant it's back over our own
// content. No debounce needed: by the time a mousemove reports the cursor
// outside the pane, it genuinely is.
// This document's own last cursor reading over the pane, and when. A
// reading outside that follows an *old* inside one means the cursor left
// while the iframe had it — a text selection dragged out of a tracker
// field holds the mouse inside the iframe until let go, so this document
// sees nothing between the press and the first move after release. A
// normal exit passes through the pane's own side padding on the way out,
// which leaves a reading inside only milliseconds before.
let trackerLastSeen = { inside: false, at: 0 };
const TRACKER_UNSEEN_EXIT_MS = 300;

document.addEventListener('mousemove', (e) => {
  const pane = $('#side-pane');
  if (pane.dataset.mode !== 'tracker' || !pane.classList.contains('open') || pane.dataset.pinned === '1') return;
  // the pane's own 0.18s slide-in transition means its rect is still mid-
  // animation (partly off-screen) for a moment right after opening —
  // skip the check until that's settled, or it reads as "outside" and
  // closes the pane an instant after it opened
  if (Date.now() - trackerPaneOpenedAt < 250) return;
  const r = pane.getBoundingClientRect();
  const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  const previous = trackerLastSeen;
  trackerLastSeen = { inside, at: Date.now() };
  // Out of nowhere (see trackerLastSeen above): treat it like the
  // right-click flow — stay open until the cursor is genuinely back over
  // the pane, or a click lands somewhere else.
  if (!inside && previous.inside && Date.now() - previous.at > TRACKER_UNSEEN_EXIT_MS) trackerFlowActive = true;
  if (trackerEditing) return; // a tracker dialog is open — held regardless of where the cursor is
  if (trackerFlowActive) {
    if (inside) trackerFlowActive = false; // genuinely engaging with it now — resume normal tracking
    return; // never auto-close mid-flow (or just after) purely from cursor position
  }
  if (!inside) closeSidePane();
});

/* ================================================================== */
/*  The tracker itself: its dev server, in an iframe                    */
/* ================================================================== */

// A live view of the tracker's own dev server, embedded as an iframe in
// #tracker-pane-body (the pane's tracker-mode content). The pane itself
// opens immediately on hover regardless of load state — this only gates
// the iframe's own creation/loading.
let trackerFrame = null;
let trackerReadyUrl = null;
let trackerPanePromise = null;
function ensureTrackerPane() {
  if (trackerPanePromise) return trackerPanePromise;
  trackerPanePromise = (async () => {
    const result = await window.neo.trackerEnsure();
    const body = $('#tracker-pane-body');
    if (!result.ok) {
      body.textContent = t('Tracker not available') + (result.reason === 'missing-repo' ? '' : ' (' + result.reason + ')');
      trackerPanePromise = null; // let the next hover try again
      return;
    }
    // a trailing slash matters for the URLs built from this below
    trackerReadyUrl = result.url.replace(/\/?$/, '/');
    notifyTrackerOfChapter(true); // the dev server is up — post the current chapter now, so it's already there the moment the page's own poll starts (no need to wait on the iframe's load)
    schedulePaintTrackerRefs(); // Refs left on from last time can paint now
    if (!trackerFrame) {
      trackerFrame = document.createElement('iframe');
      trackerFrame.id = 'tracker-frame';
      // Cross-origin iframes don't inherit clipboard access by default —
      // without this, its own "Copy" buttons call navigator.clipboard.
      // writeText() and it silently fails (NotAllowedError, swallowed),
      // so the button looks like it worked but nothing lands on paste.
      trackerFrame.allow = 'clipboard-write';
      body.textContent = ''; // clear any earlier "not available" message
      body.appendChild(trackerFrame);
    }
    // ?embed=neo tells the tracker's own App.tsx to pick its 'neo' theme
    // scheme (theme.css) — flat, muted, NEO's own palette/font — instead of
    // its usual Castlevania-pause-menu look
    const frameSrc = trackerReadyUrl + '?embed=neo';
    if (trackerFrame.src !== frameSrc) trackerFrame.src = frameSrc;
  })();
  return trackerPanePromise;
}

/* ================================================================== */
/*  NEO -> tracker                                                      */
/* ================================================================== */

// Follows the current chapter as the author writes/navigates. This was
// originally a cross-origin location.href navigation (differing only in the
// fragment, so the browser treats it as a same-document hash change), then
// a contentWindow.postMessage() — both reliably hung the renderer in
// testing. This instead posts to the dev server's own /__neo-chapter
// endpoint (fire-and-forget, mode:'no-cors' since it's a file://-to-http
// cross-origin request NEO never needs to read a response from), which
// litrpg-tracker's App.tsx polls — the same shape as every other write this
// app already makes to that server. Debounced so rapid scroll-driven
// chapter changes don't spam requests; skips a redundant post to the same
// chapter.
let trackerNotifiedChapter = null;
let trackerNotifyTimer = null;
function notifyTrackerOfChapter(immediate) {
  if (!trackerReadyUrl || !currentChapterId || !book) return;
  clearTimeout(trackerNotifyTimer);
  const go = () => {
    const n = chapterNumber(currentChapterId);
    if (n === trackerNotifiedChapter) return;
    trackerNotifiedChapter = n;
    fetch(trackerReadyUrl + '__neo-chapter?n=' + n, { method: 'POST', mode: 'no-cors' }).catch(() => {});
  };
  if (immediate) go();
  else trackerNotifyTimer = setTimeout(go, 400);
}

// Same reasoning and shape as notifyTrackerOfChapter above, for the word
// count of whatever chapter is currently being written — called from
// updateCounters() (the countersUpdated hook), so it rides along with every
// count refresh rather than needing its own typing listener. Only ever
// reports the chapter currently open; other chapters' counts stay whatever
// they were until visited.
let trackerNotifiedWords = null;
let trackerNotifyWordsTimer = null;
function notifyTrackerOfWordCount() {
  if (!trackerReadyUrl || !currentChapterId || !book) return;
  clearTimeout(trackerNotifyWordsTimer);
  trackerNotifyWordsTimer = setTimeout(() => {
    const n = chapterNumber(currentChapterId);
    const words = chapterWords(currentChapterId);
    const key = n + ':' + words;
    if (key === trackerNotifiedWords) return;
    trackerNotifiedWords = key;
    fetch(trackerReadyUrl + '__neo-wordcount?chapter=' + n + '&words=' + words, { method: 'POST', mode: 'no-cors' }).catch(() => {});
  }, 1000); // typing settles before this fires — no point syncing every keystroke
}

// The reverse of textPosToRange (app.js): given a text node + offset inside
// it (a live Selection's own startContainer/startOffset, say), find how far
// into bodyPlainText(body) that point falls. Same TreeWalker-over-text-nodes
// approach, just stopping at the matching node instead of a target length.
function rangeToTextPos(body, node, offset) {
  const w = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  let n, acc = 0;
  while ((n = w.nextNode())) {
    if (n === node) return acc + offset;
    acc += n.textContent.length;
  }
  return -1;
}

// NEO's own live manuscript selection, followed into the tracker so a +/-
// or EditDialog edit made there can tie itself to a sentence in the text —
// select it here first, then make the edit over in the panel. No explicit
// Content-Type, so the body defaults to text/plain and the request stays
// CORS-simple, same reasoning as sendManuscriptText below. Pushes the empty
// string the moment the selection collapses or moves outside the chapter
// body, so a stale quote never lingers past the instant it stops being
// true — unlike the one-shot intents elsewhere on this pane, this is live
// state, always reflecting whatever's highlighted right now.
// The live manuscript selection, if there is one: the chapter body it sits
// in, its text, a copy of its range (to put it back after the palette has
// had the keyboard), and which occurrence of that text within the chapter
// the selection starts at (1 = the first) — so the tracker can tell apart
// two references that share a chapter and quote (the same short word
// mentioned twice), and later jump back to the right one. Best-effort:
// only computed when the selection's start position can be found at all;
// nothing downstream requires it.
function selectionInfo() {
  const sel = window.getSelection();
  let el = sel.rangeCount ? sel.anchorNode : null;
  if (el && el.nodeType === Node.TEXT_NODE) el = el.parentElement;
  const body = el && el.closest ? el.closest('.chapter-body') : null;
  const text = body && !sel.isCollapsed ? sel.toString().trim() : '';
  if (!text) return null;
  const range = sel.getRangeAt(0);
  let occurrence = null;
  const pos = rangeToTextPos(body, range.startContainer, range.startOffset);
  if (pos !== -1) {
    const plain = bodyPlainText(body).toLowerCase();
    const needle = text.toLowerCase();
    let idx = -1, count = 0;
    while ((idx = plain.indexOf(needle, idx + 1)) !== -1 && idx <= pos) count++;
    if (count > 0) occurrence = count;
  }
  return { body, text, occurrence, range: range.cloneRange() };
}

// Where the cursor is, for the tracker's screens to show the chapter as of
// there: the chapter, and the caret's offset into chapterText(id) — the text
// the tracker holds, which strips what UNCOUNTED names and puts a newline
// after each paragraph (app.js). Measured by marking the spot in a clone
// and reading it the way chapterText does. Null outside a chapter body, or
// inside something stripped.
function caretPlace() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  const start = range.startContainer;
  const el = start.nodeType === Node.TEXT_NODE ? start.parentElement : start;
  const body = el && el.closest ? el.closest('.chapter-body') : null;
  const chapter = body && body.closest('.chapter[data-id]');
  if (!body || !chapter || !body.contains(range.endContainer)) return null;
  const clone = body.cloneNode(true);
  // The same node in the clone, by the path of child indexes down to it.
  const twin = (node) => {
    const path = [];
    for (let n = node; n !== body; n = n.parentNode) path.unshift(Array.prototype.indexOf.call(n.parentNode.childNodes, n));
    let at = clone;
    for (const i of path) at = at.childNodes[i];
    return at;
  };
  const mark = (node, offset, char) => {
    const at = twin(node);
    const m = document.createTextNode(char);
    if (at.nodeType === Node.TEXT_NODE) { at.splitText(offset); at.after(m); } else at.insertBefore(m, at.childNodes[offset] || null);
  };
  // The end first, so splitting the start's text node can't move it.
  if (!range.collapsed) mark(range.endContainer, range.endOffset, '\u0001');
  mark(range.startContainer, range.startOffset, '\u0000');
  clone.querySelectorAll(UNCOUNTED).forEach((n) => n.remove());
  const marked = plainText(clone);
  const offset = marked.indexOf('\u0000');
  if (offset === -1) return null;
  const endMark = marked.indexOf('\u0001');
  const text = marked.replace('\u0000', '').replace('\u0001', '');
  const end = endMark === -1 ? undefined : endMark > offset ? endMark - 1 : endMark;
  return { chapter: chapterNumber(chapter.dataset.id), offset, ...(end === undefined ? {} : { end }), text };
}

// NEO's darlings as the tracker takes them: a passage cut from the
// manuscript lives on in one, and the tracker follows it there.
function trackerDarlings() {
  return darlings.map((d) => ({
    id: d.id, chapter: d.chapterId && book ? chapterNumber(d.chapterId) : null,
    text: d.text, date: d.date,
  }));
}

// The text of each chapter as the tracker last got it, so the cursor's
// chapter is sent again only once it's been typed in: an offset counted in
// today's text, placed in a copy from minutes ago, lands in the wrong spot.
// The darlings ride along, and go on their own when only they changed.
const trackerSentText = new Map(); // chapter number -> text
let trackerSentDarlings = null;
async function sendChapterTextIfChanged(number, text) {
  const list = trackerDarlings();
  const sig = JSON.stringify(list);
  const sameText = trackerSentText.get(number) === text;
  if (sameText && sig === trackerSentDarlings) return;
  trackerSentText.set(number, text);
  trackerSentDarlings = sig;
  await fetch(trackerReadyUrl + '__neo-manuscript-text', {
    method: 'POST',
    body: JSON.stringify({ partial: true, chapters: sameText ? [] : [{ number, text }], darlings: list }),
  }).catch(() => {});
}
// After a cut, a restore or a delete: the chapter's text and the darlings,
// once things settle (restoring puts text back with no selection change).
let trackerSettleTimer = null;
function sendCurrentChapterSoon() {
  if (!trackerReadyUrl || !book) return;
  clearTimeout(trackerSettleTimer);
  trackerSettleTimer = setTimeout(() => {
    const chId = currentChapterId || book.chapterOrder[0];
    if (chId) sendChapterTextIfChanged(chapterNumber(chId), chapterText(chId));
  }, 300);
}

let trackerNotifiedSelection = null;
let trackerNotifySelectionTimer = null;
function notifyTrackerOfSelection() {
  if (!trackerReadyUrl) return;
  // The palette's own input holds the selection while it's up; the
  // manuscript's is coming back the moment it closes.
  if (palette) return;
  // 120 ms: a drag's changes come milliseconds apart and still coalesce;
  // a click reaches the tracker's screens almost at once.
  clearTimeout(trackerNotifySelectionTimer);
  trackerNotifySelectionTimer = setTimeout(() => {
    const info = selectionInfo();
    const text = info ? info.text : '';
    const occurrence = info ? info.occurrence : null;
    const caret = caretPlace();
    // Keyed on text, occurrence and cursor together, not text alone —
    // otherwise selecting the second "Cheshire" right after the first would
    // look unchanged and never get reposted.
    const key = text + ':' + (occurrence || '') + ':' + (caret ? caret.chapter + ':' + caret.offset : '');
    if (key === trackerNotifiedSelection) return;
    trackerNotifiedSelection = key;
    const params = [];
    if (occurrence && occurrence > 1) params.push('occurrence=' + occurrence);
    if (caret) params.push('chapter=' + caret.chapter, 'caret=' + caret.offset);
    if (caret && caret.end !== undefined && text) params.push('end=' + caret.end);
    const qs = params.length ? '?' + params.join('&') : '';
    const post = () => fetch(trackerReadyUrl + '__neo-selection' + qs, { method: 'POST', body: text }).catch(() => {});
    if (caret) sendChapterTextIfChanged(caret.chapter, caret.text).then(post);
    else post();
  }, 120);
}
document.addEventListener('selectionchange', notifyTrackerOfSelection);

// Posts a one-shot request ("new": open the New entry dialog on this text;
// "open": show this entity) for the tracker's own polling to pick up (see notifyTrackerOfChapter above for why this goes through the
// dev server rather than the iframe directly — the same reasoning applies
// here, and no-cors/query-string is the same shape for the same reason).
async function sendTrackerIntent(type, text, extra = {}) {
  let url = trackerReadyUrl + '__neo-intent?type=' + encodeURIComponent(type) + '&text=' + encodeURIComponent(text);
  for (const [key, value] of Object.entries(extra)) if (value != null) url += '&' + key + '=' + encodeURIComponent(value);
  await fetch(url, { method: 'POST', mode: 'no-cors' }).catch(() => {});
}

// Opens the tracker panel and its own "New chapter" dialog, prefilled with
// the chapter number NEO just gave this chapter — fire-and-forget, same
// reasoning as sendTrackerIntent above (createChapterAt itself must stay
// synchronous for its many existing callers). Reached from the
// chapterCreated hook: the one shared place every interactive "make a new
// chapter" gesture goes through (3-Enter split, the Chapters pane's +,
// Outline's Enter/Shift+Tab, the card view's +Chapter) — not file import or
// sync/undo mechanics, which build chapter ids by hand instead.
function notifyTrackerOfNewChapter(chId) {
  (async () => {
    // The pane opens here with the mouse wherever the author's typing left
    // it — almost never over the pane itself — so the mousemove auto-close
    // listener (see its comment above) would otherwise close it again the
    // instant it next fires, often before the dialog has even loaded.
    // trackerFlowActive holds it open the same way the right-click New
    // entry gesture does, until the cursor genuinely moves over it.
    trackerFlowActive = true;
    await openTrackerPane();
    if (!trackerReadyUrl) { trackerFlowActive = false; return; } // tracker not available — nothing to do
    await sendTrackerIntent('chapter-create', String(chapterNumber(chId)));
  })();
}

// The whole book's plain text, one entry per chapter — pushed to the
// tracker every 10 minutes (see the interval below) or right away when its
// own "Check now" button asks for it (see checkWantsManuscript below), for
// checking whether a tracker entry's quoted source text still exists where
// it's filed. chapterText() (used elsewhere for word counts) already
// handles a chapter whether or not it's the one currently rendered —
// cloning the live .chapter-body when it is, parsing the cached
// chapterHTML otherwise — so this just walks every chapter with it. No
// explicit Content-Type, so fetch defaults to text/plain and the request
// stays CORS-simple (no preflight) — same reasoning as every other
// NEO→tracker push, just a body instead of a query string since a whole
// manuscript won't fit in a URL.
async function sendManuscriptText() {
  if (!trackerReadyUrl || !book) return;
  const chapters = book.chapterOrder.map((chId) => ({
    number: chapterNumber(chId),
    text: chapterText(chId),
  }));
  for (const { number, text } of chapters) trackerSentText.set(number, text);
  const list = trackerDarlings();
  trackerSentDarlings = JSON.stringify(list);
  await fetch(trackerReadyUrl + '__neo-manuscript-text', {
    method: 'POST',
    body: JSON.stringify({ chapters, darlings: list }),
  }).catch(() => {});
}
setInterval(() => { sendManuscriptText(); }, 600000); // 10 minutes

/* ================================================================== */
/*  tracker -> NEO                                                      */
/* ================================================================== */

// The reverse of sendManuscriptText: a pending "send it now" request from
// the tracker's own "Check now" button, polled the same 1s cadence as
// checkTrackerGoto just below (same reasoning — cheap enough to just
// always be running).
async function checkWantsManuscript() {
  if (!trackerReadyUrl) return;
  let body;
  try { body = await (await fetch(trackerReadyUrl + '__request-manuscript-text')).json(); } catch { return; }
  if (body && body.wants) sendManuscriptText();
}

// Jumping to a log entry's spot in the manuscript: the reverse of the
// pushes above — a log row's jump icon writes a pending request on the
// tracker's dev server instead, for NEO to pick up. A no-op whenever the
// pane hasn't been opened yet this session (trackerReadyUrl unset) or
// there's nothing pending — cheap enough to just always be running, like
// the dev server probe.
setInterval(() => { checkTrackerGoto(); checkWantsManuscript(); }, 1000);

// Whether the tracker page has a dialog open (it posts a heartbeat while
// one is up). While it does, the drawer is held open: neither the cursor
// leaving it nor a click in the manuscript closes it. Polled fast, and
// only while the pane is showing the tracker, so the hold is in place
// before the cursor can get from the dialog to the manuscript.
let trackerEditing = false;
async function checkTrackerEditing() {
  const pane = $('#side-pane');
  if (!trackerReadyUrl || pane.dataset.mode !== 'tracker' || !pane.classList.contains('open')) {
    trackerEditing = false;
    return;
  }
  try {
    const body = await (await fetch(trackerReadyUrl + '__tracker-editing')).json();
    trackerEditing = !!(body && body.editing);
  } catch { trackerEditing = false; }
}
setInterval(() => { checkTrackerEditing(); }, 250);

// Escape while a tracker dialog is up closes it, and the (unpinned) drawer with it,
// rather than sending the book back to the shelf (app.js's Escape): the
// keyboard is usually still out in the manuscript, where the dialog was
// opened from. Captured on window, ahead of app.js's handlers; NEO's own
// Escape takers (its dialogs, the palette, a pop-menu) still come first.
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.isComposing || e.keyCode === 229 || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
  const pane = $('#side-pane');
  if (!trackerEditing || pane.dataset.mode !== 'tracker' || !pane.classList.contains('open')) return;
  if (palette || document.querySelector('.modal-backdrop:not([hidden]), .pop-menu')) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  sendTrackerIntent('close', '');
  trackerEditing = false; // let go of the drawer now, not at the next poll
  if (pane.dataset.pinned !== '1') closeSidePane();
}, true);
async function checkTrackerGoto() {
  if (!trackerReadyUrl) return;
  let body;
  try { body = await (await fetch(trackerReadyUrl + '__tracker-goto')).json(); } catch { return; }
  const g = body && body.goto;
  if (!g || typeof g.chapter !== 'number') return;
  if (g.darling) jumpToTrackerDarling(g.darling, g.quote, g.occurrence);
  else jumpToTrackerGoto(g.chapter, g.quote, g.occurrence);
}

// The reverse of chapterNumber() (app.js): which chapter in the open book
// has this number, if any.
function chapterIdForNumber(n) {
  if (!book) return null;
  return book.chapterOrder.find((chId) => chapterNumber(chId) === n) || null;
}

// Guards the flash below against its own stale timeout: paging to a new
// reference before the previous one's 2.5s is up used to still fire that
// old delete on schedule, wiping out the brand-new highlight early (or
// instantly, if jumps come fast) — "sometimes it's there, sometimes it's
// not" depending purely on how quickly the next jump happened to land.
let trackerJumpHighlightTimer = null;

// Where a tracker quote sits in a chapter body, as a Range — or null when
// it can't be found (the text has changed since). Shared by the jump to a
// passage and the Refs highlighting, which passes the body's lowercased
// plain text in so a chapter with many references is read once.
function quoteRange(body, quote, occurrence, lowerText) {
  // tracker quotes are wrapped '…' — strip that pair back off before
  // searching, matching the convention its own note-writing side uses
  const clean = String(quote || '').replace(/^['"‘’“”]/, '').replace(/['"‘’“”]$/, '');
  if (!clean) return null;
  // same text-position machinery darlings use to relocate a cut by its
  // surrounding text (see bodyPlainText/textPosToRange in app.js), just
  // walked to find a literal match instead of restoring at a remembered
  // offset. Case-insensitive, matching findRanges' own convention (Find &
  // Replace) — a quote's case shouldn't be the reason it can't be found.
  const haystack = lowerText ?? bodyPlainText(body).toLowerCase();
  const needle = clean.toLowerCase();
  // Collect every match rather than stopping at the first — occurrence
  // picks which one (1 = the first, matching how most references don't
  // carry an occurrence at all and mean exactly that). Clamped to the
  // last match still found, not treated as "not found", if the text has
  // since changed and that many no longer exist.
  const matches = [];
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    matches.push(at);
  }
  if (matches.length === 0) return null;
  const idx = matches[Math.min((occurrence || 1) - 1, matches.length - 1)];
  const startR = textPosToRange(body, idx);
  const endR = textPosToRange(body, idx + clean.length);
  if (!startR || !endR) return null;
  const range = document.createRange();
  range.setStart(startR.startContainer, startR.startOffset);
  range.setEnd(endR.startContainer, endR.startOffset);
  return range;
}

function jumpToTrackerGoto(n, quote, occurrence) {
  const chId = chapterIdForNumber(n);
  if (!chId) { toast(t("Chapter not found in the open manuscript.")); return; }
  // Used to close the pane here so the manuscript wasn't hidden behind it —
  // but a jump now often comes bundled with a properties dialog opening in
  // that same pane (a tracker row's click does both at once), and closing
  // out from under that dialog was worse than whatever sliver of manuscript
  // the open pane covers. The pane already makes room for the page rather
  // than overlaying it, so there's nothing left to hide behind anyway.
  goToChapterTop(chId);
  if (!quote) return;
  const body = document.querySelector(`.chapter[data-id="${chId}"] .chapter-body`);
  if (!body) return;
  const range = quoteRange(body, quote, occurrence);
  if (!range) {
    toast(t("Landed on the chapter — couldn't pinpoint the exact passage."));
    return;
  }
  const scrollTo = range.startContainer.parentElement?.closest?.('p') || body;
  scrollTo.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
  // a brief "you are here" flash, not a sticky mark — same CSS Custom
  // Highlight API Find & Replace already uses, rather than the real
  // selection, so this doesn't steal focus/caret from goToChapterTop above
  if (window.Highlight && window.CSS && CSS.highlights) {
    clearTimeout(trackerJumpHighlightTimer);
    CSS.highlights.set('neo-tracker-jump', new Highlight(range));
    trackerJumpHighlightTimer = setTimeout(() => CSS.highlights.delete('neo-tracker-jump'), 2500);
  }
}

// A passage the tracker says is in a darling: the Darlings tab, the
// darling scrolled into view, the words flashed the same way.
function jumpToTrackerDarling(did, quote, occurrence) {
  switchTab('darlings');
  const el = document.querySelector(`#darlings-list .darling[data-did="${did}"]`);
  if (!el) { toast(t("That darling isn't here any more.")); return; }
  const body = el.querySelector('.darling-text');
  const range = quote && body ? quoteRange(body, quote, occurrence) : null;
  (range ? range.startContainer.parentElement?.closest?.('p') || el : el).scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
  if (range && window.Highlight && window.CSS && CSS.highlights) {
    clearTimeout(trackerJumpHighlightTimer);
    CSS.highlights.set('neo-tracker-jump', new Highlight(range));
    trackerJumpHighlightTimer = setTimeout(() => CSS.highlights.delete('neo-tracker-jump'), 2500);
  }
}

/* ================================================================== */
/*  Right-click / Ctrl+Shift+A: a new entry in the tracker               */
/* ================================================================== */

// Right-click a text selection in the manuscript → the tracker's New entry
// chooser: what kind of thing it is, then whose (nothing preselected, so
// it can't be clicked through), then the form prefilled with whatever was
// selected. The chooser lives in the tracker, which has the chapter's
// cast to hand — no menu or fetch here. This file loads after app.js, so this runs after the
// spellcheck-suggestions and macOS Look Up handlers (both already
// check/set e.defaultPrevented the same way) — it only acts when neither
// of those claimed the click.
function selectedManuscriptText(target) {
  const editor = target.closest && target.closest('.chapter-body');
  // Cut text in Darlings has no live .chapter-body — it's still manuscript
  const darlingText = !editor && target.closest && target.closest('#darlings-list .darling-text');
  if (!editor && !darlingText) return null;
  const sel = window.getSelection();
  return sel && sel.rangeCount && !sel.isCollapsed ? sel.toString().trim() : '';
}
// Where the selection sits: its chapter's number, and which occurrence of
// its text in that chapter (past the first), so the tracker files the new
// entry's reference at that passage rather than the first match. Read
// before the pane opens — opening it can move the focus.
function selectionPlace() {
  const info = selectionInfo();
  const chapter = info && info.body.closest('.chapter[data-id]');
  if (!chapter) return {};
  return { chapter: chapterNumber(chapter.dataset.id), occurrence: info.occurrence > 1 ? info.occurrence : null };
}
async function openNewEntry(text) {
  const place = text ? selectionPlace() : {};
  trackerFlowActive = true; // see its declaration above — keeps the pane open while the dialog comes up
  await openTrackerPane();
  if (!trackerReadyUrl) { toast(t("The tracker isn't available right now.")); trackerFlowActive = false; return; }
  await sendTrackerIntent('new', text, place);
  // keyboard into the drawer, so the chooser's number keys reach it
  // rather than typing digits into the manuscript
  if (trackerFrame) trackerFrame.focus();
}
document.addEventListener('contextmenu', (e) => {
  if (e.defaultPrevented) return;
  const text = selectedManuscriptText(e.target);
  if (!text) return;
  e.preventDefault();
  openNewEntry(text);
});
// Ctrl+Shift+A (⇧⌘A): the same dialog from the keyboard, with the
// manuscript selection as the name — or empty, with nothing selected.
// Free in upstream NEO (Ctrl+Shift+D is its Darlings cut), and a left-hand
// reach beside Ctrl+D (tag) and Alt+D (Refs).
document.addEventListener('keydown', (e) => {
  if (!(IS_MAC ? e.metaKey : e.ctrlKey) || !e.shiftKey || e.altKey || e.code !== 'KeyA') return;
  if ($('#tracker-refs-toggle').hidden) return; // not on the Manuscript tab
  e.preventDefault();
  const sel = window.getSelection();
  const anchor = sel && sel.rangeCount ? sel.anchorNode : null;
  const el = anchor && (anchor.nodeType === 1 ? anchor : anchor.parentElement);
  // null (selection outside the manuscript) and '' (none at all) both mean
  // an empty dialog
  openNewEntry((el && selectedManuscriptText(el)) || '');
});

/* ================================================================== */
/*  Paste: a stat block copied from the tracker lands as poetry         */
/* ================================================================== */

// The tracker's status-panel copy buttons (CopyButton.tsx) mark what they
// copy with a data-luckmode-block wrapper on the clipboard's HTML. Pasted
// into the manuscript, each line becomes a poetry paragraph — NEO's own
// set-apart paragraph, which Word, EPUB and PDF already keep distinct —
// rather than prose (and no dialogue-dash or Markdown rewriting of
// "HP - 15" style lines). Every other paste is left to NEO. Capture phase
// on document, so this runs before the chapter body's own paste handler.
const TRACKER_BLOCK_MARK = 'data-luckmode-block';
document.addEventListener('paste', (e) => {
  const body = e.target && e.target.closest ? e.target.closest('.chapter-body') : null;
  if (!body || isScript()) return;
  const data = e.clipboardData;
  if (!data || !(data.getData('text/html') || '').includes(TRACKER_BLOCK_MARK)) return;
  const lines = (data.getData('text/plain') || '').replace(/\r/g, '').split('\n')
    .map((l) => l.trimEnd()).filter((l) => l.trim());
  if (!lines.length) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  pasteStatBlock(body, lines);
}, true);

function pasteStatBlock(body, lines) {
  const chId = body.closest('.chapter').dataset.id;
  snapshotStructure('stat block paste'); // one ⌘Z takes the whole block back out
  const sel = window.getSelection();
  if (sel.rangeCount && !sel.isCollapsed) document.execCommand('delete'); // over a selection: replaces it
  const ps = lines.map((line) => {
    const p = document.createElement('p');
    p.className = 'poetry';
    p.textContent = line;
    italicize(p); // poetry is born italic, as NEO makes it
    return p;
  });
  const block = caretBlock(body);
  if (!block) body.append(...ps);
  else if (block.classList.contains('ghost') || block.textContent.trim() === '') block.replaceWith(...ps);
  else if (block.classList.contains('scene-break')) block.after(...ps);
  else {
    // where the caret is in its paragraph: at the start, the end, or mid-way (split it)
    const r = sel.getRangeAt(0);
    const head = document.createRange();
    head.selectNodeContents(block);
    head.setEnd(r.startContainer, r.startOffset);
    const at = head.toString().length;
    if (at === 0) block.before(...ps);
    else if (at >= block.textContent.length) block.after(...ps);
    else {
      const tail = document.createRange();
      tail.selectNodeContents(block);
      tail.setStart(r.startContainer, r.startOffset);
      const rest = document.createElement('p');
      rest.className = block.className;
      rest.appendChild(tail.extractContents());
      block.after(...ps, rest);
    }
  }
  // caret after the block's last line, ready to carry on writing
  const end = document.createRange();
  end.selectNodeContents(ps[ps.length - 1]);
  end.collapse(false);
  sel.removeAllRanges();
  sel.addRange(end);
  syncChapter(body, chId);
  resetNativeUndo();
  breakRun++;
}

/* ================================================================== */
/*  Ctrl+D: attach a reference without leaving the manuscript          */
/* ================================================================== */

// Select a passage, Ctrl+D, type part of a name, Enter: the selection is
// filed as a reference on that entity and the cursor is back where it
// was. All inside NEO's own window — the tracker's dev server answers the
// search and takes the write (both replies CORS-readable), so nothing
// waits on a poll or a pane. Prefilled with the selection, since the
// selected words are often the name itself. With nothing selected, or
// Shift+Enter, the hit opens in the tracker pane instead. Ctrl+D is free
// in upstream NEO (Ctrl+Shift+D is theirs) and an easy left-hand reach.
let palette = null; // { el, input, list, saved, hits, active, seq } while open

function closePalette(restore) {
  if (!palette) return;
  const { el, saved } = palette;
  palette = null;
  el.remove();
  if (restore && saved && document.contains(saved.body)) {
    saved.body.focus({ preventScroll: true });
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(saved.range);
  }
}

function renderPalette() {
  if (!palette) return;
  const { list, hits, active, note } = palette;
  list.innerHTML = '';
  if (note) {
    const li = document.createElement('li');
    li.className = 'tp-note';
    li.textContent = note;
    list.appendChild(li);
    return;
  }
  hits.forEach((hit, i) => {
    const li = document.createElement('li');
    if (i === active) li.classList.add('active');
    const name = document.createElement('span');
    name.className = 'tp-name';
    name.textContent = hit.name;
    const kind = document.createElement('span');
    kind.className = 'tp-kind';
    kind.textContent = hit.label + (hit.via ? ' · ' + hit.via : '');
    li.append(name, kind);
    li.addEventListener('mousedown', (e) => e.preventDefault()); // keep the input focused
    li.addEventListener('click', (e) => { palette.active = i; choosePaletteHit(e.shiftKey); });
    list.appendChild(li);
  });
}

async function searchPalette() {
  if (!palette || !trackerReadyUrl) return;
  const q = palette.input.value.trim();
  const seq = ++palette.seq;
  if (q.length < 2) { palette.hits = []; palette.note = null; renderPalette(); return; }
  let hits = [];
  try {
    const reply = await (await fetch(trackerReadyUrl + '__search?q=' + encodeURIComponent(q) + '&limit=8')).json();
    hits = Array.isArray(reply.hits) ? reply.hits : [];
  } catch { hits = []; }
  if (!palette || seq !== palette.seq) return; // closed, or typed past
  palette.hits = hits;
  palette.active = 0;
  palette.note = hits.length ? null : t('No matches');
  renderPalette();
}

async function choosePaletteHit(open) {
  if (!palette) return;
  const hit = palette.hits[palette.active];
  if (!hit) return;
  const { saved } = palette;
  if (open || !saved) {
    closePalette(true);
    trackerFlowActive = true;
    await openTrackerPane();
    if (trackerReadyUrl) await sendTrackerIntent('open', hit.kind + ':' + hit.id);
    return;
  }
  // The chapter the selection sits in, not whichever one the caret was
  // last reported from — they can differ with two chapters on screen.
  const chId = saved.body.closest('.chapter')?.dataset.id || currentChapterId;
  const body = { target: hit.kind, id: hit.id, chapter: chapterNumber(chId), quote: saved.text };
  if (saved.occurrence && saved.occurrence > 1) body.occurrence = saved.occurrence;
  let reply;
  try {
    // No Content-Type on purpose: a text/plain body needs no preflight,
    // and the route parses it as JSON regardless.
    reply = await (await fetch(trackerReadyUrl + '__quick-reference', { method: 'POST', body: JSON.stringify(body) })).json();
  } catch { reply = { error: t('no reply from the tracker') }; }
  if (!palette) return;
  if (!reply || reply.error) { toast(t('Reference not added: ') + (reply && reply.error ? reply.error : '')); return; }
  closePalette(true);
  toast(t('Reference added to ') + (reply.name || hit.name));
}

async function openReferencePalette() {
  if (palette) { palette.input.focus(); return; }
  const saved = selectionInfo();
  const el = document.createElement('div');
  el.id = 'tracker-palette';
  const input = document.createElement('input');
  input.type = 'text';
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.placeholder = t(saved ? 'Attach the selection to…' : 'Open in the tracker…');
  const list = document.createElement('ul');
  el.append(input, list);
  document.body.appendChild(el);
  palette = { el, input, list, saved, hits: [], active: 0, seq: 0, note: null };
  input.value = saved ? saved.text : '';
  input.focus();
  input.select();
  input.addEventListener('input', () => { searchPalette(); });
  input.addEventListener('keydown', (e) => {
    if (!palette) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (palette.hits.length) { palette.active = Math.min(palette.active + 1, palette.hits.length - 1); renderPalette(); }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (palette.hits.length) { palette.active = Math.max(palette.active - 1, 0); renderPalette(); }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choosePaletteHit(e.shiftKey);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closePalette(true);
    }
  });
  if (!trackerReadyUrl) {
    palette.note = t('Starting the tracker…');
    renderPalette();
    await ensureTrackerPane(); // starts or finds the dev server; the pane stays closed
    if (!palette) return; // closed meanwhile
    if (!trackerReadyUrl) { closePalette(true); toast(t("The tracker isn't available right now.")); return; }
  }
  searchPalette();
}

document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented) return;
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'd') return;
  e.preventDefault();
  openReferencePalette();
});
// a click anywhere else, or the window losing focus, dismisses it — the
// selection is left wherever that click put it
document.addEventListener('mousedown', (e) => {
  if (palette && !palette.el.contains(e.target)) closePalette(false);
}, true);
window.addEventListener('blur', () => closePalette(false));

/* ================================================================== */
/*  Refs: every referenced passage, tinted (Alt+D or the ◎ Refs button) */
/* ================================================================== */

// Every reference the tracker stores, painted into the chapters on screen
// as one CSS highlight — and, with the extra layer on, every other passage
// a chapter event is pinned to (an HP change, an item gained) as a second
// highlight in its own colour — with a small label on hover naming whatever the
// passage is a reference on — so a passage that's already referenced is
// obvious before Ctrl+D. The highlight can't carry a tooltip of its own,
// so the painted ranges are kept here and hit-tested against the cursor.
let trackerRefsOn = false;
let trackerRefsExtra = false; // the event passages too
let trackerRefsPainted = []; // [{ range, extra, entities: [{ kind, id, name, label }] }]
let trackerRefsVersion = null;
let trackerRefsReply = null; // the last /__references reply
// Per chapter, the body painted, its references as sent, and what was
// found: a chapter is only searched again when one of those changed, or
// it's the one being typed in. The ranges are live and follow edits.
let trackerRefsChapters = new Map(); // chapter id -> { body, key, entries }
let trackerRefsPaintTimer = null;
let trackerRefsPainting = null; // the paint under way, and the one asked for meanwhile
let trackerRefsQueued = null;
const TRACKER_REFS = 'neo-tracker-refs';
const TRACKER_REFS_EXTRA = 'neo-tracker-refs-extra';

function clearTrackerRefs() {
  trackerRefsPainted = [];
  trackerRefsChapters = new Map();
  trackerRefsReply = null;
  if (window.CSS && CSS.highlights) { CSS.highlights.delete(TRACKER_REFS); CSS.highlights.delete(TRACKER_REFS_EXTRA); }
  hideTrackerRefTip();
}

// Every referenced passage in one chapter body; references sharing a
// passage are one entry naming them all, extra only if all of them are.
function findTrackerRefs(body, refs) {
  const byPassage = new Map();
  const lower = bodyPlainText(body).toLowerCase();
  for (const ref of refs) {
    const range = quoteRange(body, ref.quote, ref.occurrence, lower);
    if (!range) continue;
    const at = rangeToTextPos(body, range.startContainer, range.startOffset) + ':' + range.toString().length;
    const entry = byPassage.get(at) || { range, extra: true, entities: [] };
    if (!ref.extra) entry.extra = false;
    if (!entry.entities.some((x) => x.kind === ref.kind && x.id === ref.id)) {
      entry.entities.push({ kind: ref.kind, id: ref.id, name: ref.name, label: ref.label });
    }
    byPassage.set(at, entry);
  }
  return [...byPassage.values()];
}

// The chapter the caret is in — the one whose text can have moved.
function caretChapterId() {
  const sel = getSelection();
  const node = (sel && sel.anchorNode) || document.activeElement;
  const el = node && (node.nodeType === 1 ? node : node.parentElement);
  const chapter = el && el.closest && el.closest('.chapter[data-id]');
  return chapter ? chapter.dataset.id : null;
}

// `reason` is 'version' (the tracker wrote: fetch the references again,
// search the chapters whose references changed) or 'settle' (typing
// paused: search the chapter with the caret, no fetch). One paint at a
// time; a request made during one runs after it, a 'version' outranking
// a 'settle'.
function paintTrackerRefs(reason) {
  if (!trackerRefsOn || !trackerReadyUrl || !(window.Highlight && window.CSS && CSS.highlights)) { clearTrackerRefs(); return; }
  if (trackerRefsPainting) { trackerRefsQueued = reason === 'version' ? 'version' : (trackerRefsQueued || 'settle'); return trackerRefsPainting; }
  trackerRefsPainting = (async () => {
    if (reason === 'version' || !trackerRefsReply) {
      let reply;
      try { reply = await (await fetch(trackerReadyUrl + '__references')).json(); } catch { return; }
      if (!trackerRefsOn || !reply || !reply.byChapter) return;
      trackerRefsReply = reply;
      trackerRefsVersion = reply.version;
    }
    const retyped = reason === 'settle' ? caretChapterId() : null;
    const next = new Map();
    const paint = (id, body, refs) => {
      if (!body || !refs.length) return;
      const key = JSON.stringify(refs);
      const had = trackerRefsChapters.get(id);
      const kept = had && had.body === body && had.key === key && id !== retyped;
      next.set(id, kept ? had : { body, key, entries: findTrackerRefs(body, refs) });
    };
    for (const chapter of document.querySelectorAll('.chapter[data-id]')) {
      const id = chapter.dataset.id;
      paint(id, chapter.querySelector('.chapter-body'), (trackerRefsReply.byChapter[chapterNumber(id)] || []).filter((r) => trackerRefsExtra || !r.extra));
    }
    // passages cut into darlings, tinted on the Darlings tab
    for (const el of document.querySelectorAll('#darlings-list .darling[data-did]')) {
      const did = el.dataset.did;
      paint('darling:' + did, el.querySelector('.darling-text'), ((trackerRefsReply.byDarling || {})[did] || []).filter((r) => trackerRefsExtra || !r.extra));
    }
    trackerRefsChapters = next;
    trackerRefsPainted = [...next.values()].flatMap((c) => c.entries);
    const tint = (extra) => new Highlight(...trackerRefsPainted.filter((p) => p.extra === extra).map((p) => p.range));
    CSS.highlights.set(TRACKER_REFS, tint(false));
    CSS.highlights.set(TRACKER_REFS_EXTRA, tint(true));
  })().finally(() => {
    trackerRefsPainting = null;
    const queued = trackerRefsQueued;
    trackerRefsQueued = null;
    if (queued) paintTrackerRefs(queued);
  });
  return trackerRefsPainting;
}

// Repaint once typing or scrolling settles — the text has moved under the
// ranges of the chapter being written in.
function schedulePaintTrackerRefs() {
  if (!trackerRefsOn) return;
  clearTimeout(trackerRefsPaintTimer);
  trackerRefsPaintTimer = setTimeout(() => paintTrackerRefs('settle'), 800);
}

// The tracker's write counter, watched by a long-poll: /__version holds
// its reply until the counter moves (or 20 s pass), so a reference added
// from the drawer or the palette is tinted the moment it's saved. One
// watcher at a time, stopped with Refs. A round that comes straight back
// (an older server or a stub answering at once, a failed fetch) waits a
// moment before the next, so this can't spin.
let trackerRefsWatch = null;
async function watchTrackerRefs() {
  if (trackerRefsWatch) return;
  const watch = trackerRefsWatch = new AbortController();
  for (;;) {
    if (watch.signal.aborted || !trackerRefsOn) break;
    const started = Date.now();
    let version;
    if (trackerReadyUrl) {
      try {
        const after = trackerRefsVersion === null ? '' : '&after=' + encodeURIComponent(trackerRefsVersion);
        version = (await (await fetch(trackerReadyUrl + '__version?wait=20000' + after, { signal: watch.signal })).json()).version;
      } catch { /* asked again below */ }
    }
    if (watch.signal.aborted) break;
    if (version !== undefined && version !== trackerRefsVersion) await paintTrackerRefs('version');
    if (Date.now() - started < 250) await new Promise((resolve) => setTimeout(resolve, version === undefined ? 1000 : 250));
  }
  if (trackerRefsWatch === watch) trackerRefsWatch = null;
}

// `extra` the event passages too; left out, it stays as it was.
async function setTrackerRefs(on, extra = trackerRefsExtra) {
  const repaint = trackerRefsOn && on && extra !== trackerRefsExtra;
  trackerRefsOn = on;
  trackerRefsExtra = extra;
  const button = $('#tracker-refs-toggle');
  button.classList.toggle('active', on);
  button.setAttribute('aria-pressed', on ? 'true' : 'false');
  button.querySelector('span').textContent = on && extra ? t('◎ Refs+') : t('◎ Refs');
  try {
    localStorage.setItem('neo-tracker-refs', on ? '1' : '0');
    localStorage.setItem('neo-tracker-refs-extra', extra ? '1' : '0');
  } catch { /* not remembered */ }
  if (repaint) { paintTrackerRefs('settle'); return; } // the filter changed the chapters' keys
  if (!on) {
    if (trackerRefsWatch) { trackerRefsWatch.abort(); trackerRefsWatch = null; }
    clearTrackerRefs();
    return;
  }
  if (!trackerReadyUrl) await ensureTrackerPane(); // starts or finds the dev server; the pane stays closed
  if (!trackerReadyUrl) { toast(t("The tracker isn't available right now.")); return; }
  paintTrackerRefs('version');
  watchTrackerRefs();
}

// Shift (with the click or Alt+D) switches the extra layer, turning Refs on
// with it if they're off; plain, Refs on or off, the layer as last chosen.
const toggleTrackerRefs = (shift) =>
  shift ? setTrackerRefs(true, !(trackerRefsOn && trackerRefsExtra)) : setTrackerRefs(!trackerRefsOn);
$('#tracker-refs-toggle').onclick = (e) => toggleTrackerRefs(e.shiftKey);
document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented) return;
  // e.code, not e.key: ⌥D types a character on a Mac
  if (!e.altKey || e.ctrlKey || e.metaKey || e.code !== 'KeyD') return;
  e.preventDefault();
  toggleTrackerRefs(e.shiftKey);
});
try {
  if (localStorage.getItem('neo-tracker-refs') === '1') setTrackerRefs(true, localStorage.getItem('neo-tracker-refs-extra') === '1');
} catch { /* nothing kept */ }

// The hover label.
let trackerRefTip = null;
let trackerRefTipFrame = 0;
function hideTrackerRefTip() {
  if (trackerRefTip) trackerRefTip.hidden = true;
}
const entityLine = (x) => x.name + ' (' + x.label + ')';
function showTrackerRefTip(entities, x, y) {
  if (!trackerRefTip) {
    trackerRefTip = document.createElement('div');
    trackerRefTip.id = 'tracker-refs-tip';
    document.body.appendChild(trackerRefTip);
  }
  trackerRefTip.textContent = '';
  for (const entity of entities) {
    const line = document.createElement('div');
    line.textContent = entityLine(entity);
    trackerRefTip.appendChild(line);
  }
  const hint = document.createElement('div');
  hint.className = 'tr-hint';
  hint.textContent = t(IS_MAC ? '⌘-click to open' : 'Ctrl+click to open');
  trackerRefTip.appendChild(hint);
  trackerRefTip.hidden = false;
  // beside the cursor, kept inside the window
  const w = trackerRefTip.offsetWidth, h = trackerRefTip.offsetHeight;
  trackerRefTip.style.left = Math.min(x + 14, window.innerWidth - w - 8) + 'px';
  trackerRefTip.style.top = (y + 18 + h > window.innerHeight ? y - h - 10 : y + 18) + 'px';
}
function caretAt(x, y) {
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    return p ? { node: p.offsetNode, offset: p.offset } : null;
  }
  const r = document.caretRangeFromPoint && document.caretRangeFromPoint(x, y);
  return r ? { node: r.startContainer, offset: r.startOffset } : null;
}
// The entities referencing whatever passage is under a point, deduplicated —
// shared by the hover label and the Ctrl+click.
function trackerRefsAt(x, y, target) {
  if (!trackerRefsOn || !trackerRefsPainted.length) return [];
  if (!target || !target.closest || !(target.closest('.chapter-body') || target.closest('#darlings-list .darling-text'))) return [];
  const caret = caretAt(x, y);
  if (!caret) return [];
  const found = [];
  for (const { range, entities } of trackerRefsPainted) {
    let hit = false;
    try { hit = range.isPointInRange(caret.node, caret.offset); } catch { hit = false; }
    // the caret can sit just past the last character; count the passage's own end as outside
    if (!hit || (caret.node === range.endContainer && caret.offset === range.endOffset)) continue;
    for (const entity of entities) {
      if (!found.some((f) => f.kind === entity.kind && f.id === entity.id)) found.push(entity);
    }
  }
  return found;
}

document.addEventListener('mousemove', (e) => {
  if (!trackerRefsOn || !trackerRefsPainted.length) return;
  const { clientX: x, clientY: y, target } = e;
  cancelAnimationFrame(trackerRefTipFrame);
  trackerRefTipFrame = requestAnimationFrame(() => {
    const entities = trackerRefsAt(x, y, target);
    if (entities.length) showTrackerRefTip(entities, x, y);
    else hideTrackerRefTip();
  });
});

// Ctrl+click (⌘-click on a Mac, where Ctrl+click is a right-click) on a
// tinted passage: its entity's property window in the tracker drawer — a
// menu first when more than one thing references the passage. Caught on
// mousedown, before NEO moves the caret, so the selection stays put.
async function openTrackerEntity(entity) {
  trackerFlowActive = true; // keep the pane open until the cursor gets there
  await openTrackerPane();
  if (trackerReadyUrl) await sendTrackerIntent('open', entity.kind + ':' + entity.id);
}
document.addEventListener('mousedown', async (e) => {
  if (e.button !== 0 || !(IS_MAC ? e.metaKey : e.ctrlKey) || e.altKey || e.shiftKey) return;
  const entities = trackerRefsAt(e.clientX, e.clientY, e.target);
  if (!entities.length) return;
  e.preventDefault();
  e.stopPropagation();
  hideTrackerRefTip();
  if (entities.length === 1) { openTrackerEntity(entities[0]); return; }
  const choice = await popMenu(e.clientX, e.clientY,
    entities.map((x, i) => ({ label: entityLine(x), value: String(i) })),
    { title: t('Open in the tracker') });
  if (choice !== null && choice !== undefined && entities[Number(choice)]) openTrackerEntity(entities[Number(choice)]);
}, true);
document.addEventListener('scroll', hideTrackerRefTip, true);
document.addEventListener('keydown', hideTrackerRefTip, true);

/* ================================================================== */
/*  The hooks app.js calls                                              */
/* ================================================================== */

// Each is a one-liner in app.js of the form `window.neoHooks?.name?.(...)`,
// so app.js runs unchanged (and Pocket, which never loads this file, sees
// no-ops). The list in README.md is the one to re-apply after a merge.
window.neoHooks = {
  // createChapterAt(): a chapter was just made interactively
  chapterCreated: notifyTrackerOfNewChapter,
  // focusSticky(): the pane was just opened to show a sticky — put it in
  // stickies mode (it may have been showing the tracker)
  stickyFocused: openSidePane,
  // wireHoverPane() / closeUnpinnedPanes(): should this pane stay open
  // although the usual close gesture happened? The hover gesture never
  // closes the side pane any more: in tracker mode a mouseleave is spurious
  // (crossing onto the iframe fires one in Chromium — the mousemove
  // listener above closes it for real instead), and in stickies mode the
  // pane belongs to its button, not the edge. Losing the window (blur) or
  // the cursor leaving it still closes Stickies, but not the tracker.
  paneLocked: (pane, why) => pane.id === 'side-pane' && (why === 'hover' || pane.dataset.mode === 'tracker'),
  // sidePaneForTab(): a tab was shown. Stickies (sticky notes) only live in
  // the pane on Manuscript — elsewhere the pane is someone else's (Notes'
  // chapter notes, Outline's loose cards, Darlings' snapshots), so the
  // button promising sticky notes there would just show the wrong thing
  // and look like a duplicate of that tab; and an unpinned pane left open
  // from Manuscript closes on the way out.
  tabShown: (name) => {
    const onManuscript = name === 'manuscript';
    $('#side-pane-toggle').hidden = !onManuscript;
    $('#tracker-refs-toggle').hidden = !onManuscript;
    // The tracker starts with the book, not with the first look at the
    // drawer: it follows the text as it's edited (every typing pause sends
    // the chapter), so edits made before it was up would be a gap. The
    // pane itself stays closed.
    if (onManuscript && !trackerReadyUrl && !NO_HOVER) ensureTrackerPane();
    const pane = $('#side-pane');
    if (!onManuscript && !$('#editor-view').classList.contains('darlings-tab') && pane.dataset.pinned !== '1') closeSidePane();
  },
  // renderDarlings(): one darling's element was just built — mark its text
  // so a right-click in it counts as manuscript for the New entry gesture
  darlingRendered: (el, content, d) => { el.dataset.did = d.id; content.classList.add('darling-text'); sendCurrentChapterSoon(); schedulePaintTrackerRefs(); },
  // updateCounters(): the word counts were refreshed — both notifiers
  // debounce themselves, so this is cheap to call every time
  countersUpdated: () => { notifyTrackerOfChapter(); notifyTrackerOfWordCount(); schedulePaintTrackerRefs(); sendCurrentChapterSoon(); },
};
