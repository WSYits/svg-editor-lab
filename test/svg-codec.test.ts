import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { SvgCodec } from '../src/svg/SvgCodec.js';
import { ShapeFactory } from '../src/domain/ShapeFactory.js';
import { SvgDocument } from '../src/domain/SvgDocument.js';
import { TreeOwnership } from '../src/domain/TreeOwnership.js';
import type { Shape } from '../src/domain/Shape.js';

const namespace = 'http://www.w3.org/2000/svg';
function svg(body = '', attrs = 'width="100" height="100"'): string {
  return `<svg xmlns="${namespace}" ${attrs}>${body}</svg>`;
}
function state(document: SvgDocument): unknown {
  const ids = new Set<string>(); const objects = new Set<Shape>();
  const node = (shape: Shape, owner: Shape | SvgDocument): unknown => {
    assert(!ids.has(shape.id)); assert(!objects.has(shape)); ids.add(shape.id); objects.add(shape);
    assert.equal(document.findById(shape.id), shape); assert.equal(TreeOwnership.ownerOf(shape), owner);
    assert.equal(document.parentOf(shape.id), owner === document ? undefined : owner);
    return { type: shape.type, attributes: shape.getAttributes(), preserved: shape.getPreservedAttributes(), children: shape.children.map(child => node(child, shape)) };
  };
  return { size: [document.width, document.height], preserved: document.getPreservedAttributes(), roots: document.roots.map(root => node(root, document)) };
}
function fixture(name: string): string { return readFileSync(`test/fixtures/svg/${name}.svg`, 'utf8'); }

for (const name of ['task-basic', 'task-other', 'all-shapes']) {
  test(`${name}: decode/encode/decode preserves semantic state, order, styles and ownership`, () => {
    const codec = new SvgCodec(); const source = fixture(name); const first = codec.decode(source);
    const serialized = codec.encode(first.document); const second = codec.decode(serialized);
    assert.deepEqual(state(second.document), state(first.document)); assert.deepEqual(second.warnings, []);
    assert.notEqual(first.document, second.document); assert.match(serialized, /xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    assert.equal(first.warnings.length, name === 'task-other' ? 1 : 0);
    if (name === 'task-other') assert.deepEqual(first.warnings, ['warning: assigned id rect1 to unnamed <rect>']);
  });
}
test('task transform example is deliberately rejected with an explicit compatibility reason', () => {
  assert.throws(() => new SvgCodec().decode(fixture('task-transform')), /transform is not supported/);
});
test('prefixes and equivalent viewBox separators are accepted by namespace, not literal prefix', () => {
  const result = new SvgCodec().decode(`<s:svg xmlns:s="${namespace}" width="100" height="100" viewBox="0, 0, 100,100"><s:g id="g"/></s:svg>`);
  assert.equal(result.document.roots[0]!.id, 'g');
});
test('XML attributes are processed by name, independently of CLI positional order', () => {
  const result = new SvgCodec().decode(svg('<rect height="4" id="r" fill="red" width="3" y="2" x="1" stroke="blue"/>'));
  assert.deepEqual(result.document.roots[0]!.getAttributes(), { id: 'r', x: 1, y: 2, width: 3, height: 4, fill: 'red', stroke: 'blue' });
});
test('all explicit ids are reserved before preorder allocation; ids and counters remain case sensitive', () => {
  const codec = new SvgCodec();
  const source = svg('<g><rect x="0" y="0" width="1" height="1"/><g id="g1"/><rect id="rect1" x="0" y="0" width="1" height="1"/><rect x="0" y="0" width="1" height="1"/><g id="G1"/></g>');
  const { document, warnings } = codec.decode(source);
  assert.equal(document.roots[0]!.id, 'g2');
  assert.deepEqual(document.roots[0]!.children.map(shape => shape.id), ['rect2', 'g1', 'rect1', 'rect3', 'G1']);
  assert.deepEqual(warnings, ['warning: assigned id g2 to unnamed <g>', 'warning: assigned id rect2 to unnamed <rect>', 'warning: assigned id rect3 to unnamed <rect>']);
  assert(Object.isFrozen(warnings)); assert.throws(() => Object.assign(warnings, { 0: 'outside' }), TypeError);
  document.remove('g2'); assert.equal(codec.decode(source).document.roots[0]!.id, 'g2');
});
for (const text of ['', '你好🌍', '  spaced\ntext\t ', '"quotes" \\ slash & < >', '\r\n\t']) {
  test(`text/model round trip preserves XML characters ${JSON.stringify(text)}`, () => {
    const document = new SvgDocument(); const shape = new ShapeFactory().create('text', 't', { x: 1, y: 2, text });
    shape.setPreservedAttributes({ 'xml:space': 'preserve' }); document.insert(shape);
    const codec = new SvgCodec(); const encoded = codec.encode(document); const decoded = codec.decode(encoded);
    assert.equal(decoded.document.findById('t')!.getAttribute('text'), text);
    assert.deepEqual(state(decoded.document), state(document));
  });
}
test('CDATA and predefined/numeric entities combine without trimming or double escaping', () => {
  const source = svg('<text id="t" x="0" y="0"> A &amp; &lt; &gt; &quot; &apos; &#65; &#x4E2D; <![CDATA[B&C<d>]]> Z </text>');
  const codec = new SvgCodec(); const { document } = codec.decode(source);
  assert.equal(document.findById('t')!.getAttribute('text'), ' A & < > " \' A 中 B&C<d> Z ');
  assert.deepEqual(state(codec.decode(codec.encode(document)).document), state(document));
});
test('styles remain absent when omitted, preserved attributes do not enter editable attributes', () => {
  const codec = new SvgCodec(); const { document } = codec.decode(fixture('all-shapes'));
  const circle = document.findById('c')!; assert.equal(circle.getAttribute('fill'), undefined);
  assert.equal(Object.hasOwn(circle.getAttributes(), 'stroke'), false);
  assert.equal(document.findById('t')!.getPreservedAttributes()['font-size'], '18px');
  assert.equal(Object.hasOwn(document.findById('t')!.getAttributes(), 'font-size'), false);
  assert.throws(() => document.findById('t')!.setAttribute('font-size', 2), /unknown attribute/);
  assert.equal(document.getPreservedAttributes().fill, 'black');
});

for (const [name, source, message] of [
  ['duplicate id', svg('<g id="same"><g id="same"/></g>'), /id already exists/],
  ['empty id', svg('<g id=""/>'), /id must/], ['space id', svg('<g id="a b"/>'), /id must/],
  ['mismatch', svg('<g>'), /invalid XML/], ['duplicate attr', svg('<g id="a" id="b"/>'), /invalid XML/],
  ['duplicate expanded attr', `<svg xmlns="${namespace}" xmlns:a="${namespace}" xmlns:b="${namespace}" width="1" height="1" a:x="1" b:x="2"/>`, /invalid XML/],
  ['unquoted attr', `<svg xmlns="${namespace}" width=1 height="1"/>`, /invalid XML/],
  ['unescaped ampersand', svg('<text x="0" y="0">A&B</text>'), /invalid XML/],
  ['unknown entity', svg('<text x="0" y="0">&unknown;</text>'), /invalid XML/],
  ['null ref', svg('<text x="0" y="0">&#0;</text>'), /invalid XML/],
  ['null character', svg('\u0000'), /invalid XML/],
  ['no root', '', /invalid XML|expected SVG/], ['multiple roots', svg() + svg(), /invalid XML/],
  ['wrong root', `<g xmlns="${namespace}"/>`, /root element/],
  ['missing namespace', '<svg width="1" height="1"/>', /namespace/],
  ['wrong namespace', '<svg xmlns="urn:wrong" width="1" height="1"/>', /namespace/],
  ['child namespace', svg('<g xmlns="urn:wrong"/>'), /namespace/],
  ['undeclared prefix', svg('<x:g/>'), /invalid XML/],
  ['unknown figure', svg('<path d="M 0 0"/>'), /unknown shape type/],
  ['script', svg('<script>alert(1)</script>'), /unknown shape type/],
  ['event', svg('<g onclick="alert(1)"/>'), /event/],
  ['style', svg('<g style="fill:red"/>'), /CSS/],
  ['resource paint', svg('<g fill="url(https://example.invalid/a)"/>'), /paint or resource/],
  ['href', svg('<g href="other.svg"/>'), /resource/],
  ['complex text', svg('<text x="0" y="0"><tspan>text</tspan></text>'), /child element/],
  ['leaf child', svg('<rect x="0" y="0" width="1" height="1"><g/></rect>'), /child element/],
  ['group text', svg('<g>meaningful text</g>'), /unexpected text/],
  ['unknown semantics', svg('<g clip-path="url(#a)"/>'), /unsupported preserved/],
  ['unknown geometry', svg('<rect x="0" y="0" width="1" height="1" rx="1"/>'), /unsupported preserved/],
  ['DTD', '<!DOCTYPE svg>' + svg(), /DTD/],
  ['external entity', '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + svg('<text x="0" y="0">&x;</text>'), /DTD/],
  ['entity expansion', '<!DOCTYPE svg [<!ENTITY a "AAAA"><!ENTITY b "&a;&a;">]>' + svg(), /DTD/],
  ['processing instruction', '<?xml-stylesheet href="x.css"?>' + svg(), /processing instruction/],
  ['XML version', '<?xml version="1.1"?>' + svg(), /XML 1.0/],
  ['encoding', '<?xml version="1.0" encoding="ISO-8859-1"?>' + svg(), /UTF-8/],
] as const) {
  test(`rejects ${name} without retaining codec state`, () => {
    const codec = new SvgCodec(); assert.throws(() => codec.decode(source), message);
    assert.equal(codec.decode(svg()).document.width, 100);
  });
}
for (const raw of ['NaN', 'Infinity', '1e309', '12abc', '0x10', '50%', '10em', '']) {
  test(`rejects non-supported numeric syntax ${JSON.stringify(raw)}`, () => {
    const codec = new SvgCodec();
    assert.throws(() => codec.decode(svg('', `width="${raw}" height="100"`)));
    assert.throws(() => codec.decode(svg(`<circle cx="0" cy="0" r="${raw}"/>`)));
  });
}
for (const attrs of ['height="1"', 'width="1"', 'width="0" height="1"', 'width="1" height="-1"',
  'width="100" height="100" viewBox="1 0 100 100"', 'width="100" height="100" viewBox="0 0 50 100"',
  'width="100" height="100" viewBox="0 0 100"', 'width="100" height="100" viewBox="0,,0,100,100"']) {
  test(`rejects unsupported canvas mapping ${attrs}`, () => assert.throws(() => new SvgCodec().decode(svg('', attrs))));
}
test('missing required SVG geometry is rejected, not supplied by CLI defaults', () => {
  assert.throws(() => new SvgCodec().decode(svg('<rect width="1" height="1"/>')), /missing SVG attribute: x/);
});
test('resource limits enforce UTF-8 bytes, parser nodes including comments, and depth', () => {
  assert.throws(() => new SvgCodec({ maxBytes: 20 }).decode(svg()), /byte limit/);
  const unicode = svg('<text x="0" y="0">中文</text>');
  assert.throws(() => new SvgCodec({ maxBytes: unicode.length }).decode(unicode), /byte limit/);
  assert.throws(() => new SvgCodec({ maxNodes: 2 }).decode(svg('<g/><g/>')), /node limit/);
  assert.throws(() => new SvgCodec({ maxNodes: 2 }).decode(svg('<!--a--><!--b-->')), /node limit/);
  assert.throws(() => new SvgCodec({ maxDepth: 2 }).decode(svg('<g><g/></g>')), /depth limit/);
  assert.equal(new SvgCodec({ maxDepth: 3 }).decode(svg('<g><g/></g>')).document.roots.length, 1);
});
test('larger bounded document decodes and round trips; excessive default nesting rejects during parsing', () => {
  const source = svg(Array.from({ length: 500 }, (_, i) => `<rect id="r${i}" x="${i}" y="0" width="2" height="3"/>`).join(''));
  const codec = new SvgCodec(); const decoded = codec.decode(source);
  assert.equal(decoded.document.roots.length, 500);
  assert.deepEqual(state(codec.decode(codec.encode(decoded.document)).document), state(decoded.document));
  assert.throws(() => codec.decode(svg('<g>'.repeat(100) + '</g>'.repeat(100))), /depth limit/);
});
test('encode limits and unsupported state fail without modifying caller-owned document', () => {
  const codec = new SvgCodec(); const document = codec.decode(fixture('all-shapes')).document; const before = state(document);
  for (const limited of [new SvgCodec({ maxBytes: 100 }), new SvgCodec({ maxNodes: 2 }), new SvgCodec({ maxDepth: 2 })]) {
    assert.throws(() => limited.encode(document), /limit/); assert.deepEqual(state(document), before);
  }
  document.findById('r')!.setAttribute('fill', 'url(#paint)'); const invalid = state(document);
  assert.throws(() => codec.encode(document), /resource reference/); assert.deepEqual(state(document), invalid);
  document.findById('r')!.setAttribute('fill', 'red');
  document.findById('t')!.setAttribute('text', '\u0000'); assert.throws(() => codec.encode(document), /XML 1.0 character/);
});
for (const limits of [{ maxBytes: 0 }, { maxDepth: -1 }, { maxNodes: Infinity }, { maxNodes: 1.5 }]) {
  test(`invalid resource limits ${JSON.stringify(limits)} reject`, () => assert.throws(() => new SvgCodec(limits), /limits/));
}

for (const name of ['task-preview-basic', 'task-preview-transform']) {
  test(`${name}: inline CSS used by the Markdown preview is explicitly outside the supported subset`, () => {
    assert.throws(() => new SvgCodec().decode(fixture(name)), /CSS/);
  });
}
test('all five complete SVG samples in the task are represented exactly by compatibility fixtures', () => {
  const task = readFileSync('requirements/phase1.md', 'utf8');
  const examples = [...task.matchAll(/^<svg\b.*?^<\/svg>/gmsu)].map(match => match[0]);
  const names = ['task-basic', 'task-preview-basic', 'task-transform', 'task-preview-transform', 'task-other'];
  assert.equal(examples.length, names.length);
  names.forEach((name, index) => assert(fixture(name).trim().includes(examples[index]!)));
});

test('encoder and decoder agree on node/depth limits for their own compact output including text nodes', () => {
  const empty = new SvgDocument(); const tiny = new SvgCodec({ maxNodes: 1, maxDepth: 1 });
  assert.deepEqual(state(tiny.decode(tiny.encode(empty)).document), state(empty));
  const document = new SvgDocument(); document.insert(new ShapeFactory().create('text', 't', { x: 0, y: 0, text: 'hi' }));
  assert.throws(() => new SvgCodec({ maxNodes: 2 }).encode(document), /node limit/);
  const exact = new SvgCodec({ maxNodes: 3, maxDepth: 2 });
  assert.deepEqual(state(exact.decode(exact.encode(document)).document), state(document));
});

test('default resource caps reject oversized bytes and excess nodes before domain construction', t => {
  const spy = t.mock.method(ShapeFactory.prototype, 'create', () => { throw new Error('domain construction must not start'); });
  assert.throws(() => new SvgCodec().decode(svg(' '.repeat(1024 * 1024))), /byte limit/);
  assert.throws(() => new SvgCodec().decode(svg('<g/>'.repeat(10000))), /node limit/);
  assert.equal(spy.mock.callCount(), 0);
});
test('decode failures do not affect previously returned documents or warnings', () => {
  const codec = new SvgCodec(); const good = codec.decode(svg('<g/>')); const before = state(good.document);
  assert.throws(() => codec.decode(svg('<g/><g id="same"/><g id="same"/>')), /id already exists/);
  assert.deepEqual(state(good.document), before); assert.deepEqual(good.warnings, ['warning: assigned id g1 to unnamed <g>']);
  const other = codec.decode(svg('<g/>')); other.document.roots[0]!.setPreservedAttributes({ 'data-value': 'different' });
  assert.deepEqual(state(good.document), before); assert.notEqual(other.document.roots[0], good.document.roots[0]);
});
