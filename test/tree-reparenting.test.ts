import assert from 'node:assert/strict';
import test from 'node:test';
import { SvgDocument } from '../src/domain/SvgDocument.js';
import { GroupShape } from '../src/domain/GroupShape.js';
import { RectShape } from '../src/domain/RectShape.js';
import { TextShape } from '../src/domain/TextShape.js';
import type { Shape } from '../src/domain/Shape.js';
import { TreeOwnership } from '../src/domain/TreeOwnership.js';

function assertNodes(actual: readonly Shape[], expected: readonly Shape[]): void {
  assert.deepEqual(actual.map(node => node.id), expected.map(node => node.id));
  expected.forEach((node, index) => assert.equal(actual[index], node));
}

test('addTo moves a root to the group end without cloning or changing unrelated roots', () => {
  const doc = new SvgDocument();
  const a = new RectShape('a', 1, 2, 3, 4, 'red');
  const b = new GroupShape('b');
  const existing = new TextShape('t', 5, 6, 'text');
  const target = new GroupShape('g', [existing]);
  const last = new GroupShape('last');
  for (const shape of [b, a, target, last]) doc.insert(shape);
  const rootsBefore = doc.roots;
  const childrenBefore = target.children;
  const attributes = a.getAttributes();
  doc.addTo('g', 'a');
  assertNodes(doc.roots, [b, target, last]);
  assertNodes(target.children, [existing, a]);
  assert.equal(target.children[1], a);
  assert.equal(doc.findById('a'), a);
  assert.equal(doc.parentOf('a'), target);
  assert.equal(TreeOwnership.ownerOf(a), target);
  assert.deepEqual(a.getAttributes(), attributes);
  assertNodes(rootsBefore, [b, a, target, last]);
  assertNodes(childrenBefore, [existing]);
  assert.throws(() => doc.insert(a), /already belongs/);
});

test('addTo between groups preserves both sibling orders and retains empty source groups', () => {
  const doc = new SvgDocument();
  const a = new GroupShape('a');
  const moving = new RectShape('moving', 1, 2, 3, 4);
  const b = new GroupShape('b');
  const source = new GroupShape('source', [a, moving, b]);
  const t = new GroupShape('t');
  const target = new GroupShape('target', [t]);
  doc.insert(source);
  doc.insert(target);
  doc.addTo('target', 'moving');
  assertNodes(source.children, [a, b]);
  assertNodes(target.children, [t, moving]);
  assert.equal(doc.parentOf('moving'), target);
  doc.addTo('target', 'a');
  doc.addTo('target', 'b');
  assertNodes(source.children, []);
  assertNodes(target.children, [t, moving, a, b]);
  assert.equal(doc.findById('source'), source);
  assertNodes(doc.roots, [source, target]);
});

test('whole nested subtree moves to an ancestor group retaining all descendant identities', () => {
  const doc = new SvgDocument();
  const leaf = new TextShape('leaf', 1, 2, 'unchanged');
  const nested = new GroupShape('nested', [leaf]);
  const subtree = new GroupShape('subtree', [nested]);
  const oldParent = new GroupShape('oldParent', [subtree]);
  const root = new GroupShape('root', [oldParent]);
  doc.insert(root);
  const attributes = leaf.getAttributes();
  doc.addTo('root', 'subtree');
  assertNodes(root.children, [oldParent, subtree]);
  assertNodes(oldParent.children, []);
  assertNodes(subtree.children, [nested]);
  assertNodes(nested.children, [leaf]);
  assert.equal(doc.findById('leaf'), leaf);
  assert.equal(doc.parentOf('subtree'), root);
  assert.equal(TreeOwnership.ownerOf(nested), subtree);
  assert.equal(TreeOwnership.ownerOf(leaf), nested);
  assert.deepEqual(leaf.getAttributes(), attributes);
  const copy = doc.clone();
  assert.deepEqual(copy.findById('root')!.children.map(shape => shape.id), ['oldParent', 'subtree']);
  assert.notEqual(copy.findById('leaf'), leaf);
  const removed = doc.remove('subtree');
  assert.equal(removed, subtree);
  assert.equal(doc.findById('leaf'), undefined);
  doc.insert(removed, 'oldParent');
  assert.equal(doc.findById('leaf'), leaf);
  assert.equal(doc.parentOf('subtree'), oldParent);
});

test('same-parent addTo reorders only the selected node and accepts an already-last node', () => {
  const doc = new SvgDocument();
  const a = new GroupShape('a');
  const b = new GroupShape('b');
  const c = new GroupShape('c');
  const parent = new GroupShape('parent', [a, b, c]);
  doc.insert(parent);
  doc.addTo('parent', 'a');
  assertNodes(parent.children, [b, c, a]);
  const before = parent.children;
  doc.addTo('parent', 'a');
  assert.equal(parent.children, before);
  assert.equal(TreeOwnership.ownerOf(a), parent);
  assert.equal(doc.findById('a'), a);
  const single = new GroupShape('single', [new GroupShape('only')]);
  doc.insert(single);
  doc.addTo('single', 'only');
  assert.equal(single.children[0], doc.findById('only'));
});

const failures = [
  { label: 'self', target: 'outer', id: 'outer', message: /cycle/ },
  { label: 'descendant', target: 'inner', id: 'outer', message: /cycle/ },
  { label: 'missing source', target: 'inner', id: 'missing', message: /no such shape/ },
  { label: 'missing target', target: 'missing', id: 'leaf', message: /no such container/ },
  { label: 'leaf target', target: 'leaf', id: 'other', message: /not a container/ },
];

for (const { label, target, id, message } of failures) {
  test(`failed addTo (${label}) preserves structure, ownership, attributes and references`, () => {
    const doc = new SvgDocument();
    const leaf = new RectShape('leaf', 1, 2, 3, 4, 'red');
    const inner = new GroupShape('inner', [leaf]);
    const outer = new GroupShape('outer', [inner]);
    const other = new GroupShape('other');
    doc.insert(outer);
    doc.insert(other);
    const roots = doc.roots;
    const nodes = [outer, inner, leaf, other];
    const snapshots = nodes.map(shape => ({
      shape, owner: TreeOwnership.ownerOf(shape), children: shape.children, attributes: shape.getAttributes(),
    }));
    assert.throws(() => doc.addTo(target, id), message);
    assert.throws(() => TreeOwnership.addTo(doc, target, id), message);
    assert.equal(doc.roots, roots);
    for (const before of snapshots) {
      assert.equal(doc.findById(before.shape.id), before.shape);
      assert.equal(TreeOwnership.ownerOf(before.shape), before.owner);
      assertNodes(before.shape.children, before.children);
      assert.deepEqual(before.shape.getAttributes(), before.attributes);
    }
    assert.equal(inner.children[0], leaf);
    assert.equal(doc.parentOf('inner'), outer);
    assert.equal(doc.parentOf('leaf'), inner);
  });
}

test('direct manager reparenting uses the same checks and cannot cross documents', () => {
  const a = new SvgDocument();
  const b = new SvgDocument();
  const foreign = new RectShape('foreign', 0, 0, 1, 1);
  const target = new GroupShape('target');
  a.insert(target);
  b.insert(foreign);
  assert.throws(() => TreeOwnership.addTo(a, 'target', 'foreign'), /no such shape/);
  assert.throws(() => TreeOwnership.addTo(b, 'target', 'foreign'), /no such container/);
  assertNodes(a.roots, [target]);
  assertNodes(target.children, []);
  assertNodes(b.roots, [foreign]);
  assert.equal(TreeOwnership.ownerOf(foreign), b);
  const local = new RectShape('foreign', 2, 2, 3, 3);
  a.insert(local);
  TreeOwnership.addTo(a, 'target', 'foreign');
  assert.equal(a.findById('foreign'), local);
  assert.equal(b.findById('foreign'), foreign);
  assert.equal(TreeOwnership.ownerOf(local), target);
  assert.equal(TreeOwnership.ownerOf(foreign), b);
  assert.throws(() => TreeOwnership.insert(a, foreign.clone()), /id already exists/);
});
