import assert from 'node:assert/strict';
import test from 'node:test';
import { HistoryManager } from '../src/application/HistoryManager.js';
import { SvgDocument } from '../src/domain/SvgDocument.js';
import { GroupShape } from '../src/domain/GroupShape.js';
import { RectShape } from '../src/domain/RectShape.js';
import { CircleShape } from '../src/domain/CircleShape.js';
import { EllipseShape } from '../src/domain/EllipseShape.js';
import { LineShape } from '../src/domain/LineShape.js';
import { TextShape } from '../src/domain/TextShape.js';
import { TreeOwnership } from '../src/domain/TreeOwnership.js';

function fixture(): SvgDocument {
  const doc = new SvgDocument(640.5, 480.25);
  const text = new TextShape('t', 1, 2, 'edited text');
  text.setAttribute('stroke-width', 0.5);
  const inner = new GroupShape('inner', [
    new CircleShape('c', 1, 2, 3), new EllipseShape('e', 4, 5, 6, 7, 'red'),
    new LineShape('l', 1, 2, 3, 4, 'green'), text,
  ]);
  inner.setAttribute('fill', 'blue');
  const root = new GroupShape('root', [new RectShape('r', 1, 2, 3, 4), inner, new GroupShape('empty')]);
  root.move(2, 3);
  doc.insert(root);
  doc.insert(new GroupShape('tail'));
  return doc;
}

function state(history: HistoryManager): readonly (number | boolean)[] {
  return [history.undoCount, history.redoCount, history.disabled, history.canUndo, history.canRedo];
}

function assertSnapshot(actual: SvgDocument, expected: SvgDocument): void {
  assert.notEqual(actual, expected);
  assert.deepEqual([actual.width, actual.height], [expected.width, expected.height]);
  assert.deepEqual(actual.roots.map(n => n.id), expected.roots.map(n => n.id));
  const seen = new Set<object>();
  const ids = new Set<string>();
  for (const root of expected.roots) {
    for (const source of TreeOwnership.nodes(root)) {
      const copy = actual.findById(source.id)!;
      assert.ok(copy);
      assert.equal(seen.has(copy), false);
      assert.equal(ids.has(copy.id), false);
      seen.add(copy);
      ids.add(copy.id);
      assert.notEqual(copy, source);
      assert.equal(copy.constructor, source.constructor);
      assert.deepEqual(copy.getAttributes(), source.getAttributes());
      assert.deepEqual(copy.children.map(n => n.id), source.children.map(n => n.id));
      const parent = expected.parentOf(source.id);
      const actualParent = parent ? actual.findById(parent.id) : undefined;
      assert.equal(actual.parentOf(copy.id), actualParent);
      assert.equal(TreeOwnership.ownerOf(copy), actualParent ?? actual);
    }
  }
  assert.equal(actual.roots.flatMap(n => TreeOwnership.nodes(n)).length, seen.size);
}

test('empty enabled history differs from a disabled boundary history', () => {
  const history = new HistoryManager();
  assert.deepEqual(state(history), [0, 0, false, false, false]);
  const doc = fixture();
  assert.throws(() => history.prepareUndo(doc), /^Error: nothing to undo$/);
  assert.throws(() => history.prepareRedo(doc), /^Error: nothing to redo$/);
  const boundary = history.resetBoundary();
  assert.deepEqual(state(boundary), [0, 0, true, false, false]);
  assert.throws(() => boundary.prepareUndo(doc), /undo not allowed after io command/);
  assert.throws(() => boundary.prepareRedo(doc), /undo not allowed after io command/);
  assert.deepEqual(state(history), [0, 0, false, false, false]);
});

test('recording an edit clones its input and leaves the previous history value unchanged', () => {
  const doc = fixture();
  const expected = doc.clone();
  const empty = new HistoryManager();
  const history = empty.recordEdit(doc);
  doc.findById('t')!.setAttribute('text', 'external');
  doc.ungroup('inner');
  doc.resize(1, 2);
  doc.remove('tail');
  assert.deepEqual(state(empty), [0, 0, false, false, false]);
  assert.deepEqual(state(history), [1, 0, false, true, false]);
  const restored = history.prepareUndo(doc).document;
  assertSnapshot(restored, expected);
  assert.equal(restored.findById('r')!.getAttribute('fill'), undefined);
  assert.equal(Object.hasOwn(restored.findById('r')!.getAttributes(), 'fill'), false);
});

test('two edits support ordered undo and redo without modifying any input history value', () => {
  const s0 = fixture();
  const s1 = s0.clone();
  s1.findById('r')!.move(10, 20);
  const s2 = s1.clone();
  s2.findById('t')!.setAttribute('text', 'second');
  const h0 = new HistoryManager();
  const h1 = h0.recordEdit(s0);
  const h2 = h1.recordEdit(s1);
  const u1 = h2.prepareUndo(s2);
  assertSnapshot(u1.document, s1);
  assert.deepEqual(state(u1.history), [1, 1, false, true, true]);
  const u0 = u1.history.prepareUndo(u1.document);
  assertSnapshot(u0.document, s0);
  assert.deepEqual(state(u0.history), [0, 2, false, false, true]);
  assert.throws(() => u0.history.prepareUndo(u0.document), /nothing to undo/);
  const r1 = u0.history.prepareRedo(u0.document);
  assertSnapshot(r1.document, s1);
  const r2 = r1.history.prepareRedo(r1.document);
  assertSnapshot(r2.document, s2);
  assert.deepEqual(state(r2.history), [2, 0, false, true, false]);
  assert.throws(() => r2.history.prepareRedo(r2.document), /nothing to redo/);
  assert.deepEqual(state(h0), [0, 0, false, false, false]);
  assert.deepEqual(state(h1), [1, 0, false, true, false]);
  assert.deepEqual(state(h2), [2, 0, false, true, false]);
});

test('successive captures of the same mutable input remain independent records', () => {
  const doc = fixture();
  const first = doc.clone();
  const h1 = new HistoryManager().recordEdit(doc);
  doc.front('r');
  doc.findById('t')!.setAttribute('text', 'next');
  const second = doc.clone();
  const h2 = h1.recordEdit(doc);
  doc.remove('inner');
  const u1 = h2.prepareUndo(doc);
  assertSnapshot(u1.document, second);
  const u0 = u1.history.prepareUndo(u1.document);
  assertSnapshot(u0.document, first);
  assertSnapshot(h1.prepareUndo(doc).document, first);
});

test('new edit clears redo while the old history branch stays usable', () => {
  const before = fixture();
  const after = before.clone();
  after.remove('inner');
  const history = new HistoryManager().recordEdit(before).prepareUndo(after);
  const branch = history.history.recordEdit(history.document);
  assert.deepEqual(state(branch), [1, 0, false, true, false]);
  assert.deepEqual(state(history.history), [0, 1, false, false, true]);
  assertSnapshot(history.history.prepareRedo(history.document).document, after);
});

test('boundary reset clears both stacks, and recording a valid no-change edit re-enables history', () => {
  const doc = fixture();
  const withBoth = new HistoryManager().recordEdit(doc).recordEdit(doc).prepareUndo(doc).history;
  const boundary = withBoth.resetBoundary();
  assert.deepEqual(state(withBoth), [1, 1, false, true, true]);
  assert.deepEqual(state(boundary), [0, 0, true, false, false]);
  const enabled = boundary.recordEdit(doc);
  assert.deepEqual(state(enabled), [1, 0, false, true, false]);
  const restored = enabled.prepareUndo(doc);
  assertSnapshot(restored.document, doc);
  assert.deepEqual(state(restored.history), [0, 1, false, false, true]);
  assert.throws(() => restored.history.prepareUndo(doc), /nothing to undo/);
  assert.equal(boundary.disabled, true);
});

for (const direction of ['undo', 'redo'] as const) {
  test(`${direction} output mutations cannot pollute snapshots, other transitions or future records`, () => {
    const before = fixture();
    const after = before.clone();
    after.front('r');
    after.findById('t')!.setAttribute('text', 'after');
    const saved = new HistoryManager().recordEdit(before);
    const undone = saved.prepareUndo(after);
    const history = direction === 'undo' ? saved : undone.history;
    const current = direction === 'undo' ? after : undone.document;
    const expected = direction === 'undo' ? before : after;
    const capturedCurrent = current.clone();
    const first = direction === 'undo' ? history.prepareUndo(current) : history.prepareRedo(current);
    const second = direction === 'undo' ? history.prepareUndo(current) : history.prepareRedo(current);
    assertSnapshot(first.document, expected);
    assertSnapshot(second.document, first.document);
    first.document.findById('t')!.setAttribute('text', 'output');
    first.document.ungroup('inner');
    first.document.resize(1, 2);
    assertSnapshot(second.document, expected);
    const again = direction === 'undo' ? history.prepareUndo(current) : history.prepareRedo(current);
    assertSnapshot(again.document, expected);
    // The current document captured on the opposite stack is isolated too.
    current.remove('root');
    const opposite = direction === 'undo'
      ? first.history.prepareRedo(first.document) : first.history.prepareUndo(first.document);
    assertSnapshot(opposite.document, capturedCurrent);
  });
}

for (const disabled of [false, true]) {
  test(`failed edit snapshot preserves ${disabled ? 'disabled' : 'redo-bearing'} history`, t => {
    const doc = fixture();
    const previous = new HistoryManager().recordEdit(doc).prepareUndo(doc).history;
    const history = disabled ? previous.resetBoundary() : previous;
    const before = state(history);
    const spy = t.mock.method(doc, 'clone', () => { throw new Error('capture failure'); });
    assert.throws(() => history.recordEdit(doc), /capture failure/);
    assert.deepEqual(state(history), before);
    spy.mock.restore();
    if (!disabled) assertSnapshot(history.prepareRedo(doc).document, doc);
    assert.equal(history.recordEdit(doc).disabled, false);
  });
}

for (const direction of ['undo', 'redo'] as const) {
  test(`failed ${direction} current-document capture preserves complete stack contents`, t => {
    const first = fixture();
    const second = first.clone();
    second.findById('t')!.setAttribute('text', 'second');
    const current = second.clone();
    current.remove('inner');
    const saved = new HistoryManager().recordEdit(first).recordEdit(second);
    const undone = saved.prepareUndo(current);
    const history = direction === 'undo' ? saved : undone.history;
    const input = direction === 'undo' ? current : undone.document;
    const before = state(history);
    const inputBefore = input.clone();
    const spy = t.mock.method(input, 'clone', () => { throw new Error('current capture failure'); });
    assert.throws(() => direction === 'undo' ? history.prepareUndo(input) : history.prepareRedo(input), /current capture failure/);
    assert.deepEqual(state(history), before);
    spy.mock.restore();
    assertSnapshot(input, inputBefore);
    const retry = direction === 'undo' ? history.prepareUndo(input) : history.prepareRedo(input);
    assertSnapshot(retry.document, direction === 'undo' ? second : current);
    // Walk the remaining past stack with distinct states, not just stack counts.
    const remaining = retry.history.prepareUndo(retry.document);
    assertSnapshot(remaining.document, direction === 'undo' ? first : second);
  });
}

for (const direction of ['undo', 'redo'] as const) {
  test(`failed ${direction} restore clone preserves the original history for retry`, t => {
    const doc = fixture();
    const saved = new HistoryManager().recordEdit(doc);
    const history = direction === 'undo' ? saved : saved.prepareUndo(doc).history;
    const before = state(history);
    // Inject at the normal snapshot-cloning boundary, without accessing private fields.
    const spy = t.mock.method(SvgDocument.prototype, 'clone', () => { throw new Error('restore failure'); });
    assert.throws(() => direction === 'undo' ? history.prepareUndo(doc) : history.prepareRedo(doc), /restore failure/);
    assert.deepEqual(state(history), before);
    spy.mock.restore();
    assertSnapshot((direction === 'undo' ? history.prepareUndo(doc) : history.prepareRedo(doc)).document, doc);
  });
}
