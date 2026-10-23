import assert from 'node:assert/strict';
import test from 'node:test';
import type { Shape } from '../src/domain/Shape.js';
import { SvgDocument } from '../src/domain/SvgDocument.js';
import { GroupShape } from '../src/domain/GroupShape.js';
import { RectShape } from '../src/domain/RectShape.js';
import { TreeOwnership } from '../src/domain/TreeOwnership.js';

function assertNodes(actual: readonly Shape[], expected: readonly Shape[]): void {
  assert.deepEqual(actual.map(node => node.id), expected.map(node => node.id));
  expected.forEach((node, index) => assert.equal(actual[index], node));
}

function assertConsistent(document: SvgDocument): void {
  const objects = new Set<Shape>();
  const ids = new Set<string>();
  const visit = (node: Shape, parent: Shape | SvgDocument): void => {
    assert.equal(objects.has(node), false);
    assert.equal(ids.has(node.id), false);
    objects.add(node);
    ids.add(node.id);
    assert.equal(TreeOwnership.ownerOf(node), parent);
    assert.equal(document.findById(node.id), node);
    assert.equal(document.parentOf(node.id), parent === document ? undefined : parent);
    for (const child of node.children) visit(child, node);
  };
  for (const root of document.roots) visit(root, document);
}

test('reparent, reorder, reparent again, delete containers and reinsert across documents', () => {
  const doc = new SvgDocument();
  const x = new RectShape('x', 1, 2, 3, 4);
  const y = new RectShape('y', 5, 6, 7, 8);
  const subtree = new GroupShape('subtree', [x, y]);
  const stay = new GroupShape('stay');
  const inner = new GroupShape('inner', [stay, subtree]);
  const left = new GroupShape('left', [inner]);
  const r0 = new GroupShape('r0');
  const r1 = new GroupShape('r1');
  const right = new GroupShape('right', [r0, r1]);
  const keep = new RectShape('keep', 0, 0, 1, 1);
  for (const shape of [left, right, keep]) doc.insert(shape);
  const attributes = [x, y, keep].map(shape => shape.getAttributes());
  assertConsistent(doc);

  doc.addTo('right', 'subtree');
  assertNodes(inner.children, [stay]);
  assertNodes(right.children, [r0, r1, subtree]);
  assertConsistent(doc);
  doc.front('x');
  assertNodes(subtree.children, [y, x]);
  assertConsistent(doc);
  doc.back('x');
  assertNodes(subtree.children, [x, y]);
  assertConsistent(doc);
  doc.front('r0');
  assertNodes(right.children, [r1, subtree, r0]);
  assertConsistent(doc);
  doc.back('subtree');
  assertNodes(right.children, [subtree, r1, r0]);
  assertConsistent(doc);

  doc.addTo('inner', 'subtree');
  assertNodes(inner.children, [stay, subtree]);
  assertNodes(right.children, [r1, r0]);
  assertConsistent(doc);
  assert.equal(doc.remove('right'), right);
  assertNodes(doc.roots, [left, keep]);
  assertConsistent(doc);
  for (const id of ['right', 'r0', 'r1']) assert.equal(doc.findById(id), undefined);
  assert.equal(TreeOwnership.ownerOf(right), undefined);
  assert.equal(TreeOwnership.ownerOf(r0), right);
  assert.equal(TreeOwnership.ownerOf(r1), right);
  assert.equal(doc.findById('subtree'), subtree);
  const before = inner.children;
  assert.throws(() => doc.addTo('right', 'subtree'), /no such container/);
  assert.equal(inner.children, before);
  assertConsistent(doc);

  assert.equal(doc.remove('left'), left);
  assertNodes(doc.roots, [keep]);
  assertConsistent(doc);
  for (const id of ['left', 'inner', 'stay', 'subtree', 'x', 'y']) {
    assert.equal(doc.findById(id), undefined);
  }
  assert.equal(TreeOwnership.ownerOf(left), undefined);
  assert.equal(TreeOwnership.ownerOf(subtree), inner);
  assert.equal(TreeOwnership.ownerOf(x), subtree);
  const other = new SvgDocument();
  other.insert(left);
  assertConsistent(other);
  assert.equal(other.findById('x'), x);
  assert.equal(doc.findById('x'), undefined);
  assert.deepEqual([x, y, keep].map(shape => shape.getAttributes()), attributes);
});
