// litrpg-tracker fork — reader comments read back out of a review copy:
// Word's .docx (and a Google Docs download of one) and LibreOffice's .odt.
// Each comment comes back with its author, date, text, replies, the words
// it was on and the words around them, and the heading of the chapter it
// sits under — enough for the page (review-bridge.js) to find the spot.
// Pure parsing of the files' XML; nothing is sent anywhere.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ReviewCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const decode = (s) => String(s || '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, '&');
const attr = (tag, name) => { const m = new RegExp('\\s' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '="([^"]*)"').exec(tag); return m ? decode(m[1]) : ''; };
const CONTEXT = 40;

/**
 * Walks a document body as a sequence of paragraphs, each a list of
 * tokens: text, a range start or end for a comment id. `headingOf(pTag)`
 * says whether a paragraph is a chapter heading. Returns the comments'
 * anchors: { id, quote, before, after, heading }.
 */
function anchorsFrom(paragraphs) {
  // paragraphs: [{ heading: string|null, parts: [{ text } | { start: id } | { end: id }] }]
  const open = new Map(); // id -> { heading, paraIndex, offset }
  const anchors = new Map();
  let heading = '';
  const texts = paragraphs.map(() => '');
  paragraphs.forEach((p, pi) => {
    if (p.heading !== null) heading = p.heading;
    let text = '';
    for (const part of p.parts) {
      if (part.start !== undefined) { open.set(part.start, { heading, para: pi, offset: text.length }); continue; }
      if (part.end !== undefined) {
        const from = open.get(part.end);
        if (!from) continue;
        open.delete(part.end);
        const quote = from.para === pi ? text.slice(from.offset) : (texts[from.para].slice(from.offset) + ' ' + text).trim();
        anchors.set(part.end, { heading: from.heading, para: from.para, offset: from.offset, endPara: pi, endOffset: text.length, quote });
        continue;
      }
      text += part.text;
    }
    texts[pi] = text;
  });
  // a start with no end: a point comment at that spot
  for (const [id, from] of open) anchors.set(id, { ...from, endPara: from.para, endOffset: from.offset, quote: '' });
  const out = new Map();
  for (const [id, a] of anchors) {
    const before = texts[a.para].slice(Math.max(0, a.offset - CONTEXT), a.offset);
    const after = texts[a.endPara].slice(a.endOffset, a.endOffset + CONTEXT);
    out.set(id, { quote: a.quote.replace(/\s+/g, ' ').trim(), before, after, heading: a.heading, paragraph: texts[a.para] });
  }
  return out;
}

// ------------------------------------------------------------------ docx

function docxParagraphs(xml) {
  const paras = [];
  for (const m of xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g)) {
    const p = m[0];
    const style = (/<w:pStyle w:val="([^"]*)"/.exec(p) || [])[1] || '';
    const parts = [];
    for (const tok of p.matchAll(/<w:commentRangeStart w:id="(\d+)"\/>|<w:commentRangeEnd w:id="(\d+)"\/>|<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>/g)) {
      if (tok[1] !== undefined) parts.push({ start: tok[1] });
      else if (tok[2] !== undefined) parts.push({ end: tok[2] });
      else if (tok[3] !== undefined) parts.push({ text: decode(tok[3]) });
      else parts.push({ text: ' ' });
    }
    const text = parts.filter((x) => x.text).map((x) => x.text).join('').trim();
    paras.push({ heading: /^Heading[1-3]$|^Title$/.test(style) ? text : null, parts });
  }
  return paras;
}

async function parseDocx(zip) {
  const doc = zip.file('word/document.xml');
  const comments = zip.file('word/comments.xml');
  if (!doc) throw new Error('Not a Word document');
  if (!comments) return [];
  const anchors = anchorsFrom(docxParagraphs(await doc.async('string')));
  const byId = new Map();
  for (const m of (await comments.async('string')).matchAll(/<w:comment\s([^>]*)>([\s\S]*?)<\/w:comment>/g)) {
    const id = attr('<x ' + m[1] + '>', 'w:id');
    const paraId = (/w14:paraId="([^"]*)"/.exec(m[2]) || [])[1] || '';
    const text = [...m[2].matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((p) => [...p[0].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((t) => decode(t[1])).join('')).join('\n').trim();
    byId.set(id, { id, author: attr('<x ' + m[1] + '>', 'w:author'), date: attr('<x ' + m[1] + '>', 'w:date'), text, paraId, replies: [] });
  }
  // replies: commentsExtended names each reply's parent by the paragraph id
  const ext = zip.file('word/commentsExtended.xml');
  const parentOf = new Map();
  if (ext) {
    for (const m of (await ext.async('string')).matchAll(/<w15:commentEx\s([^>]*)\/>/g)) {
      const tag = '<x ' + m[1] + '>';
      const parent = attr(tag, 'w15:paraIdParent');
      if (parent) parentOf.set(attr(tag, 'w15:paraId'), parent);
    }
  }
  const byPara = new Map([...byId.values()].map((c) => [c.paraId, c]));
  const out = [];
  for (const c of byId.values()) {
    const parent = parentOf.get(c.paraId) && byPara.get(parentOf.get(c.paraId));
    if (parent && parent !== c) { parent.replies.push({ author: c.author, date: c.date, text: c.text }); continue; }
    const a = anchors.get(c.id) || { quote: '', before: '', after: '', heading: '', paragraph: '' };
    out.push({ author: c.author, date: c.date, text: c.text, replies: c.replies, ...a });
  }
  return out;
}

// ------------------------------------------------------------------- odt

async function parseOdt(zip) {
  const content = zip.file('content.xml');
  if (!content) throw new Error('Not an OpenDocument text');
  const xml = await content.async('string');
  // annotations are lifted out first, their bodies parsed, a marker left in the text
  const comments = new Map();
  let n = 0;
  const flat = xml.replace(/<office:annotation(?:\s[^>]*)?>([\s\S]*?)<\/office:annotation>/g, (whole, inner) => {
    const tag = whole.slice(0, whole.indexOf('>') + 1);
    const name = attr(tag, 'office:name') || ('anon-' + (n++));
    const parent = attr(tag, 'loext:parent-name');
    const text = [...inner.matchAll(/<text:p(?:\s[^>]*)?>([\s\S]*?)<\/text:p>/g)].map((p) => decode(p[1].replace(/<[^>]+>/g, ''))).join('\n').trim();
    comments.set(name, { id: name, author: decode((/<dc:creator>([\s\S]*?)<\/dc:creator>/.exec(inner) || [])[1] || ''), date: decode((/<dc:date>([\s\S]*?)<\/dc:date>/.exec(inner) || [])[1] || ''), text, parent, replies: [] });
    return `<annostart name="${name}"/>`;
  }).replace(/<office:annotation-end office:name="([^"]*)"\/>/g, '<annoend name="$1"/>')
    // a footnote's own paragraphs would end the paragraph they sit in early
    .replace(/<text:note[ >][\s\S]*?<\/text:note>/g, '');
  const paras = [];
  for (const m of flat.matchAll(/<text:(p|h)(\s[^>]*)?>([\s\S]*?)<\/text:\1>/g)) {
    const isHeading = m[1] === 'h';
    const parts = [];
    for (const tok of m[3].matchAll(/<annostart name="([^"]*)"\/>|<annoend name="([^"]*)"\/>|<text:s(?:\s+text:c="(\d+)")?\/>|<text:tab\/>|<text:line-break\/>|<[^>]+>|([^<]+)/g)) {
      if (tok[1] !== undefined) parts.push({ start: tok[1] });
      else if (tok[2] !== undefined) parts.push({ end: tok[2] });
      else if (/^<text:s(\s|\/)/.test(tok[0])) parts.push({ text: ' '.repeat(Number(tok[3] || 1)) });
      else if (tok[0] === '<text:tab/>' || tok[0] === '<text:line-break/>') parts.push({ text: ' ' });
      else if (tok[4] !== undefined) parts.push({ text: decode(tok[4]) });
    }
    const text = parts.filter((x) => x.text).map((x) => x.text).join('').trim();
    paras.push({ heading: isHeading ? text : null, parts });
  }
  const anchors = anchorsFrom(paras);
  const out = [];
  for (const c of comments.values()) {
    const parent = c.parent && comments.get(c.parent);
    if (parent && parent !== c) { parent.replies.push({ author: c.author, date: c.date, text: c.text }); continue; }
    const a = anchors.get(c.id) || { quote: '', before: '', after: '', heading: '', paragraph: '' };
    out.push({ author: c.author, date: c.date, text: c.text, replies: c.replies, ...a });
  }
  return out;
}

/** The comments in a review copy, by its extension. `JSZip` is passed in (the main process has it). */
async function readComments(JSZip, buffer, ext) {
  const zip = await JSZip.loadAsync(buffer);
  if (ext === '.odt') return parseOdt(zip);
  if (ext === '.docx') return parseDocx(zip);
  throw new Error('Not a .docx or .odt file');
}

// ------------------------------------------------------- the .odt itself

const escXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * A review copy as an OpenDocument text — the package's entries, in the
 * order ODF wants them (the mimetype first, stored, not compressed).
 * `sections` are NEO's own export sections: { heading, paras: [{ sceneBreak, poetry, runs: [{ text, b, i, u, s, fn, br }] }] }.
 */
function odtEntries({ title, author, sections }) {
  const run = (r) => {
    if (r.br) return '<text:line-break/>';
    if (r.fn !== undefined) return `<text:note text:note-class="footnote"><text:note-citation/><text:note-body><text:p>${escXml(r.fn)}</text:p></text:note-body></text:note>`;
    const styles = [r.b && 'B', r.i && 'I', r.u && 'U', r.s && 'S'].filter(Boolean).join('');
    const text = escXml(r.text).replace(/ {2,}/g, (m) => ` <text:s text:c="${m.length - 1}"/>`);
    return styles ? `<text:span text:style-name="T${styles}">${text}</text:span>` : text;
  };
  const body = [];
  body.push(`<text:p text:style-name="Title">${escXml(title)}</text:p>`);
  if (author) body.push(`<text:p text:style-name="Subtitle">${escXml(author)}</text:p>`);
  for (const sec of sections) {
    if (sec.heading) body.push(`<text:h text:style-name="Heading_20_1" text:outline-level="1">${escXml(sec.heading)}</text:h>`);
    for (const p of sec.paras) {
      if (p.sceneBreak) { body.push('<text:p text:style-name="Scene">* * *</text:p>'); continue; }
      body.push(`<text:p text:style-name="${p.poetry ? 'Poetry' : 'Body'}">${p.runs.map(run).join('')}</text:p>`);
    }
  }
  const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" office:version="1.3"';
  const spans = ['B', 'I', 'U', 'S', 'BI', 'BU', 'IU', 'BIU', 'BS', 'IS', 'US', 'BIS', 'BUS', 'IUS', 'BIUS'].map((k) =>
    `<style:style style:name="T${k}" style:family="text"><style:text-properties${k.includes('B') ? ' fo:font-weight="bold"' : ''}${k.includes('I') ? ' fo:font-style="italic"' : ''}${k.includes('U') ? ' style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"' : ''}${k.includes('S') ? ' style:text-line-through-style="solid"' : ''}/></style:style>`).join('');
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content ${NS}><office:font-face-decls/><office:automatic-styles>${spans}</office:automatic-styles><office:body><office:text>${body.join('')}</office:text></office:body></office:document-content>`;
  const styles = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles ${NS}><office:styles>
<style:default-style style:family="paragraph"><style:paragraph-properties fo:line-height="150%"/><style:text-properties style:font-name="Liberation Serif" fo:font-family="'Liberation Serif', 'Times New Roman', serif" fo:font-size="12pt"/></style:default-style>
<style:style style:name="Standard" style:family="paragraph" style:class="text"/>
<style:style style:name="Body" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:text-indent="0.3in" fo:margin-bottom="0in"/></style:style>
<style:style style:name="Poetry" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:margin-left="0.5in" fo:margin-right="0.5in"/></style:style>
<style:style style:name="Scene" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:text-align="center" fo:margin-top="0.17in" fo:margin-bottom="0.17in"/></style:style>
<style:style style:name="Title" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:text-align="center" fo:margin-top="2in" fo:margin-bottom="0.2in"/><style:text-properties fo:font-size="24pt" fo:font-weight="bold"/></style:style>
<style:style style:name="Subtitle" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:text-align="center" fo:margin-bottom="1in"/><style:text-properties fo:font-size="14pt"/></style:style>
<style:style style:name="Heading_20_1" style:display-name="Heading 1" style:family="paragraph" style:parent-style-name="Standard" style:default-outline-level="1" style:class="text"><style:paragraph-properties fo:text-align="center" fo:margin-top="1.5in" fo:margin-bottom="0.4in" fo:break-before="page" fo:keep-with-next="always"/><style:text-properties fo:font-size="18pt" fo:font-weight="bold"/></style:style>
</office:styles></office:document-styles>`;
  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/></manifest:manifest>`;
  return [
    { path: 'mimetype', content: 'application/vnd.oasis.opendocument.text', store: true },
    { path: 'META-INF/manifest.xml', content: manifest },
    { path: 'content.xml', content },
    { path: 'styles.xml', content: styles },
  ];
}

/** A comment's identity for "already imported": author, date and words. */
const commentKey = (c) => [c.author, c.date, c.text, c.quote].join('\u0001');

return { readComments, parseDocx, parseOdt, anchorsFrom, odtEntries, commentKey };
});
