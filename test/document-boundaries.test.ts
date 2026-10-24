import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorService } from '../src/application/EditorService.js';
import { EditorSession } from '../src/application/EditorSession.js';
import { HistoryManager } from '../src/application/HistoryManager.js';
import { Command } from '../src/application/commands/Command.js';
import { CommandResult } from '../src/application/CommandResult.js';
import { MoveCommand } from '../src/application/commands/MoveCommand.js';
import { SetAttributeCommand } from '../src/application/commands/SetAttributeCommand.js';
import { SvgDocument } from '../src/domain/SvgDocument.js';
import { GroupShape } from '../src/domain/GroupShape.js';
import { RectShape } from '../src/domain/RectShape.js';
import { TextShape } from '../src/domain/TextShape.js';
import type { Shape } from '../src/domain/Shape.js';
import { TreeOwnership } from '../src/domain/TreeOwnership.js';

function fixture(): SvgDocument {
  const document = new SvgDocument(640, 480);
  document.insert(new GroupShape('g', [new RectShape('r', 1, 2, 3, 4, 'red'),
    new GroupShape('inner', [new TextShape('t', 5, 6, 'hello')])]));
  document.insert(new GroupShape('tail'));
  return document;
}
function tree(document: SvgDocument): unknown {
  const seen = new Set<Shape>(); const ids = new Set<string>();
  const node = (shape: Shape, owner: Shape | SvgDocument): unknown => {
    assert.equal(seen.has(shape), false); assert.equal(ids.has(shape.id), false);
    seen.add(shape); ids.add(shape.id);
    assert.equal(TreeOwnership.ownerOf(shape), owner);
    assert.equal(document.findById(shape.id), shape);
    assert.equal(document.parentOf(shape.id), owner === document ? undefined : owner);
    return { type: shape.type, attributes: shape.getAttributes(), children: shape.children.map(child => node(child, shape)) };
  };
  return { width: document.width, height: document.height, roots: document.roots.map(root => node(root, document)) };
}
function capture(service: EditorService): unknown {
  const document = service.getDocumentSnapshot();
  return { hasDocument: service.hasDocument, path: service.defaultSavePath,
    history: service.getHistoryStatus(), document: document ? tree(document) : undefined };
}
function seeded(disabled = false): EditorService {
  const service = new EditorService(new EditorSession(fixture(), 'original.svg'));
  service.execute(new MoveCommand('r', 1, 0));
  service.execute(new SetAttributeCommand('t', 'text', 'changed'));
  service.undo();
  if (disabled) service.resizeCanvas(640, 480);
  return service;
}
function boundary(service: EditorService): void {
  assert.deepEqual(service.getHistoryStatus(), { undoCount: 0, redoCount: 0, disabled: true, canUndo: false, canRedo: false });
  for (const action of [() => service.undo(), () => service.redo()]) {
    assert.throws(action, { message: 'undo not allowed after io command' });
  }
}
function preservedBranch(service: EditorService, disabled: boolean): void {
  if (disabled) { boundary(service); return; }
  service.redo();
  assert.equal(service.getDocumentSnapshot()!.findById('t')!.getAttribute('text'), 'changed');
  service.undo(); service.undo();
  assert.equal(service.getDocumentSnapshot()!.findById('r')!.getAttribute('x'), 1);
}

for (const dimensions of [undefined, [320, 240] as const]) {
  test(`init creates an empty document from no document: ${dimensions ?? 'default'}`, () => {
    const service = new EditorService();
    service.init(...(dimensions ?? []));
    assert.deepEqual(service.getCanvasSize(), { width: dimensions?.[0] ?? 800, height: dimensions?.[1] ?? 600 });
    assert.deepEqual(service.getDocumentSnapshot()!.roots, []);
    assert.equal(service.defaultSavePath, undefined); boundary(service);
  });
}
test('init replaces populated document and both history stacks, clears path, and can repeat', () => {
  const service = seeded();
  assert.equal(service.getHistoryStatus().undoCount, 1); assert.equal(service.getHistoryStatus().redoCount, 1);
  service.init(300, 200); boundary(service);
  assert.equal(service.defaultSavePath, undefined); assert.equal(service.getDocumentSnapshot()!.findById('g'), undefined);
  service.init(); boundary(service);
  assert.deepEqual(service.getCanvasSize(), { width: 800, height: 600 });
});
test('canvas query is frozen, stable, preserves Redo and does not clone the document', t => {
  const service = seeded(); const before = capture(service);
  const spy = t.mock.method(SvgDocument.prototype, 'clone', () => { throw new Error('query must not clone'); });
  const size = service.getCanvasSize();
  assert.throws(() => Object.assign(size, { width: 10 }), TypeError);
  spy.mock.restore(); assert.deepEqual(capture(service), before);
  service.resizeCanvas(100, 200);
  assert.deepEqual(size, { width: 640, height: 480 });
});
for (const size of [[300, 200], [640, 480]] as const) {
  test(`canvas modification ${size} preserves tree/path and establishes a boundary`, () => {
    const service = seeded(); const before = service.getDocumentSnapshot()!;
    service.resizeCanvas(size[0], size[1]); boundary(service);
    before.resize(size[0], size[1]);
    assert.deepEqual(tree(service.getDocumentSnapshot()!), tree(before));
    assert.equal(service.defaultSavePath, 'original.svg');
  });
}
test('no-document canvas calls reject before dimension checks; failed init preserves empty session', () => {
  const service = new EditorService(); const before = capture(service);
  assert.throws(() => service.getCanvasSize(), { message: "no document. use 'init' or 'read' first" });
  assert.throws(() => service.resizeCanvas(-1, 0), /no document/);
  assert.throws(() => service.init(-1, 1), /positive/);
  assert.deepEqual(capture(service), before);
  service.init(); boundary(service);
});
for (const disabled of [false, true]) {
  for (const invalid of [0, -1, NaN, Infinity, -Infinity]) {
    test(`invalid dimensions ${invalid} preserve ${disabled ? 'disabled' : 'two-stack'} state`, () => {
      const service = seeded(disabled); const before = capture(service);
      for (const operation of [() => service.init(invalid, 100), () => service.init(100, invalid),
        () => service.resizeCanvas(invalid, 100), () => service.resizeCanvas(100, invalid)]) {
        assert.throws(operation); assert.deepEqual(capture(service), before);
      }
      preservedBranch(service, disabled);
    });
  }
  test(`partial init dimensions preserve state (disabled=${disabled})`, () => {
    const service = seeded(disabled); const before = capture(service);
    assert.throws(() => service.init(300), /zero or two/);
    assert.throws(() => service.init(undefined, 300), /zero or two/);
    assert.deepEqual(capture(service), before); preservedBranch(service, disabled);
  });
  for (const [operation, failAt] of [['init', 1], ['canvas', 1], ['canvas', 2]] as const) {
    test(`${operation} clone failure ${failAt} preserves all state (disabled=${disabled})`, t => {
      const service = seeded(disabled); const before = capture(service);
      const original = SvgDocument.prototype.clone; let calls = 0;
      const spy = t.mock.method(SvgDocument.prototype, 'clone', function(this: SvgDocument): SvgDocument {
        if (++calls === failAt) throw new Error('injected clone failure');
        return original.call(this);
      });
      assert.throws(() => operation === 'init' ? service.init(100, 200) : service.resizeCanvas(100, 200), /injected clone/);
      assert.equal(calls, failAt); spy.mock.restore();
      assert.deepEqual(capture(service), before); preservedBranch(service, disabled);
      service.init(); boundary(service);
    });
  }
  for (const operation of ['init', 'canvas'] as const) {
    test(`${operation} history preparation failure preserves all state (disabled=${disabled})`, t => {
      const service = seeded(disabled); const before = capture(service);
      const spy = t.mock.method(HistoryManager.prototype, 'resetBoundary', () => { throw new Error('history preparation failure'); });
      assert.throws(() => operation === 'init' ? service.init() : service.resizeCanvas(100, 200), /history preparation/);
      spy.mock.restore(); assert.deepEqual(capture(service), before); preservedBranch(service, disabled);
      service.resizeCanvas(100, 200); boundary(service);
    });
  }
}
test('document construction failure leaves old tree, path and both stacks intact', t => {
  const service = seeded(); const before = capture(service);
  const spy = t.mock.method(TreeOwnership, 'initializeDocument', () => { throw new Error('construction failure'); });
  assert.throws(() => service.init(), /construction failure/);
  spy.mock.restore(); assert.deepEqual(capture(service), before); preservedBranch(service, false);
  service.init(); boundary(service);
});
for (const operation of ['init', 'canvas'] as const) {
  test(`${operation} prepares without early publication and rejects nested writes`, t => {
    const service = seeded(); const before = capture(service);
    const status = service.getHistoryStatus(); const original = SvgDocument.prototype.clone;
    const spy = t.mock.method(SvgDocument.prototype, 'clone', function(this: SvgDocument): SvgDocument {
      assert.deepEqual(service.getCanvasSize(), { width: 640, height: 480 });
      assert.equal(service.defaultSavePath, 'original.svg'); assert.deepEqual(service.getHistoryStatus(), status);
      assert.throws(() => service.init(), /already in progress/);
      assert.throws(() => service.resizeCanvas(10, 20), /already in progress/);
      return original.call(this);
    });
    if (operation === 'init') service.init(100, 200); else service.resizeCanvas(100, 200);
    spy.mock.restore(); assert.notDeepEqual(capture(service), before); boundary(service);
    service.init(); // guard is released after success
  });
  test(`nested ${operation} from a Command rejects without changing formal state`, () => {
    const service = seeded(); const before = capture(service);
    const command = new class extends Command {
      execute(candidate: SvgDocument): CommandResult {
        candidate.resize(10, 20);
        assert.deepEqual(service.getCanvasSize(), { width: 640, height: 480 });
        if (operation === 'init') service.init(); else service.resizeCanvas(1, 2);
        return new CommandResult('unreachable');
      }
    }();
    assert.throws(() => service.execute(command), /already in progress/);
    assert.deepEqual(capture(service), before); preservedBranch(service, false);
    service.init(); boundary(service);
  });
}

test('session canvas projection handles no document and isolates input, snapshot and returned values', () => {
  assert.equal(new EditorSession().getCanvasSize(), undefined);
  const input = fixture(); const session = new EditorSession(input, 'original.svg');
  const size = session.getCanvasSize()!;
  input.resize(1, 2); session.getDocumentSnapshot()!.resize(3, 4);
  assert.throws(() => Object.assign(size, { height: 0 }), TypeError);
  assert.deepEqual(session.getCanvasSize(), { width: 640, height: 480 });
  assert.notEqual(session.getCanvasSize(), size);
});

test('document-level clone counts are one for init, two for resize and zero for canvas query', t => {
  const service = seeded(); const original = SvgDocument.prototype.clone; let calls = 0;
  t.mock.method(SvgDocument.prototype, 'clone', function(this: SvgDocument): SvgDocument {
    calls++; return original.call(this);
  });
  service.getCanvasSize(); assert.equal(calls, 0);
  service.resizeCanvas(100, 200); assert.equal(calls, 2);
  service.init(); assert.equal(calls, 3);
});
