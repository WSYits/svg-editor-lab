import assert from 'node:assert/strict';
import test from 'node:test';
import type { Shape } from '../src/domain/Shape.js';
import { SvgDocument } from '../src/domain/SvgDocument.js';
import { GroupShape } from '../src/domain/GroupShape.js';
import { RectShape } from '../src/domain/RectShape.js';
import { TextShape } from '../src/domain/TextShape.js';
import { TreeOwnership } from '../src/domain/TreeOwnership.js';

function assertNodes(actual: readonly Shape[], expected: readonly Shape[]): void {
  assert.deepEqual(actual.map(node => node.id), expected.map(node => node.id));
  expected.forEach((node, index) => assert.equal(actual[index], node));
}

for (const noncontiguous of [false, true]) {
  test(`same-parent ${noncontiguous ? 'noncontiguous' : 'contiguous'} grouping uses original order and anchor`, () => {
    const doc = new SvgDocument();
    const a = new RectShape('a', 1, 2, 3, 4);
    const b = new RectShape('b', 5, 6, 7, 8);
    const c = new RectShape('c', 9, 10, 11, 12);
    const d = new RectShape('d', 13, 14, 15, 16);
    const parent = new GroupShape('parent', [a, b, c, d]);
    doc.insert(parent);
    const snapshot = parent.children;
    const selected = noncontiguous ? [a, c] : [b, c];
    const before = selected.map(shape => shape.getAttributes());
    const requested = Object.freeze(noncontiguous ? ['c', 'a'] : ['c', 'b']);
    const group = doc.group('new', requested);
    assert.ok(group instanceof GroupShape);
    assertNodes(group.children, selected);
    assertNodes(parent.children, noncontiguous ? [group, b, d] : [a, group, d]);
    assertNodes(snapshot, [a, b, c, d]);
    assert.deepEqual(selected.map(shape => shape.getAttributes()), before);
    assert.equal(doc.findById('new'), group);
    assert.equal(doc.parentOf('new'), parent);
    for (const shape of selected) {
      assert.equal(doc.findById(shape.id), shape);
      assert.equal(TreeOwnership.ownerOf(shape), group);
    }
  });
}

for (const selectGroup of [false, true]) {
  test(`single ${selectGroup ? 'subtree' : 'leaf'} is wrapped at its original root position`, () => {
    const doc = new SvgDocument();
    const before = new GroupShape('before');
    const leaf = new TextShape('text', 1, 2, 'unchanged');
    const target: Shape = selectGroup ? new GroupShape('target', [leaf]) : leaf;
    const after = new GroupShape('after');
    for (const node of [before, target, after]) doc.insert(node);
    const grouped = doc.group('wrapped', [target.id]);
    assertNodes(doc.roots, [before, grouped, after]);
    assertNodes(grouped.children, [target]);
    assert.equal(TreeOwnership.ownerOf(target), grouped);
    assert.equal(TreeOwnership.ownerOf(grouped), doc);
    assert.equal(doc.findById('text'), leaf);
    if (selectGroup) {
      assertNodes(target.children, [leaf]);
      assert.equal(TreeOwnership.ownerOf(leaf), target);
    }
  });
}

test('cross-parent grouping uses document root and retains original empty containers', () => {
  const doc = new SvgDocument();
  const a = new RectShape('a', 1, 2, 3, 4);
  const b = new TextShape('b', 5, 6, 'b');
  const left = new GroupShape('left', [a]);
  const right = new GroupShape('right', [b]);
  const tail = new GroupShape('tail');
  for (const node of [left, right, tail]) doc.insert(node);
  const group = doc.group('new', ['b', 'a']);
  assertNodes(doc.roots, [group, left, right, tail]);
  assertNodes(group.children, [a, b]);
  assertNodes(left.children, []);
  assertNodes(right.children, []);
  assert.equal(doc.findById('left'), left);
  assert.equal(doc.findById('right'), right);
  assert.equal(TreeOwnership.ownerOf(left), doc);
  assert.equal(TreeOwnership.ownerOf(right), doc);
  assert.equal(doc.parentOf('a'), group);
});

test('cross-depth grouping chooses the deepest shared container, not the document root', () => {
  const doc = new SvgDocument();
  const a = new GroupShape('a');
  const b = new TextShape('b', 1, 2, 'b');
  const x = new GroupShape('x');
  const inner = new GroupShape('inner', [b, x]);
  const left = new GroupShape('left', [inner]);
  const c = new GroupShape('c');
  const right = new GroupShape('right', [c]);
  const parent = new GroupShape('parent', [a, left, right]);
  const tail = new GroupShape('tail');
  doc.insert(parent);
  doc.insert(tail);
  const group = doc.group('new', ['c', 'b']);
  assertNodes(doc.roots, [parent, tail]);
  assertNodes(parent.children, [a, group, left, right]);
  assertNodes(group.children, [b, c]);
  assertNodes(left.children, [inner]);
  assertNodes(inner.children, [x]);
  assertNodes(right.children, []);
  assert.equal(TreeOwnership.ownerOf(b), group);
  assert.equal(TreeOwnership.ownerOf(inner), left);
  assert.equal(TreeOwnership.ownerOf(group), parent);
});

test('anchor inside an unselected branch precedes later selected direct children', () => {
  const doc = new SvgDocument();
  const a = new GroupShape('a');
  const x = new GroupShape('x');
  const branch = new GroupShape('branch', [a, x]);
  const b = new GroupShape('b');
  const tail = new GroupShape('tail');
  for (const node of [branch, b, tail]) doc.insert(node);
  const group = doc.group('new', ['b', 'a']);
  assertNodes(doc.roots, [group, branch, tail]);
  assertNodes(group.children, [a, b]);
  assertNodes(branch.children, [x]);
  assert.equal(doc.parentOf('branch'), undefined);
});

test('grouping whole subtrees preserves nested identities, geometry and explicit styles', () => {
  const doc = new SvgDocument();
  const leaf = new RectShape('leaf', 1, 2, 3, 4, 'red');
  leaf.setAttribute('stroke-width', 2);
  const nested = new GroupShape('nested', [leaf]);
  nested.setAttribute('fill', 'blue');
  const text = new TextShape('text', 5, 6, 'hello');
  doc.insert(nested);
  doc.insert(text);
  const before = [leaf, nested, text].map(shape => shape.getAttributes());
  const group = doc.group('new', ['text', 'nested']);
  assertNodes(group.children, [nested, text]);
  assertNodes(nested.children, [leaf]);
  assert.deepEqual([leaf, nested, text].map(shape => shape.getAttributes()), before);
  assert.equal(doc.findById('leaf'), leaf);
  assert.equal(TreeOwnership.ownerOf(leaf), nested);
  assert.equal(TreeOwnership.ownerOf(nested), group);
  assert.deepEqual(group.getAttributes(), { id: 'new' });
  const copy = doc.clone();
  assert.notEqual(copy.findById('leaf'), leaf);
  assert.deepEqual(copy.findById('leaf')!.getAttributes(), leaf.getAttributes());
});

test('new group ids are case-sensitive', () => {
  const doc = new SvgDocument();
  const a = new GroupShape('a');
  doc.insert(a);
  const group = doc.group('A', ['a']);
  assert.equal(doc.findById('a'), a);
  assert.equal(doc.findById('A'), group);
});

const failures = [
  { name: 'duplicate new id', newId: 'leaf', ids: ['other'], message: /id already exists: leaf/ },
  { name: 'duplicate selection', newId: 'new', ids: ['leaf', 'leaf'], message: /duplicate selection/ },
  { name: 'missing late target', newId: 'new', ids: ['other', 'missing'], message: /no such shape/ },
  { name: 'parent and child', newId: 'new', ids: ['inner', 'leaf'], message: /cannot group a container into its own descendant: inner/ },
  { name: 'reversed ancestor and descendant', newId: 'new', ids: ['leaf', 'outer'], message: /cannot group a container into its own descendant: outer/ },
  { name: 'empty selection', newId: 'new', ids: [], message: /at least one/ },
  { name: 'empty new id', newId: '', ids: ['leaf'], message: /id must not be empty/ },
  { name: 'blank new id', newId: '  ', ids: ['leaf'], message: /id must not be empty/ },
];

for (const { name, newId, ids, message } of failures) {
  test(`group failure (${name}) leaves the complete tree, query and ownership unchanged`, () => {
    const doc = new SvgDocument();
    const leaf = new RectShape('leaf', 1, 2, 3, 4, 'red');
    const inner = new GroupShape('inner', [leaf]);
    const outer = new GroupShape('outer', [inner]);
    const other = new GroupShape('other');
    doc.insert(outer);
    doc.insert(other);
    const roots = doc.roots;
    const nodes = TreeOwnership.nodes(outer).concat(other);
    const snapshots = nodes.map(shape => ({ shape, owner: TreeOwnership.ownerOf(shape),
      children: shape.children, attributes: shape.getAttributes() }));
    assert.throws(() => doc.group(newId, ids), message);
    assert.throws(() => TreeOwnership.group(doc, newId, ids), message);
    assert.equal(doc.roots, roots);
    assert.equal(doc.findById('new'), undefined);
    for (const before of snapshots) {
      assert.equal(doc.findById(before.shape.id), before.shape);
      assert.equal(TreeOwnership.ownerOf(before.shape), before.owner);
      assertNodes(before.shape.children, before.children);
      assert.deepEqual(before.shape.getAttributes(), before.attributes);
    }
    const success = doc.group('new', ['leaf']);
    assert.equal(success.children[0], leaf);
    assert.equal(doc.findById('new'), success);
  });
}

test('direct manager grouping cannot select foreign nodes and does not affect another document', () => {
  const a = new SvgDocument();
  const b = new SvgDocument();
  const local = new GroupShape('local');
  const foreign = new GroupShape('foreign');
  a.insert(local);
  b.insert(foreign);
  assert.throws(() => TreeOwnership.group(a, 'new', ['local', 'foreign']), /no such shape/);
  assertNodes(a.roots, [local]);
  assertNodes(b.roots, [foreign]);
  assert.equal(TreeOwnership.ownerOf(local), a);
  assert.equal(TreeOwnership.ownerOf(foreign), b);
  const group = TreeOwnership.group(a, 'new', ['local']);
  assertNodes(a.roots, [group]);
  assertNodes(group.children, [local]);
  assert.equal(b.findById('foreign'), foreign);
});

test('group combines with addTo/front/back without creating duplicate ownership', () => {
  const doc = new SvgDocument();
  const a = new GroupShape('a');
  const b = new GroupShape('b');
  const c = new GroupShape('c');
  const target = new GroupShape('target', [c]);
  for (const node of [a, target, b]) doc.insert(node);
  const group = doc.group('new', ['b', 'a']);
  assertNodes(doc.roots, [group, target]);
  doc.addTo('target', 'new');
  doc.back('new');
  assertNodes(target.children, [group, c]);
  doc.front('a');
  assertNodes(group.children, [b, a]);
  doc.addTo('new', 'c');
  assertNodes(target.children, [group]);
  assertNodes(group.children, [b, a, c]);
  assert.equal(doc.parentOf('new'), target);
  for (const node of [a, b, c]) {
    assert.equal(doc.findById(node.id), node);
    assert.equal(TreeOwnership.ownerOf(node), group);
  }
  const second = doc.group('second', ['c', 'b']);
  assertNodes(group.children, [second, a]);
  assertNodes(second.children, [b, c]);
  assert.equal(TreeOwnership.ownerOf(second), group);
  assert.equal(TreeOwnership.ownerOf(a), group);
  assert.equal(TreeOwnership.ownerOf(b), second);
  assert.equal(TreeOwnership.ownerOf(c), second);
  assert.equal(doc.findById('second'), second);
  assert.throws(() => doc.addTo('second', 'new'), /cycle/);
  assertNodes(doc.roots, [target]);
});
