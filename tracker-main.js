// litrpg-tracker — the main-process half of the fork. A separate project
// (litrpg-tracker) with its own Vite dev server, embedded as an iframe in the
// renderer's right-edge pane (tracker-bridge.js). This just gets a running
// server and hands back its URL over IPC — Linux only for now (no
// shell:true/npm.cmd handling for Windows, no macOS-specific kill strategy).
//
// Required by one line in main.js, which hands over its own Electron objects
// (main.js's tests run it under plain Node with a stand-in `electron`, so
// this must not require('electron') itself):
//   require('./tracker-main.js')({ app, ipcMain, logError })

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const TRACKER_DIR = path.join(os.homedir(), 'Projects', 'litrpg-tracker');
let trackerChild = null; // only set when WE spawned it — never kill a server we just found running
let trackerReadyPromise = null;

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
    if (await trackerPing(5173)) return { ok: true, url: 'http://localhost:5173' };
    try {
      // vite's own binary, not `npm run dev`: npm doesn't reliably pass a kill on to
      // the script it runs, which left vite itself running after NEO quit
      const child = require('child_process').spawn(path.join(TRACKER_DIR, 'node_modules', '.bin', 'vite'), [], { cwd: TRACKER_DIR, stdio: ['ignore', 'pipe', 'ignore'] });
      trackerChild = child;
      // any exit invalidates the cache, so the next call starts fresh instead of reusing a dead promise
      child.on('exit', () => { if (trackerChild === child) trackerChild = null; trackerReadyPromise = null; });
      // Vite's own startup line looks like "  ➜  Local:   http://localhost:5173/" — read the real
      // port back rather than assuming 5173, in case something else already held it
      const port = await new Promise((resolve) => {
        let done = false;
        const settle = (p) => { if (!done) { done = true; resolve(p); } };
        child.stdout.on('data', (buf) => {
          const m = /http:\/\/localhost:(\d+)/.exec(buf.toString());
          if (m) settle(Number(m[1]));
        });
        child.once('exit', () => settle(null));
        setTimeout(() => settle(null), 5000); // Vite usually prints within ~1s
      });
      const actualPort = port || 5173; // fall back to the default if we never caught the startup line
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
