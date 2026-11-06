// litrpg-tracker fork — the echo report's counting, with nothing else in it:
// words repeated close together, phrases repeated in a chapter, words a
// chapter leans on more than the book does. Plain counting on this
// machine; no model reads anything. Loaded by the page (writing-tools.js)
// and by node --test (scripts/echo-core.test.js) alike.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EchoCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // The connective tissue of English prose, never an echo on its own.
  const STOPWORDS = new Set(('a an the and or but if then than so as of to in on at by for from with without into onto over under '
    + 'up down out off about above below between through during before after again further here there where when why how '
    + 'all any both each few more most other some such no nor not only own same too very just also '
    + 'i me my mine myself we us our ours ourselves you your yours yourself yourselves he him his himself she her hers herself '
    + 'it its itself they them their theirs themselves this that these those what which who whom whose '
    + 'am is are was were be been being have has had having do does did doing will would shall should can could may might must '
    + 'said says say like get got go went come came see saw look looked take took make made know knew think thought '
    + 'one two three first back still even ever never now yet well much many way thing things something nothing').split(/\s+/));

  const WORD = /[\p{L}\p{N}][\p{L}\p{N}’']*/gu;

  /** Every word with where it sits: its text, its lowered form, and a rough stem. */
  function tokenize(text) {
    const out = [];
    let m;
    WORD.lastIndex = 0;
    while ((m = WORD.exec(text)) !== null) {
      const word = m[0];
      const lower = word.toLowerCase().replace(/[’']s$/, '').replace(/[’']$/, '');
      out.push({ word, lower, stem: stem(lower), start: m.index, end: m.index + word.length });
    }
    return out;
  }

  /** walk / walked / walking / walks read as one word; a short word is left alone. */
  function stem(w) {
    if (w.length < 5) return w;
    let s = w;
    const undouble = (x) => (x.length > 3 && x.at(-1) === x.at(-2) ? x.slice(0, -1) : x);
    if (s.endsWith('ies') && s.length > 5) s = s.slice(0, -3) + 'y';
    else if (s.endsWith('ing') && s.length > 6) s = undouble(s.slice(0, -3));
    else if (s.endsWith('ed') && s.length > 5) s = undouble(s.slice(0, -2));
    else if (s.endsWith('es') && s.length > 5) s = s.slice(0, -2);
    else if (s.endsWith('s') && !s.endsWith('ss')) s = s.slice(0, -1);
    // glare / glared / glaring meet at "glar": a trailing e is not part of the key
    if (s.endsWith('e') && s.length > 4) s = s.slice(0, -1);
    return s;
  }

  /** An ignore list in every form its words take: "glare" ignores glared and glaring too. */
  function expand(ignore) {
    const out = new Set();
    for (const w of ignore || []) { const l = String(w).toLowerCase(); out.add(l); out.add(stem(l)); }
    return out;
  }
  const isContent = (t, ignore) => !STOPWORDS.has(t.lower) && !ignore.has(t.lower) && !ignore.has(t.stem) && /\p{L}/u.test(t.lower) && t.lower.length > 2;

  /**
   * The same content word (or stem) twice within `window` words: each
   * group lists every spot in the run, so a word used four times in a
   * paragraph is one echo of four, not three pairs.
   */
  function closeEchoes(tokens, window, ignore) {
    ignore = expand(ignore);
    const groups = [];
    const open = new Map(); // stem -> group being extended
    tokens.forEach((t, i) => {
      if (!isContent(t, ignore)) return;
      const g = open.get(t.stem);
      if (g && i - g.lastIndex <= window) {
        g.positions.push({ start: t.start, end: t.end, word: t.word });
        g.lastIndex = i;
        return;
      }
      const fresh = { stem: t.stem, word: t.word, positions: [{ start: t.start, end: t.end, word: t.word }], lastIndex: i, firstIndex: i };
      open.set(t.stem, fresh);
      groups.push(fresh);
    });
    return groups.filter((g) => g.positions.length > 1).map(({ stem, word, positions, firstIndex, lastIndex }) => ({ stem, word, positions, span: lastIndex - firstIndex }));
  }

  /** Phrases of 3–5 words that come round twice or more; a phrase inside a longer repeated one is left to it. */
  function repeatedPhrases(tokens, ignore) {
    ignore = expand(ignore);
    const found = new Map(); // key -> { words, positions }
    for (let n = 5; n >= 3; n--) {
      for (let i = 0; i + n <= tokens.length; i++) {
        const slice = tokens.slice(i, i + n);
        if (!slice.some((t) => isContent(t, ignore))) continue;
        const key = slice.map((t) => t.lower).join(' ');
        const entry = found.get(key) || { n, words: key, positions: [] };
        entry.positions.push({ start: slice[0].start, end: slice[n - 1].end });
        found.set(key, entry);
      }
    }
    const repeated = [...found.values()].filter((p) => p.positions.length > 1);
    // a shorter phrase that only ever appears inside a longer repeated one adds nothing
    const longer = repeated.filter((p) => p.n > 3);
    return repeated
      .filter((p) => !longer.some((l) => l.n > p.n && l.words.includes(p.words) && l.positions.length === p.positions.length))
      .sort((a, b) => b.positions.length - a.positions.length || b.n - a.n)
      .map(({ words, positions }) => ({ phrase: words, positions }));
  }

  /** Words this chapter uses far more than the book does: at least `times` the book's rate, and `least` times. */
  function overused(tokens, bookCounts, bookWords, ignore, times = 3, least = 4) {
    ignore = expand(ignore);
    const counts = new Map();
    for (const t of tokens) if (isContent(t, ignore)) counts.set(t.stem, (counts.get(t.stem) || 0) + 1);
    const here = tokens.length || 1;
    const out = [];
    for (const [stem, count] of counts) {
      if (count < least) continue;
      const rate = count / here * 1000;
      const bookRate = bookWords ? ((bookCounts.get(stem) || 0) / bookWords) * 1000 : 0;
      if (!bookWords || rate >= bookRate * times) {
        const first = tokens.find((t) => t.stem === stem);
        out.push({ stem, word: first ? first.word : stem, count, rate: Math.round(rate * 10) / 10, bookRate: Math.round(bookRate * 10) / 10,
          positions: tokens.filter((t) => t.stem === stem).map((t) => ({ start: t.start, end: t.end, word: t.word })) });
      }
    }
    return out.sort((a, b) => b.count - a.count);
  }

  /** Stem counts over a whole book's text, for the overuse comparison. */
  function countStems(texts, ignore) {
    ignore = expand(ignore);
    const counts = new Map();
    let words = 0;
    for (const text of texts) {
      for (const t of tokenize(text)) {
        words += 1;
        if (isContent(t, ignore)) counts.set(t.stem, (counts.get(t.stem) || 0) + 1);
      }
    }
    return { counts, words };
  }

  /** The whole report for one chapter's text. */
  function report(text, { window = 100, ignore = [], book = null } = {}) {
    const ig = expand(ignore);
    const tokens = tokenize(text);
    const bookCounts = book ? book.counts : new Map();
    const bookWords = book ? book.words : 0;
    return {
      words: tokens.length,
      echoes: closeEchoes(tokens, window, ig),
      phrases: repeatedPhrases(tokens, ig),
      overused: overused(tokens, bookCounts, bookWords, ig),
    };
  }

  return { STOPWORDS, tokenize, stem, closeEchoes, repeatedPhrases, overused, countStems, report };
});
