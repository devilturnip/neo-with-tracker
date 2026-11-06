// litrpg-tracker — the main-process half of the fork. A separate project
// (litrpg-tracker) with its own Vite server, embedded as an iframe in the
// renderer's right-edge pane (tracker-bridge.js). This just gets a running
// server and hands back its URL over IPC — Linux only for now (no
// shell:true/npm.cmd handling for Windows, no macOS-specific kill strategy).
//
// What it starts is the tracker's own build for NEO (`vite build --mode
// neo`, served by `vite preview` with the same routes): production React,
// several times quicker to redraw than the dev server's. It is rebuilt
// first whenever what the build bakes in changed since (BUILD_INPUTS),
// which takes about a second; if the build fails, the dev server runs
// instead, so the tracker always comes up.
//
// While NEO runs, a new commit of the tracker's code is picked up too
// (watchForUpdates): built beside the running server, then swapped in when
// the page says it's a quiet moment (tracker-bridge.js) — so a tracker fix
// arrives without quitting NEO. A commit, not a save: the tracker's folder
// is also where its code is worked on, and half-done work stays out of
// the pane. Only code counts; a data commit changes nothing here.
//
// Required by one line in main.js, which hands over its own Electron objects
// (main.js's tests run it under plain Node with a stand-in `electron`, so
// this must not require('electron') itself):
//   require('./tracker-main.js')({ app, ipcMain, logError })

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

// Both overridable for a test run against a copy, on a port of its own.
const TRACKER_DIR = process.env.NEO_TRACKER_DIR || path.join(os.homedir(), 'Projects', 'litrpg-tracker');
const TRACKER_PORT = Number(process.env.NEO_TRACKER_PORT) || 5173;
let trackerChild = null; // only set when WE spawned it — never kill a server we just found running
let trackerChildPort = null; // the port it said it's on
let trackerReadyPromise = null;
let builtFrom = null; // the code commit the running server was started from

const BUILD_DIR = 'dist-neo';
// What the build bakes in, besides the record it reads live: its code and
// the files it imports at build time. Folders count their own timestamp
// too, so a file renamed or deleted in one (a check switched on by renaming
// it) is a change.
const BUILD_INPUTS = [
  'src', 'public', 'reference', path.join('data', 'checks'),
  'index.html', 'vite.config.ts', 'package.json', 'package-lock.json',
  'tsconfig.json', 'tsconfig.app.json',
];

// What the running server is made of, for spotting a code commit: what the
// build bakes in, and the server's own code (its routes run from these).
// Of data/checks only the stat-block check counts — the build imports it;
// the dismissed warnings are read live, and the author changes them.
const CODE_PATHS = [
  ...BUILD_INPUTS.filter((p) => p !== path.join('data', 'checks')),
  'data/checks/console-stat-blocks*', 'server', 'vite-plugin-editor.ts', 'tsconfig.node.json',
];

function git(dir, args) {
  try {
    return require('child_process').execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000 }).trim();
  } catch { return null; }
}
// The last commit that touched the tracker's code, or null outside a git checkout.
const codeCommit = (dir = TRACKER_DIR) => git(dir, ['log', '-1', '--format=%H', '--', ...CODE_PATHS]) || null;
// Whether the tracker's code on disk is all committed.
const codeIsClean = (dir = TRACKER_DIR) => git(dir, ['status', '--porcelain', '--', ...CODE_PATHS]) === '';

function newestChange(p) {
  let st;
  try { st = fs.statSync(p); } catch { return 0; }
  if (!st.isDirectory()) return st.mtimeMs;
  let newest = st.mtimeMs;
  for (const name of fs.readdirSync(p)) newest = Math.max(newest, newestChange(path.join(p, name)));
  return newest;
}

function buildIsStale() {
  let builtAt;
  try { builtAt = fs.statSync(path.join(TRACKER_DIR, BUILD_DIR, 'index.html')).mtimeMs; } catch { return true; }
  return BUILD_INPUTS.some((rel) => newestChange(path.join(TRACKER_DIR, rel)) > builtAt);
}

// `vite build --mode neo` into BUILD_DIR (or `outDir`); resolves whether it
// worked. A build that hangs is killed after a minute (it takes about a second).
function buildForNeo(vite, logError, outDir = BUILD_DIR) {
  return new Promise((resolve) => {
    let child;
    try {
      child = require('child_process').spawn(vite, ['build', '--mode', 'neo', '--outDir', outDir, '--emptyOutDir'],
        { cwd: TRACKER_DIR, stdio: 'ignore' });
    } catch (err) { logError('tracker build', err); resolve(false); return; }
    const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } }, 60000);
    child.on('error', (err) => { clearTimeout(timer); logError('tracker build', err); resolve(false); });
    child.on('exit', (code) => { clearTimeout(timer); resolve(code === 0); });
  });
}

async function trackerPing(port) {
  try {
    const res = await fetch('http://localhost:' + port + '/__dataset', { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch { return false; }
}

// Polls until /__dataset answers on the given port, or gives up after ~20s
function trackerWaitUntilReady(port) {
  return new Promise((resolve) => {
    const deadline = Date.now() + 20000;
    const tick = async () => {
      if (await trackerPing(port)) { resolve(true); return; }
      if (Date.now() > deadline) { resolve(false); return; }
      setTimeout(tick, 300);
    };
    tick();
  });
}

function ensureTrackerRunning(logError) {
  if (trackerReadyPromise) return trackerReadyPromise;
  trackerReadyPromise = (async () => {
    if (!fs.existsSync(TRACKER_DIR)) return { ok: false, reason: 'missing-repo' };
    // already running (Spencer's own terminal, or a previous NEO session) — use it, don't spawn a second one
    if (await trackerPing(TRACKER_PORT)) return { ok: true, url: 'http://localhost:' + TRACKER_PORT };
    // one we spawned that's still starting (a slow disk outran the last
    // wait): wait on it again rather than spawn a second on the next port
    if (trackerChild && trackerChild.exitCode === null && trackerChildPort) {
      return (await trackerWaitUntilReady(trackerChildPort))
        ? { ok: true, url: 'http://localhost:' + trackerChildPort } : { ok: false, reason: 'timeout' };
    }
    const vite = path.join(TRACKER_DIR, 'node_modules', '.bin', 'vite');
    if (!fs.existsSync(vite)) return { ok: false, reason: 'not-installed' }; // the repo is there, npm install hasn't been run
    try {
      // The build for NEO, rebuilt first when stale; the dev server if that fails.
      builtFrom = codeCommit();
      const built = !buildIsStale() || await buildForNeo(vite, logError);
      const args = built ? ['preview', '--mode', 'neo', '--outDir', BUILD_DIR, '--port', String(TRACKER_PORT)] : ['--port', String(TRACKER_PORT)];
      // vite's own binary, not `npm run dev`: npm doesn't reliably pass a kill on to
      // the script it runs, which left vite itself running after NEO quit
      const child = require('child_process').spawn(vite, args, { cwd: TRACKER_DIR, stdio: ['ignore', 'pipe', 'ignore'] });
      trackerChild = child;
      // a spawn that fails is an 'error' event, not a throw: without a
      // listener it's an uncaught exception in the main process
      child.on('error', (err) => { logError('tracker', err); if (trackerChild === child) trackerChild = null; });
      // any exit invalidates the cache, so the next call starts fresh instead of reusing a dead promise
      child.on('exit', () => { if (trackerChild === child) trackerChild = null; trackerReadyPromise = null; });
      // Vite's own startup line (dev and preview alike) looks like "  ➜  Local:   http://localhost:5173/" — read the real
      // port back rather than assuming 5173, in case something else already held it
      const port = await new Promise((resolve) => {
        let done = false;
        const settle = (p) => { if (!done) { done = true; resolve(p); } };
        child.stdout.on('data', (buf) => {
          const m = /http:\/\/localhost:(\d+)/.exec(buf.toString());
          if (m) settle(Number(m[1]));
        });
        child.once('exit', () => settle(null));
        child.once('error', () => settle(null));
        setTimeout(() => settle(null), 5000); // Vite usually prints within ~1s
      });
      const actualPort = port || TRACKER_PORT; // fall back to the default if we never caught the startup line
      if (trackerChild === child) trackerChildPort = actualPort;
      const ready = await trackerWaitUntilReady(actualPort);
      if (!ready) return { ok: false, reason: 'timeout' };
      return { ok: true, url: 'http://localhost:' + actualPort };
    } catch (err) {
      logError('tracker', err);
      trackerReadyPromise = null;
      return { ok: false, reason: 'spawn-failed' };
    }
  })().then((result) => {
    // a failure isn't kept for the session: the next hover tries again — a server slow to
    // start may be up by then, and a spawn that ran out its 20 s is still coming up and
    // is found by the ping rather than spawned twice
    if (!result.ok) trackerReadyPromise = null;
    return result;
  });
  return trackerReadyPromise;
}

// ---------------------------------------------------------------- updates

const NEXT_DIR = 'dist-neo-next';
let renderer = null;    // the page that asked for the tracker: told when an update is ready
let ready = null;       // the code commit built into NEXT_DIR, waiting to be swapped in
let building = null;    // a build under way
let told = null;        // the last commit the page was told about (once each, built or not)
let watching = [];      // files fs.watchFile is polling
let settleTimer = null;

function tell(msg) {
  if (renderer && !renderer.isDestroyed()) renderer.send('menu', { type: 'trackerUpdate', ...msg });
}

// A commit landed (or the branch moved): if it moved the code, and the code
// is all committed, build it beside the running server and tell the page.
async function checkForUpdate(logError, dir = TRACKER_DIR) {
  if (!trackerChild || building) return;
  const commit = codeCommit(dir);
  if (!commit || commit === builtFrom || commit === ready || commit === told) return;
  if (!codeIsClean(dir)) return; // the next commit brings the rest
  const vite = path.join(dir, 'node_modules', '.bin', 'vite');
  building = buildForNeo(vite, logError, NEXT_DIR);
  const ok = await building;
  building = null;
  if (codeCommit(dir) !== commit) { checkForUpdate(logError, dir); return; } // moved on meanwhile
  told = commit;
  if (ok) { ready = commit; tell({}); } else tell({ failed: true });
}

function watchForUpdates(logError, dir = TRACKER_DIR) {
  stopWatching();
  const gitDir = path.join(dir, '.git');
  if (!fs.existsSync(gitDir)) return;
  const head = path.join(gitDir, 'HEAD');
  const branch = (() => { try { return /^ref: (.+)$/m.exec(fs.readFileSync(head, 'utf8'))?.[1]; } catch { return undefined; } })();
  const files = [head, path.join(gitDir, 'packed-refs'), ...(branch ? [path.join(gitDir, branch)] : [])];
  const changed = () => {
    clearTimeout(settleTimer);
    // a commit writes several files: look once they've all landed; the branch may have changed too
    settleTimer = setTimeout(() => { watchForUpdates(logError, dir); checkForUpdate(logError, dir); }, 2000);
  };
  for (const f of files) { fs.watchFile(f, { interval: 2000 }, changed); watching.push(f); }
}

function stopWatching() {
  for (const f of watching) fs.unwatchFile(f);
  watching = [];
  clearTimeout(settleTimer);
}

// The built update swapped in for the running build, the old kept until
// the new one is in place (put back if the rename fails).
function swapIn(dir = TRACKER_DIR) {
  const live = path.join(dir, BUILD_DIR);
  const next = path.join(dir, NEXT_DIR);
  const old = path.join(dir, 'dist-neo-old');
  fs.rmSync(old, { recursive: true, force: true });
  const hadLive = fs.existsSync(live);
  if (hadLive) fs.renameSync(live, old);
  try { fs.renameSync(next, live); } catch (err) { if (hadLive) fs.renameSync(old, live); throw err; }
  fs.rmSync(old, { recursive: true, force: true });
}

// The page's go-ahead: the new build in, the server restarted on it.
async function restartTracker(logError) {
  if (!ready || !trackerChild) return ensureTrackerRunning(logError);
  try { swapIn(); } catch (err) { logError('tracker update', err); return { ok: false, reason: 'swap-failed' }; }
  ready = null;
  const child = trackerChild;
  await new Promise((resolve) => {
    if (child.exitCode !== null) { resolve(); return; }
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, 5000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    try { child.kill('SIGTERM'); } catch { clearTimeout(timer); resolve(); } // its own handlers save the positions first
  });
  trackerChild = null;
  trackerReadyPromise = null;
  const result = await ensureTrackerRunning(logError);
  checkForUpdate(logError); // a commit that landed while it restarted
  return result;
}

module.exports = function installTracker({ app, ipcMain, logError }) {
  ipcMain.handle('tracker:ensure', async (e) => {
    renderer = e.sender;
    const result = await ensureTrackerRunning(logError);
    if (result.ok && trackerChild && !watching.length) watchForUpdates(logError);
    return result;
  });
  ipcMain.handle('tracker:restart', (e) => { renderer = e.sender; return restartTracker(logError); });
  app.on('before-quit', () => {
    stopWatching();
    if (trackerChild) { try { trackerChild.kill(); } catch { /* already gone */ } }
  });
};
// for the unit tests
Object.assign(module.exports, { codeCommit, codeIsClean, swapIn, CODE_PATHS });
