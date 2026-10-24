import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorService } from '../src/application/EditorService.js';
import { EditorSession } from '../src/application/EditorSession.js';
import { HistoryManager } from '../src/application/HistoryManager.js';
import { CommandResult } from '../src/application/CommandResult.js';
import { Command } from '../src/application/commands/Command.js';
import { MoveCommand } from '../src/application/commands/MoveCommand.js';
import { ScaleCommand } from '../src/application/commands/ScaleCommand.js';
import { SetAttributeCommand } from '../src/application/commands/SetAttributeCommand.js';
import { SvgDocument } from '../src/domain/SvgDocument.js';
import { GroupShape } from '../src/domain/GroupShape.js';
import { RectShape } from '../src/domain/RectShape.js';
import { TextShape } from '../src/domain/TextShape.js';
import type { Shape } from '../src/domain/Shape.js';
import { TreeOwnership } from '../src/domain/TreeOwnership.js';

function fixture(overflow = false): SvgDocument {
  const doc = new SvgDocument(640, 480);
  const r = new RectShape('r', 1, 2, 3, 4, 'red');
  const text = new TextShape('t', 5, overflow ? Number.MAX_VALUE : 6, 'hello');
  const inner = new GroupShape('inner', [text]);
  doc.insert(new GroupShape('g', [r, inner]));
  doc.insert(new GroupShape('tail'));
  return doc;
}

function tree(doc: SvgDocument): unknown {
  const node = (shape: Shape): unknown => ({ type: shape.type, attributes: shape.getAttributes(), children: shape.children.map(node) });
  return { width: doc.width, height: doc.height, roots: doc.roots.map(node) };
}

function capture(service: EditorService): unknown {
  const doc = service.getDocumentSnapshot();
  if (doc) {
    const objects = new Set<Shape>();
    const ids = new Set<string>();
    const visit = (shape: Shape, owner: Shape | SvgDocument): void => {
      assert.equal(objects.has(shape), false); assert.equal(ids.has(shape.id), false);
      objects.add(shape); ids.add(shape.id);
      assert.equal(TreeOwnership.ownerOf(shape), owner);
      assert.equal(doc.findById(shape.id), shape);
      assert.equal(doc.parentOf(shape.id), owner === doc ? undefined : owner);
      shape.children.forEach(child => visit(child, shape));
    };
    doc.roots.forEach(root => visit(root, doc));
  }
  return { hasDocument: service.hasDocument, path: service.defaultSavePath,
    history: service.getHistoryStatus(), document: doc ? tree(doc) : undefined };
}

function redoService(overflow = false): EditorService {
  const service = new EditorService(new EditorSession(fixture(overflow), 'original.svg'));
  service.execute(new MoveCommand('r', 1, 0));
  service.undo();
  return service;
}

function assertFailurePreservesRedo(service: EditorService, command: Command, message: RegExp): void {
  const before = capture(service);
  assert.throws(() => service.execute(command), message);
  assert.deepEqual(capture(service), before);
  service.redo();
  assert.equal(service.getDocumentSnapshot()!.findById('r')!.getAttribute('x'), 2);
  assert.equal(service.defaultSavePath, 'original.svg');
}

test('continuous edits support multiple Undo/Redo and a successful new branch clears Redo', () => {
  const service = new EditorService(new EditorSession(fixture(), 'original.svg'));
  const s0 = capture(service);
  service.execute(new MoveCommand('r', 10, 0));
  const s1 = tree(service.getDocumentSnapshot()!);
  service.execute(new ScaleCommand('g', 2));
  const s2 = tree(service.getDocumentSnapshot()!);
  service.execute(new SetAttributeCommand('t', 'text', 'changed'));
  const s3 = tree(service.getDocumentSnapshot()!);
  service.undo(); assert.deepEqual(tree(service.getDocumentSnapshot()!), s2);
  service.undo(); assert.deepEqual(tree(service.getDocumentSnapshot()!), s1);
  service.undo(); assert.deepEqual(tree(service.getDocumentSnapshot()!), tree(fixture()));
  assert.equal(service.getHistoryStatus().disabled, false);
  service.redo(); service.redo(); service.redo();
  assert.deepEqual(tree(service.getDocumentSnapshot()!), s3);
  service.undo(); service.execute(new MoveCommand('r', 1, 1));
  assert.equal(service.getHistoryStatus().redoCount, 0);
  const branch = capture(service);
  assert.throws(() => service.redo(), /nothing to redo/);
  assert.deepEqual(capture(service), branch);
  assert.notDeepEqual(capture(service), s0);
});

for (const failure of [
  { name: 'missing move target', command: new MoveCommand('missing', 1, 2), message: /no such shape: missing/ },
  { name: 'missing scale target', command: new ScaleCommand('missing', 2), message: /no such shape: missing/ },
  { name: 'missing set target', command: new SetAttributeCommand('missing', 'fill', 'red'), message: /no such shape: missing/ },
  { name: 'unknown attribute', command: new SetAttributeCommand('r', 'unknown', 1), message: /unknown attribute/ },
  { name: 'immutable id', command: new SetAttributeCommand('r', 'id', 'new'), message: /unknown attribute/ },
  { name: 'invalid text', command: new SetAttributeCommand('t', 'text', 1), message: /text must be a string/ },
  { name: 'negative width', command: new SetAttributeCommand('r', 'width', -1), message: /nonnegative/ },
  { name: 'invalid delta', command: new MoveCommand('r', Infinity, 1), message: /finite number/ },
  { name: 'nonpositive scale', command: new ScaleCommand('r', 0), message: /positive/ },
  { name: 'nested move overflow', command: new MoveCommand('g', 1, Number.MAX_VALUE), message: /finite number/ },
  { name: 'nested scale overflow', command: new ScaleCommand('g', 2), message: /finite number/ },
]) {
  test(`${failure.name} preserves the full application state and original Redo branch`, () => {
    assertFailurePreservesRedo(redoService(true), failure.command, failure.message);
  });
}

test('a polymorphic custom Command can mutate then throw without publishing any candidate state', () => {
  const service = redoService();
  const command = new class extends Command {
    execute(candidate: SvgDocument): CommandResult {
      candidate.findById('r')!.move(100, 100);
      candidate.remove('inner');
      candidate.resize(1, 2);
      throw new Error('late command failure');
    }
  }();
  assertFailurePreservesRedo(service, command, /late command failure/);
});

test('retained candidate and node references cannot affect committed state or its history', () => {
  const service = redoService();
  let retained: SvgDocument | undefined;
  let node: Shape | undefined;
  const command = new class extends Command {
    execute(candidate: SvgDocument): CommandResult {
      retained = candidate; node = candidate.findById('r')!;
      node.move(10, 20);
      return new CommandResult('custom edit');
    }
  }();
  service.execute(command);
  const committed = capture(service);
  retained!.remove('inner'); retained!.resize(1, 2); node!.setAttribute('fill', 'external'); node!.move(999, 999);
  assert.deepEqual(capture(service), committed);
  service.undo(); assert.equal(service.getDocumentSnapshot()!.findById('r')!.getAttribute('x'), 1);
  service.redo(); assert.deepEqual(capture(service), committed);
});

test('input document, returned document and result/status mutations cannot change formal state or history', () => {
  const input = fixture();
  const session = new EditorSession(input, 'original.svg');
  const history = new HistoryManager();
  const service = new EditorService(session, history);
  const result = service.execute(new MoveCommand('r', 2, 3));
  const before = capture(service);
  input.remove('g');
  const output = service.getDocumentSnapshot()!;
  output.findById('r')!.move(100, 100); output.remove('inner');
  assert.throws(() => Object.assign(result, { summary: 'external' }), TypeError);
  assert.throws(() => Object.assign(service.getHistoryStatus(), { undoCount: 999 }), TypeError);
  assert.deepEqual(capture(service), before);
  assert.equal(session.getDocumentSnapshot()!.findById('r')!.getAttribute('x'), 1);
  assert.equal(history.undoCount, 0);
  service.undo(); service.redo();
  assert.deepEqual(capture(service), before);
});

test('Service captures a custom result value instead of retaining a command-owned result object', () => {
  const service = redoService();
  let summary = 'stable result';
  const raw = new class extends CommandResult { override get summary(): string { return summary; } }('raw');
  const result = service.execute(new class extends Command {
    execute(candidate: SvgDocument): CommandResult { candidate.findById('r')!.move(1, 0); return raw; }
  }());
  const before = capture(service);
  summary = 'external';
  assert.notEqual(result, raw); assert.equal(result.summary, 'stable result');
  assert.deepEqual(capture(service), before);
});

test('result preparation failure discards candidate changes and preserves Redo', () => {
  assertFailurePreservesRedo(redoService(), new class extends Command {
    execute(candidate: SvgDocument): CommandResult {
      candidate.findById('r')!.move(10, 20);
      return new class extends CommandResult { override get summary(): string { throw new Error('result failure'); } }('raw');
    }
  }(), /result failure/);
});

test('history preparation failure does not publish the prepared candidate or session', t => {
  const service = redoService();
  const before = capture(service);
  const spy = t.mock.method(HistoryManager.prototype, 'recordEdit', () => { throw new Error('history failure'); });
  assert.throws(() => service.execute(new MoveCommand('r', 10, 20)), /history failure/);
  spy.mock.restore();
  assert.deepEqual(capture(service), before);
  service.redo(); assert.equal(service.getDocumentSnapshot()!.findById('r')!.getAttribute('x'), 2);
});

test('new session cloning failure after history preparation publishes neither value', t => {
  assertFailurePreservesRedo(redoService(), new class extends Command {
    execute(candidate: SvgDocument): CommandResult {
      candidate.findById('r')!.move(10, 20);
      t.mock.method(candidate.findById('t')!, 'clone', () => { throw new Error('session copy failure'); });
      return new CommandResult('prepared');
    }
  }(), /session copy failure/);
});

for (const failAt of [1, 2, 3]) {
  test(`edit snapshot failure at clone ${failAt} preserves application state and permits retry`, t => {
    const service = redoService();
    const before = capture(service);
    const original = SvgDocument.prototype.clone;
    let calls = 0;
    const spy = t.mock.method(SvgDocument.prototype, 'clone', function (this: SvgDocument): SvgDocument {
      if (++calls === failAt) throw new Error('copy failure');
      return original.call(this);
    });
    assert.throws(() => service.execute(new MoveCommand('r', 10, 20)), /copy failure/);
    spy.mock.restore();
    assert.deepEqual(capture(service), before);
    service.redo(); assert.equal(service.getDocumentSnapshot()!.findById('r')!.getAttribute('x'), 2);
  });
}

for (const undo of [true, false]) {
  for (const failAt of [1, 2, 3, 4]) {
    test(`${undo ? 'undo' : 'redo'} clone failure ${failAt} preserves document/history/path and releases execution guard`, t => {
      const service = redoService();
      if (undo) service.redo();
      const before = capture(service);
      const original = SvgDocument.prototype.clone;
      let calls = 0;
      const spy = t.mock.method(SvgDocument.prototype, 'clone', function (this: SvgDocument): SvgDocument {
        if (++calls === failAt) throw new Error('restore copy failure');
        return original.call(this);
      });
      assert.throws(() => undo ? service.undo() : service.redo(), /restore copy failure/);
      spy.mock.restore();
      assert.deepEqual(capture(service), before);
      if (undo) service.undo(); else service.redo();
      assert.equal(service.getDocumentSnapshot()!.findById('r')!.getAttribute('x'), undo ? 1 : 2);
      assert.equal(service.defaultSavePath, 'original.svg');
    });
  }
}

for (const condition of ['no document', 'empty', 'disabled']) {
  test(`${condition} errors precede snapshot preparation and do not execute a supplied Command`, t => {
    const history = condition === 'empty' ? new HistoryManager() : new HistoryManager().resetBoundary();
    const service = new EditorService(condition === 'no document' ? new EditorSession() : new EditorSession(fixture()), history);
    const before = capture(service);
    const spy = t.mock.method(SvgDocument.prototype, 'clone', () => { throw new Error('must not clone'); });
    const message = condition === 'no document' ? /no document/ : condition === 'empty' ? /nothing to/ : /undo not allowed after io command/;
    assert.throws(() => service.undo(), message); assert.throws(() => service.redo(), message);
    if (condition === 'no document') assert.throws(() => service.execute(new MoveCommand('missing', 1, 2)), /no document/);
    assert.equal(spy.mock.callCount(), 0);
    spy.mock.restore();
    assert.deepEqual(capture(service), before);
  });
}

for (const command of [new MoveCommand('r', 0, 0), new ScaleCommand('r', 1), new SetAttributeCommand('r', 'fill', 'red')]) {
  test(`legal no-change ${command.constructor.name} still records an Undo unit and clears Redo`, () => {
    const service = redoService();
    const before = tree(service.getDocumentSnapshot()!);
    service.execute(command);
    assert.deepEqual(tree(service.getDocumentSnapshot()!), before);
    assert.equal(service.getHistoryStatus().undoCount, 1);
    assert.equal(service.getHistoryStatus().redoCount, 0);
    service.undo(); assert.equal(service.getHistoryStatus().redoCount, 1);
  });
}

test('failed edit preserves disabled history, while a successful edit re-enables it', () => {
  const service = new EditorService(new EditorSession(fixture(), 'original.svg'), new HistoryManager().resetBoundary());
  const before = capture(service);
  assert.throws(() => service.execute(new MoveCommand('missing', 1, 2)), /no such shape/);
  assert.deepEqual(capture(service), before);
  service.execute(new MoveCommand('r', 0, 0));
  assert.equal(service.getHistoryStatus().disabled, false);
  assert.equal(service.getHistoryStatus().undoCount, 1);
  service.undo();
  assert.equal(service.getHistoryStatus().disabled, false);
  assert.equal(service.getHistoryStatus().undoCount, 0);
});

test('reentrant mutation is rejected instead of allowing nested publication during a candidate edit', () => {
  const service = redoService();
  assertFailurePreservesRedo(service, new class extends Command {
    execute(candidate: SvgDocument): CommandResult {
      candidate.findById('r')!.move(10, 20);
      return service.redo();
    }
  }(), /already in progress/);
});

test('nonempty history without a document is rejected at construction', () => {
  const history = new HistoryManager().recordEdit(fixture());
  assert.throws(() => new EditorService(new EditorSession(), history), /requires a document/);
  assert.equal(history.undoCount, 1);
});
