import assert from 'node:assert/strict';
import test from 'node:test';
import { SvgDocument } from '../src/domain/SvgDocument.js';
import { GroupShape } from '../src/domain/GroupShape.js';
import { RectShape } from '../src/domain/RectShape.js';
import { TextShape } from '../src/domain/TextShape.js';

test('canvas defaults, explicit dimensions and failed resize are atomic', () => {
  const doc = new SvgDocument();
  assert.equal(doc.width, 800);
  assert.equal(doc.height, 600);
  doc.resize(400.5, 300.25);
  for (const invalid of [0, -1, NaN, Infinity, -Infinity]) {
    assert.throws(() => doc.resize(100, invalid));
    assert.equal(doc.width, 400.5);
    assert.equal(doc.height, 300.25);
    assert.throws(() => doc.resize(invalid, 100));
    assert.throws(() => new SvgDocument(invalid, 100));
    assert.throws(() => new SvgDocument(100, invalid));
  }
});

test('ordered root/subtree insertion, case-sensitive lookup and parent relations', () => {
  const doc = new SvgDocument(400, 300);
  const lower = new RectShape('r', 0, 0, 1, 1);
  const upper = new RectShape('R', 0, 0, 2, 2);
  const inner = new GroupShape('inner', [lower]);
  const outer = new GroupShape('outer', [inner]);
  doc.insert(outer);
  doc.insert(upper);
  const text = new TextShape('t', 1, 2, 'text');
  doc.insert(text, 'inner');
  assert.deepEqual(doc.roots, [outer, upper]);
  assert.deepEqual(inner.children, [lower, text]);
  assert.equal(doc.findById('r'), lower);
  assert.equal(doc.findById('R'), upper);
  assert.equal(doc.findById('missing'), undefined);
  assert.equal(doc.parentOf('r'), inner);
  assert.equal(doc.parentOf('inner'), outer);
  assert.equal(doc.parentOf('outer'), undefined);
  assert.throws(() => doc.parentOf('missing'), /no such shape/);
  assert.throws(() => Object.assign(doc.roots, { 0: text }), TypeError);
  outer.move(1, 2);
  assert.equal(doc.findById('r'), lower);
  assert.equal(lower.getAttribute('x'), 1);
});

test('duplicate ids anywhere in incoming subtree reject insertion without claiming it', () => {
  const doc = new SvgDocument();
  const existing = new RectShape('used', 0, 0, 1, 1);
  const target = new GroupShape('target');
  doc.insert(existing);
  doc.insert(target);
  const incoming = new GroupShape('incoming', [new GroupShape('nested', [existing.clone()])]);
  const beforeRoots = doc.roots;
  assert.throws(() => doc.insert(incoming, 'target'), /id already exists: used/);
  assert.deepEqual(doc.roots, beforeRoots);
  assert.deepEqual(target.children, []);
  assert.equal(doc.findById('used'), existing);
  assert.equal(doc.findById('incoming'), undefined);
  assert.equal(doc.findById('nested'), undefined);
  const other = new SvgDocument();
  other.insert(incoming);
  assert.equal(other.findById('incoming'), incoming);
});

test('invalid container targets leave both trees and ownership unchanged', () => {
  const doc = new SvgDocument();
  const rect = new RectShape('r', 0, 0, 1, 1);
  const incoming = new TextShape('t', 0, 0, 'x');
  doc.insert(rect);
  assert.throws(() => doc.insert(incoming, 'missing'), /no such container: missing/);
  assert.throws(() => doc.insert(incoming, 'r'), /not a container: r/);
  assert.deepEqual(doc.roots, [rect]);
  assert.equal(doc.findById('t'), undefined);
  doc.insert(incoming);
  assert.equal(doc.findById('t'), incoming);
});

test('one object cannot be reused at roots, in groups, or across documents', () => {
  const a = new SvgDocument();
  const b = new SvgDocument();
  const leaf = new RectShape('r', 0, 0, 1, 1);
  const group = new GroupShape('g', [leaf]);
  a.insert(group);
  assert.throws(() => a.insert(group), /already belongs/);
  assert.throws(() => a.insert(leaf), /already belongs/);
  assert.throws(() => b.insert(group), /already belongs/);
  assert.throws(() => b.insert(leaf), /already belongs/);
  assert.throws(() => new GroupShape('steal', [group]), /already belongs/);
  assert.deepEqual(a.roots, [group]);
  assert.deepEqual(b.roots, []);
  assert.equal(a.parentOf('r'), group);
});

test('self and ancestor insertion into descendants is rejected without a cycle', () => {
  const doc = new SvgDocument();
  const inner = new GroupShape('inner');
  const outer = new GroupShape('outer', [inner]);
  doc.insert(outer);
  assert.throws(() => doc.insert(outer, 'outer'), /cycle/);
  assert.throws(() => doc.insert(outer, 'inner'), /cycle/);
  assert.throws(() => doc.insert(inner, 'inner'), /cycle/);
  assert.deepEqual(doc.roots, [outer]);
  assert.deepEqual(outer.children, [inner]);
  assert.deepEqual(inner.children, []);
  assert.equal(doc.findById('inner'), inner);
});

test('delete nested subtree removes all lookup entries, preserves order and allows reuse', () => {
  const doc = new SvgDocument();
  const first = new TextShape('first', 0, 0, '1');
  const leaf = new RectShape('r', 0, 0, 1, 1);
  const subtree = new GroupShape('sub', [leaf]);
  const last = new TextShape('last', 0, 0, '2');
  const root = new GroupShape('root', [first, subtree, last]);
  doc.insert(root);
  assert.equal(doc.remove('sub'), subtree);
  assert.deepEqual(root.children, [first, last]);
  assert.equal(doc.findById('sub'), undefined);
  assert.equal(doc.findById('r'), undefined);
  assert.equal(doc.findById('first'), first);
  assert.equal(doc.parentOf('last'), root);
  assert.deepEqual(subtree.children, [leaf]);
  const other = new SvgDocument();
  other.insert(subtree);
  assert.equal(other.findById('r'), leaf);
  assert.throws(() => doc.insert(leaf), /already belongs/);
});

test('root deletion and missing deletion preserve remaining roots and lookup', () => {
  const doc = new SvgDocument();
  const a = new GroupShape('a');
  const b = new GroupShape('b');
  doc.insert(a);
  doc.insert(b);
  assert.throws(() => doc.remove('missing'), /no such shape: missing/);
  assert.deepEqual(doc.roots, [a, b]);
  assert.equal(doc.findById('a'), a);
  assert.equal(doc.remove('a'), a);
  assert.deepEqual(doc.roots, [b]);
  doc.insert(a, 'b');
  assert.equal(doc.parentOf('a'), b);
  assert.deepEqual(b.children, [a]);
});

test('document clone has independent objects, dimensions, order and ownership', () => {
  const doc = new SvgDocument(400, 200);
  const text = new TextShape('t', 1, 2, 'edited');
  const group = new GroupShape('g', [text]);
  group.setAttribute('fill', 'red');
  group.move(5, 6);
  doc.insert(group);
  doc.insert(new GroupShape('last'));
  const copy = doc.clone();
  assert.equal(copy.width, 400);
  assert.equal(copy.height, 200);
  assert.deepEqual(copy.roots.map(shape => shape.id), ['g', 'last']);
  const copiedText = copy.findById('t')!;
  assert.notEqual(copiedText, text);
  assert.deepEqual(copiedText.getAttributes(), text.getAttributes());
  assert.deepEqual(copy.findById('g')!.getAttributes(), group.getAttributes());
  copiedText.move(10, 10);
  assert.equal(text.getAttribute('x'), 6);
  copy.resize(1, 2);
  copy.remove('t');
  assert.equal(doc.width, 400);
  assert.equal(doc.findById('t'), text);
  assert.deepEqual(copy.findById('g')!.children, []);
  assert.equal(doc.parentOf('t'), group);
});

test('failed group geometry retains document lookup identity and tree membership', () => {
  const doc = new SvgDocument();
  const a = new RectShape('a', 1, 2, 3, 4);
  const b = new TextShape('b', 1, Number.MAX_VALUE, 'x');
  const group = new GroupShape('g', [a, b]);
  doc.insert(group);
  const before = a.getAttributes();
  assert.throws(() => group.scale(2));
  assert.equal(doc.findById('a'), a);
  assert.equal(doc.findById('b'), b);
  assert.equal(doc.parentOf('a'), group);
  assert.deepEqual(a.getAttributes(), before);
});
