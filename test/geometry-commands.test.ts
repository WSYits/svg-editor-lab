import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorService } from '../src/application/EditorService.js';
import { EditorSession } from '../src/application/EditorSession.js';
import { Command } from '../src/application/commands/Command.js';
import { MoveCommand } from '../src/application/commands/MoveCommand.js';
import { ScaleCommand } from '../src/application/commands/ScaleCommand.js';
import { SetAttributeCommand } from '../src/application/commands/SetAttributeCommand.js';
import { SvgDocument } from '../src/domain/SvgDocument.js';
import { GroupShape } from '../src/domain/GroupShape.js';
import { RectShape } from '../src/domain/RectShape.js';
import { CircleShape } from '../src/domain/CircleShape.js';
import { TextShape } from '../src/domain/TextShape.js';
import type { Shape } from '../src/domain/Shape.js';

function fixture(): SvgDocument {
  const doc = new SvgDocument();
  doc.insert(new RectShape('r', 1, 2, 3, 4));
  doc.insert(new GroupShape('g', [new CircleShape('c', 5, 6, 7),
    new GroupShape('inner', [new TextShape('t', 8, 9, 'hello')])]));
  return doc;
}

function tree(doc: SvgDocument): unknown {
  const node = (shape: Shape): unknown => ({ type: shape.type, attributes: shape.getAttributes(), children: shape.children.map(node) });
  return { width: doc.width, height: doc.height, roots: doc.roots.map(node) };
}

for (const target of ['r', 'g']) {
  for (const operation of ['move', 'scale', 'set']) {
    test(`${operation} ${target === 'r' ? 'leaf' : 'nested group'} uses one command/history execution path`, () => {
      const input = fixture();
      const original = tree(input);
      const service = new EditorService(new EditorSession(input, 'drawing.svg'));
      const command: Command = operation === 'move' ? new MoveCommand(target, 10, -5)
        : operation === 'scale' ? new ScaleCommand(target, 2) : new SetAttributeCommand(target, 'fill', 'red');
      const result = service.execute(command);
      assert.ok(result.summary.includes(`#${target}`));
      const after = service.getDocumentSnapshot()!;
      if (operation === 'move') {
        if (target === 'r') assert.deepEqual(after.findById('r')!.getAttributes(), { id: 'r', x: 11, y: -3, width: 3, height: 4 });
        else {
          assert.deepEqual(after.findById('c')!.getAttributes(), { id: 'c', cx: 15, cy: 1, r: 7 });
          assert.deepEqual(after.findById('t')!.getAttributes(), { id: 't', x: 18, y: 4, text: 'hello' });
        }
      } else if (operation === 'scale') {
        if (target === 'r') assert.deepEqual(after.findById('r')!.getAttributes(), { id: 'r', x: 2, y: 4, width: 6, height: 8 });
        else {
          assert.deepEqual(after.findById('c')!.getAttributes(), { id: 'c', cx: 10, cy: 12, r: 14 });
          assert.deepEqual(after.findById('t')!.getAttributes(), { id: 't', x: 16, y: 18, text: 'hello' });
        }
      } else {
        assert.equal(after.findById(target)!.getAttribute('fill'), 'red');
        assert.equal(after.findById(target === 'r' ? 'g' : 'c')!.getAttribute('fill'), undefined);
      }
      assert.equal(service.getHistoryStatus().undoCount, 1);
      const edited = tree(after);
      assert.equal(service.undo().summary, 'undo completed');
      assert.deepEqual(tree(service.getDocumentSnapshot()!), original);
      assert.equal(service.getHistoryStatus().redoCount, 1);
      assert.equal(service.redo().summary, 'redo completed');
      assert.deepEqual(tree(service.getDocumentSnapshot()!), edited);
      assert.equal(service.defaultSavePath, 'drawing.svg');
      assert.deepEqual(tree(input), original);
    });
  }
}

test('MoveCommand captures primitive arguments by value and resolves the current candidate on every reuse', () => {
  const parameters = { id: 'r', dx: 2, dy: 3 };
  const command: Command = new MoveCommand(parameters.id, parameters.dx, parameters.dy);
  parameters.id = 'missing'; parameters.dx = 100; parameters.dy = 100;
  const first = fixture();
  command.execute(first);
  command.execute(first);
  assert.deepEqual(first.findById('r')!.getAttributes(), { id: 'r', x: 5, y: 8, width: 3, height: 4 });
  const second = fixture();
  command.execute(second);
  assert.equal(second.findById('r')!.getAttribute('x'), 3);
  assert.equal(first.findById('r')!.getAttribute('x'), 5);
});

test('ScaleCommand retains its primitive factor and applies again when reused', () => {
  const parameters = { factor: 2 };
  const command = new ScaleCommand('r', parameters.factor);
  parameters.factor = 100;
  const service = new EditorService(new EditorSession(fixture()));
  service.execute(command); service.execute(command);
  assert.deepEqual(service.getDocumentSnapshot()!.findById('r')!.getAttributes(), { id: 'r', x: 4, y: 8, width: 12, height: 16 });
  assert.equal(service.getHistoryStatus().undoCount, 2);
});

test('SetAttributeCommand retains primitive values, supports edited text and reuses safely', () => {
  const parameters = { id: 't', attribute: 'text', value: 'new text' };
  const command = new SetAttributeCommand(parameters.id, parameters.attribute, parameters.value);
  parameters.id = 'missing'; parameters.attribute = 'id'; parameters.value = 'external';
  const service = new EditorService(new EditorSession(fixture()));
  service.execute(command); service.execute(command);
  assert.equal(service.getDocumentSnapshot()!.findById('t')!.getAttribute('text'), 'new text');
  assert.equal(service.getHistoryStatus().undoCount, 2);
  service.undo();
  assert.equal(service.getDocumentSnapshot()!.findById('t')!.getAttribute('text'), 'new text');
  service.undo();
  assert.equal(service.getDocumentSnapshot()!.findById('t')!.getAttribute('text'), 'hello');
});
