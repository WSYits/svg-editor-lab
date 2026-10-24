import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorService } from '../src/application/EditorService.js';
import { EditorSession } from '../src/application/EditorSession.js';
import { CreateCommand } from '../src/application/commands/CreateCommand.js';
import { MoveCommand } from '../src/application/commands/MoveCommand.js';
import { ScaleCommand } from '../src/application/commands/ScaleCommand.js';
import { GroupCommand } from '../src/application/commands/GroupCommand.js';
import { UngroupCommand } from '../src/application/commands/UngroupCommand.js';
import { SetAttributeCommand } from '../src/application/commands/SetAttributeCommand.js';
import { SvgDocument } from '../src/domain/SvgDocument.js';
import { GroupShape } from '../src/domain/GroupShape.js';
import { RectShape } from '../src/domain/RectShape.js';
import type { Shape } from '../src/domain/Shape.js';
import { TreeOwnership } from '../src/domain/TreeOwnership.js';

function state(service: EditorService): unknown {
  const document = service.getDocumentSnapshot()!;
  const ids = new Set<string>(); const objects = new Set<Shape>();
  const visit = (shape: Shape, owner: Shape | SvgDocument): unknown => {
    assert.equal(ids.has(shape.id), false); assert.equal(objects.has(shape), false);
    ids.add(shape.id); objects.add(shape);
    assert.equal(TreeOwnership.ownerOf(shape), owner);
    assert.equal(document.findById(shape.id), shape);
    assert.equal(document.parentOf(shape.id), owner === document ? undefined : owner);
    return { type: shape.type, attributes: shape.getAttributes(), children: shape.children.map(child => visit(child, shape)) };
  };
  return { size: service.getCanvasSize(), path: service.defaultSavePath, roots: document.roots.map(root => visit(root, document)) };
}
function assertDisabled(service: EditorService): void {
  assert.deepEqual(service.getHistoryStatus(), { undoCount: 0, redoCount: 0, disabled: true, canUndo: false, canRedo: false });
  assert.throws(() => service.undo(), { message: 'undo not allowed after io command' });
  assert.throws(() => service.redo(), { message: 'undo not allowed after io command' });
}

test('canvas boundary, failed edit, query, successful edit, Undo exhaustion and Redo form a complete workflow', () => {
  const document = new SvgDocument(640, 480);
  document.insert(new GroupShape('g', [new RectShape('r', 1, 2, 3, 4, 'red')]));
  const service = new EditorService(new EditorSession(document, 'original.svg'));
  service.execute(new MoveCommand('r', 10, 20));
  service.execute(new SetAttributeCommand('g', 'stroke', 'blue'));
  service.undo();
  assert.equal(service.getHistoryStatus().undoCount, 1); assert.equal(service.getHistoryStatus().redoCount, 1);
  service.resizeCanvas(900, 700); const boundaryState = state(service); assertDisabled(service);
  assert.equal(service.defaultSavePath, 'original.svg');
  assert.throws(() => service.execute(new MoveCommand('missing', 1, 1)), /no such shape/);
  assert.deepEqual(state(service), boundaryState); assertDisabled(service);
  assert.deepEqual(service.getCanvasSize(), { width: 900, height: 700 }); assertDisabled(service);
  service.execute(new MoveCommand('g', 5, 6)); const edited = state(service);
  assert.deepEqual(service.getHistoryStatus(), { undoCount: 1, redoCount: 0, disabled: false, canUndo: true, canRedo: false });
  service.undo(); assert.deepEqual(state(service), boundaryState);
  assert.throws(() => service.undo(), { message: 'nothing to undo' });
  assert.throws(() => service.execute(new ScaleCommand('g', Infinity)), /finite/);
  assert.equal(service.getHistoryStatus().redoCount, 1);
  service.redo(); assert.deepEqual(state(service), edited);
  service.undo(); service.execute(new MoveCommand('r', 0, 0));
  assert.deepEqual(state(service), boundaryState);
  assert.equal(service.getHistoryStatus().undoCount, 1); assert.equal(service.getHistoryStatus().redoCount, 0);
  service.undo(); assert.deepEqual(state(service), boundaryState);
  assert.throws(() => service.undo(), { message: 'nothing to undo' });
});

test('init establishes an empty baseline for mixed structural/geometric edits and repeated initialization', () => {
  const old = new SvgDocument(); old.insert(new RectShape('old', 1, 2, 3, 4));
  const service = new EditorService(new EditorSession(old, 'old.svg'));
  service.execute(new MoveCommand('old', 1, 1));
  service.init(400, 300); assertDisabled(service);
  const states = [state(service)];
  const commands = [new CreateCommand('g', 'outer'),
    new CreateCommand('rect', 'a', { x: 1, y: 2, width: 3, height: 4, fill: 'red' }, 'outer'),
    new CreateCommand('text', 'b', { x: 5, y: 6, text: 'hello' }, 'outer'),
    new GroupCommand('inner', ['b', 'a']), new MoveCommand('inner', 10, 20),
    new ScaleCommand('a', 2), new SetAttributeCommand('b', 'text', 'changed'), new UngroupCommand('inner')];
  for (const command of commands) { service.execute(command); states.push(state(service)); }
  for (let index = states.length - 2; index >= 0; index--) {
    service.undo(); assert.deepEqual(state(service), states[index]);
    assert.equal(service.getDocumentSnapshot()!.findById('old'), undefined);
  }
  assert.throws(() => service.undo(), { message: 'nothing to undo' });
  for (let index = 1; index < states.length; index++) { service.redo(); assert.deepEqual(state(service), states[index]); }
  service.undo(); service.init(); assertDisabled(service);
  assert.deepEqual(service.getCanvasSize(), { width: 800, height: 600 });
  assert.equal(service.defaultSavePath, undefined); assert.deepEqual(service.getDocumentSnapshot()!.roots, []);
});

test('external input, old sessions and output snapshots remain independent across document boundaries and recovery', () => {
  const input = new SvgDocument(640, 480); const original = new RectShape('r', 1, 2, 3, 4);
  input.insert(new GroupShape('g', [original]));
  const session = new EditorSession(input, 'original.svg'); const service = new EditorService(session);
  const exposed = service.getDocumentSnapshot()!;
  service.resizeCanvas(100, 200); const baseline = state(service);
  input.resize(10, 20); original.move(100, 100);
  exposed.findById('r')!.setAttribute('fill', 'green'); exposed.remove('g');
  assert.deepEqual(state(service), baseline);
  assert.deepEqual(session.getCanvasSize(), { width: 640, height: 480 });
  service.execute(new MoveCommand('r', 1, 1)); service.undo();
  const recovered = service.getDocumentSnapshot()!; recovered.findById('r')!.move(100, 100);
  assert.deepEqual(state(service), baseline);
  const fresh = service.getDocumentSnapshot()!;
  assert.notEqual(fresh.findById('r'), recovered.findById('r'));
  assert.equal(TreeOwnership.ownerOf(fresh.findById('r')!), fresh.findById('g'));
  assert.equal(fresh.findById('r')!.getAttribute('fill'), undefined);
  service.init(); assertDisabled(service);
  recovered.insert(new RectShape('later', 0, 0, 1, 1));
  assert.equal(service.getDocumentSnapshot()!.findById('later'), undefined);
  assert.equal(service.defaultSavePath, undefined);
});
