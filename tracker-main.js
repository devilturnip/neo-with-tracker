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

// `vite build --mode neo` into BUILD_DIR; resolves whether it worked. A
// build that hangs is killed after a minute (it takes about a second).
function buildForNeo(vite, logError) {
  return new Promise((resolve) => {
    let child;
    try {
      child = require('child_process').spawn(vite, ['build', '--mode', 'neo', '--outDir', BUILD_DIR, '--emptyOutDir'],
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

module.exports = function installTracker({ app, ipcMain, logError }) {
  ipcMain.handle('tracker:ensure', () => ensureTrackerRunning(logError));
  app.on('before-quit', () => {
    if (trackerChild) { try { trackerChild.kill(); } catch { /* already gone */ } }
  });
};
