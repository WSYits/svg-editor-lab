import assert from 'node:assert/strict';
import test from 'node:test';
import { GroupShape } from '../src/domain/GroupShape.js';
import { RectShape } from '../src/domain/RectShape.js';
import { SvgDocument } from '../src/domain/SvgDocument.js';
import { TreeOwnership } from '../src/domain/TreeOwnership.js';
import * as ownershipExports from '../src/domain/TreeOwnership.js';

test('public structure entry cannot append a group to itself', () => {
  const group = new GroupShape('g');
  assert.equal('treeMutation' in ownershipExports, false);
  assert.equal('appendChild' in group, false);
  assert.throws(() => TreeOwnership.initializeGroup(group, [group]), /already initialized/);
  const doc = new SvgDocument();
  doc.insert(group);
  assert.throws(() => TreeOwnership.insert(doc, group, 'g'), /cycle/);
  assert.deepEqual(doc.roots, [group]);
  assert.deepEqual(group.children, []);
});

test('public structure entry cannot bypass document id uniqueness', () => {
  const doc = new SvgDocument();
  const group = new GroupShape('g');
  const first = new RectShape('same', 0, 0, 1, 1);
  doc.insert(group);
  doc.insert(first);
  const clone = first.clone();
  assert.equal('appendChild' in group, false);
  assert.throws(() => TreeOwnership.insert(doc, clone, 'g'), /id already exists/);
  assert.deepEqual(group.children, []);
  assert.equal(doc.findById('same'), first);
  assert.equal(TreeOwnership.ownerOf(clone), undefined);
  const other = new SvgDocument();
  other.insert(clone);
  assert.equal(other.findById('same'), clone);
});

test('public ownership entry cannot detach registration without removing membership', () => {
  const a = new SvgDocument();
  const b = new SvgDocument();
  const leaf = new RectShape('r', 0, 0, 1, 1);
  a.insert(leaf);
  assert.equal('release' in TreeOwnership, false);
  assert.equal('claim' in TreeOwnership, false);
  assert.throws(() => TreeOwnership.initializeDocument(a), /already initialized/);
  assert.throws(() => TreeOwnership.insert(b, leaf), /already belongs/);
  assert.equal(a.findById('r'), leaf);
  assert.equal(b.findById('r'), undefined);
  assert.equal(TreeOwnership.ownerOf(leaf), a);
  assert.equal(TreeOwnership.remove(a, 'r'), leaf);
  TreeOwnership.insert(b, leaf);
  assert.equal(a.findById('r'), undefined);
  assert.equal(b.findById('r'), leaf);
  assert.equal(TreeOwnership.ownerOf(leaf), b);
});

test('reinitializing an existing group cannot clear members or claim fresh nodes', () => {
  const child = new RectShape('child', 0, 0, 1, 1);
  const group = new GroupShape('g', [child]);
  const doc = new SvgDocument();
  doc.insert(group);
  const fresh = new GroupShape('fresh');
  assert.throws(() => TreeOwnership.initializeGroup(group, [fresh]), /already initialized/);
  assert.deepEqual(group.children, [child]);
  assert.equal(doc.findById('child'), child);
  assert.equal(TreeOwnership.ownerOf(child), group);
  assert.equal(TreeOwnership.ownerOf(fresh), undefined);
  assert.throws(() => TreeOwnership.remove(doc, 'missing'), /no such shape/);
  assert.deepEqual(group.children, [child]);
});

test('whole root subtree can be deleted and reinserted with internal ownership intact', () => {
  const child = new RectShape('r', 1, 2, 3, 4);
  const inner = new GroupShape('inner', [child]);
  const root = new GroupShape('root', [inner]);
  const doc = new SvgDocument();
  doc.insert(root);
  const removed = doc.remove('root');
  assert.equal(removed, root);
  assert.deepEqual(doc.roots, []);
  for (const id of ['root', 'inner', 'r']) assert.equal(doc.findById(id), undefined);
  assert.equal(TreeOwnership.ownerOf(root), undefined);
  assert.equal(TreeOwnership.ownerOf(inner), root);
  assert.equal(TreeOwnership.ownerOf(child), inner);
  doc.insert(removed);
  assert.equal(doc.findById('r'), child);
  assert.equal(doc.parentOf('inner'), root);
  assert.equal(doc.parentOf('r'), inner);
});

test('independent deep group clone inserts without sharing nodes or ownership', () => {
  const original = new GroupShape('g', [new GroupShape('nested', [new RectShape('r', 1, 2, 3, 4)])]);
  original.move(1, 2);
  const copy = original.clone();
  const doc = new SvgDocument();
  doc.insert(copy);
  const originalLeaf = original.children[0]!.children[0]!;
  const copiedLeaf = doc.findById('r')!;
  assert.notEqual(copiedLeaf, originalLeaf);
  assert.deepEqual(copiedLeaf.getAttributes(), originalLeaf.getAttributes());
  assert.equal(TreeOwnership.ownerOf(original), undefined);
  assert.equal(TreeOwnership.ownerOf(copy), doc);
  copy.scale(2);
  assert.equal(originalLeaf.getAttribute('x'), 2);
  const originalDoc = new SvgDocument();
  originalDoc.insert(original);
  assert.equal(originalDoc.findById('r'), originalLeaf);
});

test('clone insertion conflict leaves both original document and clone usable', () => {
  const doc = new SvgDocument();
  const original = new GroupShape('g', [new RectShape('r', 1, 2, 3, 4)]);
  doc.insert(original);
  const copy = original.clone();
  const copiedLeaf = copy.children[0]!;
  const before = copiedLeaf.getAttributes();
  assert.throws(() => doc.insert(copy), /id already exists/);
  assert.deepEqual(doc.roots, [original]);
  assert.equal(doc.findById('r'), original.children[0]);
  assert.equal(TreeOwnership.ownerOf(copy), undefined);
  assert.equal(TreeOwnership.ownerOf(copiedLeaf), copy);
  assert.deepEqual(copiedLeaf.getAttributes(), before);
  copy.move(1, 1);
  const other = new SvgDocument();
  other.insert(copy);
  assert.equal(other.findById('r'), copiedLeaf);
});

test('direct coordinator access rejects ancestor cycles and preserves frozen snapshots', () => {
  const inner = new GroupShape('inner');
  const root = new GroupShape('root', [inner]);
  const doc = new SvgDocument();
  TreeOwnership.insert(doc, root);
  const roots = TreeOwnership.childrenOf(doc);
  const children = TreeOwnership.childrenOf(root);
  assert.throws(() => TreeOwnership.insert(doc, root, 'inner'), /cycle/);
  assert.throws(() => Object.assign(roots, { 0: inner }), TypeError);
  assert.throws(() => Object.assign(children, { 0: root }), TypeError);
  assert.deepEqual(doc.roots, [root]);
  assert.deepEqual(root.children, [inner]);
  assert.deepEqual(inner.children, []);
  assert.equal(doc.parentOf('inner'), root);
  assert.equal(TreeOwnership.ownerOf(root), doc);
});
