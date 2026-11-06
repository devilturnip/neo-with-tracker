// tracker-main.js's update watch: which commits count as a tracker update,
// and the swap of a new build for the running one.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { codeCommit, codeIsClean, swapIn } = require('../tracker-main.js');

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-tracker-main-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  const commit = (msg) => { git('add', '-A'); git('commit', '-q', '-m', msg); return git('rev-parse', 'HEAD'); };
  return { dir, write, commit, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('a code commit is an update; a data commit, or the dismissed warnings, are not', () => {
  const r = repo();
  try {
    r.write('src/app.ts', 'one');
    r.write('data/chapters/ch-001.json', '{}');
    const first = r.commit('code');
    assert.equal(codeCommit(r.dir), first);
    r.write('data/chapters/ch-001.json', '{"a":1}');
    r.write('data/checks/dismissed-warnings.json', '[]');
    r.commit('data');
    assert.equal(codeCommit(r.dir), first, 'data moved, the code did not');
    r.write('server/routes.ts', 'two');
    const second = r.commit('server code');
    assert.equal(codeCommit(r.dir), second, "the server's own code counts");
    r.write('data/checks/console-stat-blocks.json', '[]');
    assert.equal(codeCommit(r.dir), second);
    assert.equal(r.commit('stat-block check on'), codeCommit(r.dir), 'the check the build imports counts');
  } finally { r.done(); }
});

test('code changed but not committed is not clean; data changed is', () => {
  const r = repo();
  try {
    r.write('src/app.ts', 'one');
    r.commit('code');
    assert.equal(codeIsClean(r.dir), true);
    r.write('data/chapters/ch-002.json', '{}');
    assert.equal(codeIsClean(r.dir), true, 'the author tracking meanwhile');
    r.write('src/app.ts', 'half done');
    assert.equal(codeIsClean(r.dir), false);
  } finally { r.done(); }
});

test('outside a git checkout there is no code commit', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-tracker-main-'));
  try { assert.equal(codeCommit(dir), null); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the new build is swapped in for the running one, which is kept if there is nothing to swap', () => {
  const r = repo();
  try {
    r.write('dist-neo/index.html', 'old');
    r.write('dist-neo-next/index.html', 'new');
    swapIn(r.dir);
    assert.equal(fs.readFileSync(path.join(r.dir, 'dist-neo/index.html'), 'utf8'), 'new');
    assert.equal(fs.existsSync(path.join(r.dir, 'dist-neo-next')), false);
    assert.equal(fs.existsSync(path.join(r.dir, 'dist-neo-old')), false);
    assert.throws(() => swapIn(r.dir), 'no new build');
    assert.equal(fs.readFileSync(path.join(r.dir, 'dist-neo/index.html'), 'utf8'), 'new', 'the running build put back');
  } finally { r.done(); }
});
