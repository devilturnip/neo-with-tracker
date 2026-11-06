'use strict';
// Reader comments read back out of a review copy (review-core.js): Word
// and LibreOffice files made here with JSZip, so nothing in the test
// depends on a file on disk.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const { readComments, odtEntries, commentKey } = require('../review-core.js');

const docx = async ({ document, comments, extended }) => {
  const zip = new JSZip();
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="w"><w:body>${document}</w:body></w:document>`);
  if (comments !== undefined) zip.file('word/comments.xml', `<?xml version="1.0"?><w:comments xmlns:w="w" xmlns:w14="w14">${comments}</w:comments>`);
  if (extended) zip.file('word/commentsExtended.xml', `<?xml version="1.0"?><w15:commentsEx xmlns:w15="w15">${extended}</w15:commentsEx>`);
  return readComments(JSZip, await zip.generateAsync({ type: 'nodebuffer' }), '.docx');
};
const p = (inner, style) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${inner}</w:p>`;
const r = (text) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;

test('a Word comment comes back with its words, the words around them, its chapter heading, and a reply', async () => {
  const out = await docx({
    document: p(r('Chapter 2 — The Hall'), 'Heading1')
      + p(r('Jake drew ') + '<w:commentRangeStart w:id="0"/>' + r('the ') + r('blade') + '<w:commentRangeEnd w:id="0"/>' + r('. The orc laughed &amp; fled.'))
      + p(r('Later, ') + '<w:commentRangeStart w:id="1"/>' + r('a cold wind'))
      + p(r('blew in') + '<w:commentRangeEnd w:id="1"/>' + r(' from the north.')),
    comments: '<w:comment w:id="0" w:author="Beth" w:date="2026-11-01T10:00:00Z"><w:p w14:paraId="A1"><w:r><w:t>Which blade?</w:t></w:r></w:p></w:comment>'
      + '<w:comment w:id="2" w:author="Jake" w:date="2026-11-02T10:00:00Z"><w:p w14:paraId="A2"><w:r><w:t>The basilard.</w:t></w:r></w:p></w:comment>'
      + '<w:comment w:id="1" w:author="Beth" w:date="2026-11-01T11:00:00Z"><w:p w14:paraId="B1"><w:r><w:t>Across a paragraph.</w:t></w:r></w:p></w:comment>',
    extended: '<w15:commentEx w15:paraId="A1"/><w15:commentEx w15:paraId="A2" w15:paraIdParent="A1"/><w15:commentEx w15:paraId="B1"/>',
  });
  assert.equal(out.length, 2, 'the reply folds into its parent');
  assert.deepEqual(out[0], {
    author: 'Beth', date: '2026-11-01T10:00:00Z', text: 'Which blade?',
    replies: [{ author: 'Jake', date: '2026-11-02T10:00:00Z', text: 'The basilard.' }],
    quote: 'the blade', before: 'Jake drew ', after: '. The orc laughed & fled.', heading: 'Chapter 2 — The Hall',
    paragraph: 'Jake drew the blade. The orc laughed & fled.',
  });
  assert.deepEqual([out[1].quote, out[1].before, out[1].after], ['a cold wind blew in', 'Later, ', ' from the north.']);
});

test('a comment whose range is gone is a point comment; a document with no comments part has none', async () => {
  const out = await docx({ document: p(r('No ranges here.')), comments: '<w:comment w:id="7" w:author="Beth" w:date=""><w:p><w:r><w:t>Where?</w:t></w:r></w:p></w:comment>' });
  assert.deepEqual([out[0].text, out[0].quote, out[0].heading], ['Where?', '', '']);
  assert.deepEqual(await docx({ document: p(r('Plain.')) }), []);
});

test('a LibreOffice annotation comes back the same way, replies by parent name, a lone annotation as a point', async () => {
  const zip = new JSZip();
  const anno = (name, who, when, text, parent) => `<office:annotation office:name="${name}"${parent ? ` loext:parent-name="${parent}"` : ''}><dc:creator>${who}</dc:creator><dc:date>${when}</dc:date><text:p>${text}</text:p></office:annotation>`;
  zip.file('content.xml', `<?xml version="1.0"?><office:document-content><office:body><office:text>
<text:h text:outline-level="1">Chapter 3</text:h>
<text:p>Jake drew ${anno('c1', 'Beth', '2026-11-03', 'Which blade?')}the<text:s/>blade${anno('c2', 'Jake', '2026-11-04', 'Mine.', 'c1')}<office:annotation-end office:name="c1"/>. The orc laughed.</text:p>
<text:p>Then ${anno('c3', 'Beth', '2026-11-03', 'Slow here.')}nothing happened.</text:p>
</office:text></office:body></office:document-content>`);
  const out = await readComments(JSZip, await zip.generateAsync({ type: 'nodebuffer' }), '.odt');
  assert.equal(out.length, 2);
  assert.deepEqual([out[0].quote, out[0].before, out[0].after, out[0].heading, out[0].replies], ['the blade', 'Jake drew ', '. The orc laughed.', 'Chapter 3', [{ author: 'Jake', date: '2026-11-04', text: 'Mine.' }]]);
  assert.deepEqual([out[1].quote, out[1].before], ['', 'Then ']);
});

test('the .odt review copy is a valid package: the mimetype first and stored, the chapters and their styling in it', async () => {
  const entries = odtEntries({ title: 'Luck Mode', author: 'S.', sections: [
    { heading: 'Chapter 1', paras: [{ runs: [{ text: 'Jake ' }, { text: 'drew', i: true }, { text: ' the blade.' }] }, { sceneBreak: true, runs: [] }, { poetry: true, runs: [{ text: 'LV 11' }] }] },
  ] });
  assert.equal(entries[0].path, 'mimetype');
  assert.equal(entries[0].store, true);
  assert.equal(entries[0].content, 'application/vnd.oasis.opendocument.text');
  assert.deepEqual(entries.map((e) => e.path), ['mimetype', 'META-INF/manifest.xml', 'content.xml', 'styles.xml']);
  const content = entries[2].content;
  assert.ok(content.includes('<text:h text:style-name="Heading_20_1" text:outline-level="1">Chapter 1</text:h>'));
  assert.ok(content.includes('Jake <text:span text:style-name="TI">drew</text:span> the blade.'));
  assert.ok(content.includes('<text:p text:style-name="Scene">* * *</text:p>'));
  assert.ok(content.includes('<text:p text:style-name="Poetry">LV 11</text:p>'));
  // what it writes, it reads: a comment put on it in LibreOffice would come back
  const zip = new JSZip();
  for (const e of entries) zip.file(e.path, e.content);
  assert.deepEqual(await readComments(JSZip, await zip.generateAsync({ type: 'nodebuffer' }), '.odt'), []);
});

test('a comment keeps its identity across imports', () => {
  const c = { author: 'Beth', date: 'd', text: 'x', quote: 'q' };
  assert.equal(commentKey(c), commentKey({ ...c, replies: [] }));
  assert.notEqual(commentKey(c), commentKey({ ...c, text: 'y' }));
});
