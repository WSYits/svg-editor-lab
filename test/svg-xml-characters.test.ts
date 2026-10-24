import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { SvgCodec } from '../src/svg/SvgCodec.js';
import { PreservedAttributes } from '../src/domain/PreservedAttributes.js';
import { TreeOwnership } from '../src/domain/TreeOwnership.js';

const high = String.fromCharCode(0xd800);
const low = String.fromCharCode(0xdc00);
const emoji = String.fromCharCode(0xd83d, 0xde00);
const svg = (body: string): string => `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">${body}</svg>`;
const text = (value: string): string => svg(`<text id="t" x="0" y="0">${value}</text>`);

for (const [name, source] of [
  ['high surrogate followed by ASCII in text', text(high + 'A')],
  ['high surrogate followed by ASCII in CDATA', text(`<![CDATA[${high}A]]>`)],
  ['high surrogate followed by ASCII in comment', svg(`<!--${high}A--><g/>`)],
  ['lone low surrogate in text', text(low + 'A')],
  ['lone low surrogate in comment', svg(`<!--${low}A-->`)],
  ['high surrogate at the end of the entire input', svg('') + high],
  ['reversed surrogate pair', text(low + high + 'A')],
  ['two consecutive high surrogates', text(high + high + 'A')],
] as const) {
  test(`rejects actual invalid UTF-16: ${name}`, () => {
    // These are real code units, not a literal backslash-u escape sequence.
    assert.equal(high.length, 1); assert.equal(high.charCodeAt(0), 0xd800);
    assert.equal(low.length, 1); assert.equal(low.charCodeAt(0), 0xdc00);
    assert.throws(() => new SvgCodec().decode(source), { message: 'invalid XML 1.0 character' });
  });
}

test('invalid characters are rejected before parser execution and domain construction', t => {
  // Use only the documented runtime method; avoid saxes' incompatible old declarations.
  const { SaxesParser } = createRequire(import.meta.url)('saxes') as {
    SaxesParser: { prototype: { write(source: string): unknown } };
  };
  const parser = t.mock.method(SaxesParser.prototype, 'write', () => { throw new Error('parser must not run'); });
  const domain = t.mock.method(TreeOwnership, 'initializeDocument', () => { throw new Error('document must not be constructed'); });
  for (const source of [text(high + 'A'), svg(`<!--${high}A-->`), text(`<![CDATA[${high}A]]>`)]) {
    assert.throws(() => new SvgCodec().decode(source), { message: 'invalid XML 1.0 character' });
  }
  assert.equal(parser.mock.callCount(), 0); assert.equal(domain.mock.callCount(), 0);
});

test('byte-limit validation still precedes XML character validation', () => {
  assert.throws(() => new SvgCodec({ maxBytes: 1 }).decode(text(high + 'A')), { message: 'SVG byte limit exceeded' });
});

for (const [name, value] of [
  ['ASCII', 'ASCII 123'], ['Chinese', '中文文本'], ['correct high/low surrogate pair', emoji],
  ['mixed multibyte Unicode', `ASCII 中文 ${emoji} ${String.fromCodePoint(0x10348)}`],
  ['supplementary XML range boundaries', String.fromCodePoint(0x10000, 0x10ffff)],
] as const) {
  test(`legal Unicode preserves semantic state through decode/encode/decode: ${name}`, () => {
    const codec = new SvgCodec(); const first = codec.decode(text(value));
    const second = codec.decode(codec.encode(first.document));
    const firstText = first.document.findById('t')!; const secondText = second.document.findById('t')!;
    assert.equal(firstText.getAttribute('text'), value); assert.equal(secondText.getAttribute('text'), value);
    assert.deepEqual(secondText.getAttributes(), firstText.getAttributes());
    assert.deepEqual(secondText.getPreservedAttributes(), firstText.getPreservedAttributes());
    assert.deepEqual([second.document.width, second.document.height], [100, 100]);
    assert.deepEqual(second.document.roots.map(shape => shape.id), ['t']);
    assert.deepEqual(first.warnings, []); assert.deepEqual(second.warnings, []);
    assert.notEqual(secondText, firstText);
  });
}

test('existing validator accepts exactly the tested XML 1.0 Char range boundaries and valid pairs', () => {
  for (const point of [0x9, 0xa, 0xd, 0x20, 0xd7ff, 0xe000, 0xfffd, 0x10000, 0x10ffff]) {
    assert.doesNotThrow(() => PreservedAttributes.assertXmlText(String.fromCodePoint(point)));
  }
  for (const point of [0, 0x8, 0xb, 0xc, 0xe, 0x1f, 0xd800, 0xdbff, 0xdc00, 0xdfff, 0xfffe, 0xffff]) {
    assert.throws(() => PreservedAttributes.assertXmlText(String.fromCharCode(point)), { message: 'invalid XML 1.0 character' });
  }
  assert.doesNotThrow(() => PreservedAttributes.assertXmlText(high + low));
  assert.throws(() => PreservedAttributes.assertXmlText(high + 'A'), /invalid XML/);
  assert.throws(() => PreservedAttributes.assertXmlText(low + high), /invalid XML/);
});
