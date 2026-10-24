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

function assertConsistent(document: SvgDocument): void {
  const objects = new Set<Shape>();
  const ids = new Set<string>();
  const visit = (node: Shape, owner: Shape | SvgDocument): void => {
    assert.equal(objects.has(node), false);
    assert.equal(ids.has(node.id), false);
    objects.add(node);
    ids.add(node.id);
    assert.equal(TreeOwnership.ownerOf(node), owner);
    assert.equal(document.findById(node.id), node);
    assert.equal(document.parentOf(node.id), owner === document ? undefined : owner);
    for (const child of node.children) visit(child, node);
  };
  for (const root of document.roots) visit(root, document);
}

for (const position of [0, 1, 2]) {
  for (const count of [0, 1, 3]) {
    test(`ungroup at sibling index ${position} promotes ${count} children with identity and attributes intact`, () => {
      const doc = new SvgDocument();
      const children = Array.from({ length: count }, (_, i) => new RectShape(`r${i}`, i, -i, i + 1, i + 2, 'red'));
      for (const child of children) {
        child.move(2, 3);
        child.scale(1.5);
        child.setAttribute('stroke-width', 2);
      }
      const group = new GroupShape('group', children);
      group.setAttribute('fill', 'blue');
      const a = new TextShape('a', 1, 2, 'unchanged');
      const b = new GroupShape('b');
      const siblings: Shape[] = [a, b];
      siblings.splice(position, 0, group);
      const parent = new GroupShape('parent', siblings);
      const tail = new GroupShape('tail');
      doc.insert(parent);
      doc.insert(tail);
      const roots = doc.roots;
      const oldParent = parent.children;
      const oldChildren = group.children;
      const all = [parent, group, a, b, tail, ...children];
      const attributes = all.map(node => node.getAttributes());
      assert.equal(doc.ungroup('group'), group);
      const expected = [...siblings];
      expected.splice(position, 1, ...children);
      assertNodes(parent.children, expected);
      assert.equal(doc.roots, roots);
      assertNodes(oldParent, siblings);
      assertNodes(oldChildren, children);
      assertNodes(group.children, []);
      assert.equal(Object.isFrozen(group.children), true);
      assert.equal(TreeOwnership.ownerOf(group), undefined);
      assert.equal(doc.findById('group'), undefined);
      assert.deepEqual(all.map(node => node.getAttributes()), attributes);
      assertConsistent(doc);
    });
  }
}

test('ungroup dissolves only the requested layer and preserves deeper member arrays', () => {
  const leaf = new RectShape('leaf', 1, 2, 3, 4);
  const text = new TextShape('text', 5, 6, 'hello');
  const inner = new GroupShape('inner', [leaf, text]);
  inner.setAttribute('stroke', 'green');
  const target = new GroupShape('target', [inner]);
  const parent = new GroupShape('parent', [target]);
  const outer = new GroupShape('outer', [parent]);
  const doc = new SvgDocument();
  doc.insert(outer);
  const innerChildren = inner.children;
  const outerChildren = outer.children;
  const attributes = [outer, parent, target, inner, leaf, text].map(node => node.getAttributes());
  TreeOwnership.ungroup(doc, 'target');
  assertNodes(parent.children, [inner]);
  assert.equal(inner.children, innerChildren);
  assert.equal(outer.children, outerChildren);
  assertNodes(inner.children, [leaf, text]);
  assertNodes(target.children, []);
  assert.equal(TreeOwnership.ownerOf(target), undefined);
  assert.deepEqual([outer, parent, target, inner, leaf, text].map(node => node.getAttributes()), attributes);
  assertConsistent(doc);
});

for (const failure of [
  { id: 'root', message: /cannot ungroup top-level container: root/ },
  { id: 'emptyRoot', message: /cannot ungroup top-level container: emptyRoot/ },
  { id: 'leaf', message: /not a container: leaf/ },
  { id: 'missing', message: /no such shape: missing/ },
]) {
  test(`failed ungroup of ${failure.id} preserves the complete tree and ownership`, () => {
    const leaf = new RectShape('leaf', 1, 2, 3, 4, 'red');
    const inner = new GroupShape('inner', [leaf]);
    const root = new GroupShape('root', [inner]);
    const emptyRoot = new GroupShape('emptyRoot');
    const doc = new SvgDocument(123, 456);
    doc.insert(root);
    doc.insert(emptyRoot);
    const roots = doc.roots;
    const snapshots = [root, inner, leaf, emptyRoot].map(node => ({
      node, children: node.children, owner: TreeOwnership.ownerOf(node), attributes: node.getAttributes(),
    }));
    assert.throws(() => doc.ungroup(failure.id), failure.message);
    assert.throws(() => TreeOwnership.ungroup(doc, failure.id), failure.message);
    assert.equal(doc.roots, roots);
    assert.equal(doc.width, 123);
    assert.equal(doc.height, 456);
    for (const before of snapshots) {
      assert.equal(doc.findById(before.node.id), before.node);
      assert.equal(TreeOwnership.ownerOf(before.node), before.owner);
      assertNodes(before.node.children, before.children);
      if (before.node instanceof GroupShape) assert.equal(before.node.children, before.children);
      assert.deepEqual(before.node.getAttributes(), before.attributes);
    }
    assert.equal(doc.findById('missing'), undefined);
    assertConsistent(doc);
    doc.ungroup('inner');
    assertNodes(root.children, [leaf]);
    assertConsistent(doc);
  });
}

test('dissolved group is reusable as an independent empty group without reclaiming promoted nodes', () => {
  const leaf = new RectShape('leaf', 1, 2, 3, 4);
  const group = new GroupShape('group', [leaf]);
  group.setAttribute('fill', 'blue');
  const parent = new GroupShape('parent', [group]);
  const doc = new SvgDocument();
  doc.insert(parent);
  doc.ungroup('group');
  assert.throws(() => doc.ungroup('group'), /no such shape/);
  const other = new SvgDocument();
  other.insert(group);
  assertNodes(group.children, []);
  assert.equal(group.getAttribute('fill'), 'blue');
  assert.throws(() => TreeOwnership.initializeGroup(group, [leaf]), /already initialized/);
  assert.throws(() => TreeOwnership.insert(other, leaf, 'group'), /already belongs/);
  assert.equal(other.findById('leaf'), undefined);
  assert.equal(doc.findById('leaf'), leaf);
  assertConsistent(doc);
  assertConsistent(other);
});

test('direct ungroup cannot affect a foreign document and resolves local case-sensitive ids', () => {
  const foreign = new GroupShape('target', [new GroupShape('child')]);
  const foreignParent = new GroupShape('foreignParent', [foreign]);
  const other = new SvgDocument();
  other.insert(foreignParent);
  const doc = new SvgDocument();
  assert.throws(() => TreeOwnership.ungroup(doc, 'target'), /no such shape/);
  const target = new GroupShape('target');
  const upper = new GroupShape('Target');
  const parent = new GroupShape('parent', [target, upper]);
  doc.insert(parent);
  TreeOwnership.ungroup(doc, 'target');
  assertNodes(parent.children, [upper]);
  assertNodes(foreign.children, [other.findById('child')!]);
  assert.equal(TreeOwnership.ownerOf(foreign), foreignParent);
  assertConsistent(doc);
  assertConsistent(other);
});

test('ungroup composes with reparenting, ordering, grouping, deletion and independent cloning', () => {
  const a = new RectShape('a', 1, 2, 3, 4, 'red');
  const b = new TextShape('b', 5, 6, 'hello');
  const target = new GroupShape('target', [a, b]);
  const receiver = new GroupShape('receiver');
  const parent = new GroupShape('parent', [target, receiver]);
  const doc = new SvgDocument();
  doc.insert(parent);
  const attributes = [a, b].map(node => node.getAttributes());
  doc.ungroup('target');
  assertConsistent(doc);
  doc.addTo('receiver', 'a');
  assertConsistent(doc);
  doc.addTo('receiver', 'b');
  doc.back('b');
  assertNodes(receiver.children, [b, a]);
  assertConsistent(doc);
  doc.front('b');
  assertNodes(receiver.children, [a, b]);
  assertConsistent(doc);
  const combined = doc.group('combined', ['b', 'a']);
  assertNodes(combined.children, [a, b]);
  assertConsistent(doc);
  doc.ungroup('combined');
  assertNodes(receiver.children, [a, b]);
  const copy = doc.clone();
  assertConsistent(copy);
  for (const node of [parent, receiver, a, b]) {
    assert.notEqual(copy.findById(node.id), node);
    assert.deepEqual(copy.findById(node.id)!.getAttributes(), node.getAttributes());
  }
  copy.findById('a')!.move(100, 100);
  assert.deepEqual([a, b].map(node => node.getAttributes()), attributes);
  assert.equal(doc.remove('receiver'), receiver);
  assert.equal(doc.findById('a'), undefined);
  assert.equal(doc.findById('b'), undefined);
  assertConsistent(doc);
  const other = new SvgDocument();
  other.insert(receiver);
  assertConsistent(other);
  assert.equal(other.findById('a'), a);
  doc.insert(target, 'parent');
  assertNodes(target.children, []);
  assertConsistent(doc);
});

test('ungroup after cross-parent grouping promotes into the current parent instead of restoring old parents', () => {
  const a = new RectShape('a', 1, 2, 3, 4);
  const b = new RectShape('b', 5, 6, 7, 8);
  const left = new GroupShape('left', [a]);
  const right = new GroupShape('right', [b]);
  const parent = new GroupShape('parent', [left, right]);
  const doc = new SvgDocument();
  doc.insert(parent);
  const attributes = [a, b].map(node => node.getAttributes());
  const group = doc.group('combined', ['b', 'a']);
  assertNodes(parent.children, [group, left, right]);
  doc.ungroup('combined');
  assertNodes(parent.children, [a, b, left, right]);
  assertNodes(left.children, []);
  assertNodes(right.children, []);
  assertNodes(group.children, []);
  assert.deepEqual([a, b].map(node => node.getAttributes()), attributes);
  assertConsistent(doc);
});
