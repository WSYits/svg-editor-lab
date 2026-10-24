import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorSession } from '../src/application/EditorSession.js';
import { SvgDocument } from '../src/domain/SvgDocument.js';
import { GroupShape } from '../src/domain/GroupShape.js';
import { RectShape } from '../src/domain/RectShape.js';
import { TextShape } from '../src/domain/TextShape.js';
import { TreeOwnership } from '../src/domain/TreeOwnership.js';

function fixture(): SvgDocument {
  const doc = new SvgDocument(400.5, 300.25);
  const rect = new RectShape('r', 1, 2, 3, 4, 'red');
  const text = new TextShape('t', 5, 6, 'edited');
  text.setAttribute('stroke-width', 2);
  const inner = new GroupShape('inner', [text]);
  const outer = new GroupShape('outer', [rect, inner]);
  outer.setAttribute('fill', 'blue');
  outer.move(1, 2);
  doc.insert(outer);
  doc.insert(new GroupShape('last'));
  return doc;
}

function assertCopy(actual: SvgDocument, expected: SvgDocument): void {
  assert.notEqual(actual, expected);
  assert.deepEqual([actual.width, actual.height], [expected.width, expected.height]);
  assert.deepEqual(actual.roots.map(n => n.id), expected.roots.map(n => n.id));
  for (const root of expected.roots) {
    for (const original of TreeOwnership.nodes(root)) {
      const copy = actual.findById(original.id)!;
      assert.notEqual(copy, original);
      assert.equal(copy.constructor, original.constructor);
      assert.deepEqual(copy.getAttributes(), original.getAttributes());
      assert.deepEqual(copy.children.map(n => n.id), original.children.map(n => n.id));
      const parent = expected.parentOf(original.id);
      assert.equal(TreeOwnership.ownerOf(copy), parent ? actual.findById(parent.id) : actual);
      assert.equal(actual.parentOf(copy.id), parent ? actual.findById(parent.id) : undefined);
    }
  }
}

test('empty session has neither document nor default path', () => {
  const session = new EditorSession();
  assert.equal(session.hasDocument, false);
  assert.equal(session.defaultSavePath, undefined);
  assert.equal(session.getDocumentSnapshot(), undefined);
});

for (const path of [undefined, 'folder/input.svg']) {
  test(`session with document ${path === undefined ? 'without' : 'with'} default path is isolated`, () => {
    const doc = fixture();
    const session = new EditorSession(doc, path);
    assert.equal(session.hasDocument, true);
    assert.equal(session.defaultSavePath, path);
    const first = session.getDocumentSnapshot()!;
    const second = session.getDocumentSnapshot()!;
    assertCopy(first, doc);
    assertCopy(second, first);
    assert.equal(first.findById('r')!.getAttribute('stroke'), undefined);
    assert.equal(Object.hasOwn(first.findById('r')!.getAttributes(), 'stroke'), false);
  });
}

test('mutating an input document after construction cannot change the session', () => {
  const doc = fixture();
  const session = new EditorSession(doc, 'original.svg');
  const before = session.getDocumentSnapshot()!;
  doc.findById('t')!.setAttribute('text', 'external');
  doc.findById('outer')!.move(20, 30);
  doc.front('r');
  doc.ungroup('inner');
  doc.resize(1, 2);
  doc.remove('last');
  assertCopy(session.getDocumentSnapshot()!, before);
  assert.equal(session.defaultSavePath, 'original.svg');
});

test('mutating an output snapshot cannot change the session or other snapshots', () => {
  const session = new EditorSession(fixture(), 'original.svg');
  const baseline = session.getDocumentSnapshot()!;
  const output = session.getDocumentSnapshot()!;
  output.findById('outer')!.scale(2);
  output.findById('t')!.setAttribute('text', 'output');
  output.addTo('last', 'inner');
  output.resize(1, 2);
  output.remove('outer');
  assertCopy(session.getDocumentSnapshot()!, baseline);
  assert.equal(session.defaultSavePath, 'original.svg');
});

test('preparing a replacement session does not modify the original session', () => {
  const original = new EditorSession(fixture(), 'old.svg');
  const candidate = original.getDocumentSnapshot()!;
  const baseline = original.getDocumentSnapshot()!;
  candidate.findById('t')!.setAttribute('text', 'next');
  const next = new EditorSession(candidate, 'next.svg');
  candidate.remove('outer');
  assertCopy(original.getDocumentSnapshot()!, baseline);
  assert.equal(original.defaultSavePath, 'old.svg');
  assert.equal(next.defaultSavePath, 'next.svg');
  assert.equal(next.getDocumentSnapshot()!.findById('t')!.getAttribute('text'), 'next');
  assert.equal(new EditorSession().defaultSavePath, undefined);
});

test('a path without a document is rejected without affecting an existing session', () => {
  const original = new EditorSession(fixture(), 'old.svg');
  const before = original.getDocumentSnapshot()!;
  assert.throws(() => new EditorSession(undefined, 'orphan.svg'), /requires a document/);
  assertCopy(original.getDocumentSnapshot()!, before);
  assert.equal(original.defaultSavePath, 'old.svg');
});

test('failed replacement snapshot construction leaves existing session and input ownership intact', t => {
  const original = new EditorSession(fixture(), 'old.svg');
  const before = original.getDocumentSnapshot()!;
  const input = fixture();
  const root = input.roots[0]!;
  t.mock.method(input, 'clone', () => { throw new Error('snapshot failure'); });
  assert.throws(() => new EditorSession(input, 'new.svg'), /snapshot failure/);
  assert.equal(input.roots[0], root);
  assert.equal(TreeOwnership.ownerOf(root), input);
  assertCopy(original.getDocumentSnapshot()!, before);
  assert.equal(original.defaultSavePath, 'old.svg');
});

test('failed output snapshot preparation does not damage the session', t => {
  const session = new EditorSession(fixture(), 'old.svg');
  const before = session.getDocumentSnapshot()!;
  const spy = t.mock.method(SvgDocument.prototype, 'clone', () => { throw new Error('snapshot failure'); });
  assert.throws(() => session.getDocumentSnapshot(), /snapshot failure/);
  assert.equal(session.hasDocument, true);
  assert.equal(session.defaultSavePath, 'old.svg');
  spy.mock.restore();
  assertCopy(session.getDocumentSnapshot()!, before);
});
