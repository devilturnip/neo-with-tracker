'use strict';
// The echo report's counting (echo-core.js): plain word counts, no model.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { closeEchoes, countStems, repeatedPhrases, report, stem, tokenize } = require('../echo-core.js');

test('words stem together: walk, walked, walking, walks; the short and the odd are left alone', () => {
  for (const w of ['walked', 'walking', 'walks']) assert.equal(stem(w), 'walk');
  for (const w of ['glare', 'glared', 'glaring', 'glares']) assert.equal(stem(w), 'glar');
  assert.equal(stem('stopped'), 'stop');
  assert.equal(stem('cities'), 'city');
  assert.equal(stem('glass'), 'glass');
  assert.equal(stem('red'), 'red');
});

test('an echo is the same content word twice within the window, every instance in one group; stopwords and ignored names never echo', () => {
  const text = 'The orc glared. Jake glared back, and the orc glared again. Much later the glare was forgotten.';
  const tokens = tokenize(text);
  const glare = closeEchoes(tokens, 10, new Set(['jake'])).find((g) => g.stem === 'glar');
  assert.equal(glare.positions.length, 4, 'every glare is within ten words of the one before');
  assert.equal(text.slice(glare.positions[0].start, glare.positions[0].end), 'glared');
  const tight = closeEchoes(tokens, 3, new Set(['jake'])).filter((g) => g.stem === 'glar');
  assert.deepEqual(tight.map((g) => g.positions.length), [2], 'with a window of three, only the first pair is an echo');
  assert.deepEqual(closeEchoes(tokens, 10, new Set(['jake'])).map((g) => g.stem), ['orc', 'glar'], 'in order of first appearance');
  assert.equal(closeEchoes(tokens, 100, new Set(['jake', 'orc', 'glare'])).length, 0, 'an ignored word is ignored in every form');
  assert.equal(closeEchoes(tokenize('the the the'), 5, new Set()).length, 0);
});

test('a phrase of three to five words that comes round twice is listed once, the longest form only', () => {
  const text = 'He drew a long breath. Then he drew a long breath again, as if a long breath could help.';
  const phrases = repeatedPhrases(tokenize(text), new Set());
  assert.deepEqual(phrases.map((p) => [p.phrase, p.positions.length]), [['a long breath', 3], ['he drew a long breath', 2]].sort((a, b) => b[1] - a[1]));
  assert.equal(repeatedPhrases(tokenize('and then the and then the'), new Set()).length, 0, 'stopwords alone are not a phrase');
});

test('overuse compares the chapter with the book: a word at three times the book rate and four uses', () => {
  const chapter = 'The blade sang. The blade cut. The blade rose. The blade fell. A horse watched.';
  const book = countStems([chapter, 'A horse ran. A horse ate. A horse slept. A horse neighed. Rain fell on the road for days and days of road.', 'Nothing much happened here at all for a long while.'], new Set());
  const r = report(chapter, { window: 50, book });
  assert.deepEqual(r.overused.map((o) => [o.word, o.count]), [['blade', 4]]);
  assert.equal(r.words, 15);
  assert.ok(r.echoes.some((e) => e.word === 'blade'));
  // with no book to compare, four uses alone is enough to mention
  assert.deepEqual(report(chapter).overused.map((o) => o.word), ['blade']);
});
