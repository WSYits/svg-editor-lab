import assert from 'node:assert/strict';
import test from 'node:test';
import { SvgDocument } from '../src/domain/SvgDocument.js';
import { GroupShape } from '../src/domain/GroupShape.js';
import { RectShape } from '../src/domain/RectShape.js';
import type { Shape } from '../src/domain/Shape.js';
import { TreeOwnership } from '../src/domain/TreeOwnership.js';

function assertNodes(actual: readonly Shape[], expected: readonly Shape[]): void {
  assert.deepEqual(actual.map(node => node.id), expected.map(node => node.id));
  expected.forEach((node, index) => assert.equal(actual[index], node));
}

for (const operation of ['front', 'back'] as const) {
  for (const nested of [false, true]) {
    test(`${operation} changes only the selected ${nested ? 'nested' : 'root'} sibling position`, () => {
      const doc = new SvgDocument();
      const a = new GroupShape('a');
      const leaf = new RectShape('leaf', 1, 2, 3, 4, 'red');
      const moving = new GroupShape('moving', [leaf]);
      const b = new GroupShape('b');
      const c = new GroupShape('c');
      const parent = new GroupShape('parent');
      if (nested) doc.insert(parent);
      for (const shape of [a, moving, b, c]) doc.insert(shape, nested ? 'parent' : undefined);
      const before = nested ? parent.children : doc.roots;
      const leafBefore = leaf.getAttributes();
      const ownerBefore = TreeOwnership.ownerOf(moving);
      doc[operation]('moving');
      assertNodes(nested ? parent.children : doc.roots,
        operation === 'front' ? [a, b, c, moving] : [moving, a, b, c]);
      assertNodes(before, [a, moving, b, c]);
      if (nested) assertNodes(doc.roots, [parent]);
      assert.equal(doc.findById('moving'), moving);
      assert.equal(doc.findById('leaf'), leaf);
      assert.equal(TreeOwnership.ownerOf(moving), ownerBefore);
      assert.equal(doc.parentOf('moving'), nested ? parent : undefined);
      assert.equal(doc.parentOf('leaf'), moving);
      assert.equal(moving.children[0], leaf);
      assert.deepEqual(leaf.getAttributes(), leafBefore);
    });
  }

  test(`${operation} accepts an already-positioned node and a single sibling`, () => {
    const doc = new SvgDocument();
    const only = new GroupShape('only');
    doc.insert(only);
    const singleton = doc.roots;
    doc[operation]('only');
    assert.equal(doc.roots, singleton);
    const other = new GroupShape('other');
    doc.insert(other);
    const id = operation === 'front' ? 'other' : 'only';
    const before = doc.roots;
    TreeOwnership[operation](doc, id);
    assert.equal(doc.roots, before);
    assert.equal(TreeOwnership.ownerOf(only), doc);
    assert.equal(TreeOwnership.ownerOf(other), doc);
  });

  test(`${operation} rejects missing ids without changing any snapshot or ownership`, () => {
    const doc = new SvgDocument();
    const leaf = new RectShape('leaf', 1, 2, 3, 4);
    const group = new GroupShape('g', [leaf]);
    doc.insert(group);
    const roots = doc.roots;
    const children = group.children;
    const attributes = leaf.getAttributes();
    assert.throws(() => doc[operation]('missing'), /no such shape: missing/);
    assert.throws(() => TreeOwnership[operation](doc, 'missing'), /no such shape: missing/);
    assert.equal(doc.roots, roots);
    assert.equal(group.children, children);
    assert.equal(doc.findById('leaf'), leaf);
    assert.equal(TreeOwnership.ownerOf(leaf), group);
    assert.equal(TreeOwnership.ownerOf(group), doc);
    assert.deepEqual(leaf.getAttributes(), attributes);
  });

  test(`direct manager ${operation} sorts leaves with the same document checks`, () => {
    const doc = new SvgDocument();
    const a = new RectShape('a', 1, 2, 3, 4);
    const b = new RectShape('b', 1, 2, 3, 4);
    const c = new RectShape('c', 1, 2, 3, 4);
    for (const node of [a, b, c]) doc.insert(node);
    TreeOwnership[operation](doc, 'b');
    assertNodes(doc.roots, operation === 'front' ? [a, c, b] : [b, a, c]);
    assert.equal(doc.findById('b'), b);
    assert.equal(TreeOwnership.ownerOf(b), doc);
    const other = new SvgDocument();
    assert.throws(() => TreeOwnership[operation](other, 'b'), /no such shape/);
    assertNodes(other.roots, []);
  });
}

test('reparenting and sibling ordering compose without changing ids, attributes or subtree links', () => {
  const doc = new SvgDocument();
  const a = new GroupShape('a');
  const leaf = new RectShape('leaf', 1, 2, 3, 4);
  const subtree = new GroupShape('subtree', [leaf]);
  const b = new GroupShape('b');
  const target = new GroupShape('target', [a, b]);
  doc.insert(subtree);
  doc.insert(target);
  doc.addTo('target', 'subtree');
  doc.back('subtree');
  assertNodes(target.children, [subtree, a, b]);
  doc.front('a');
  assertNodes(target.children, [subtree, b, a]);
  doc.addTo('target', 'subtree');
  assertNodes(target.children, [b, a, subtree]);
  assertNodes(doc.roots, [target]);
  assert.equal(doc.findById('leaf'), leaf);
  assert.equal(doc.parentOf('leaf'), subtree);
  assert.equal(doc.parentOf('subtree'), target);
  assert.deepEqual(leaf.getAttributes(), { id: 'leaf', x: 1, y: 2, width: 3, height: 4 });
  assert.throws(() => doc.insert(subtree.clone()), /id already exists/);
});
