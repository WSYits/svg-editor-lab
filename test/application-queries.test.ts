import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorService } from '../src/application/EditorService.js';
import { EditorSession } from '../src/application/EditorSession.js';
import { MoveCommand } from '../src/application/commands/MoveCommand.js';
import { SvgDocument } from '../src/domain/SvgDocument.js';
import { GroupShape } from '../src/domain/GroupShape.js';
import { RectShape } from '../src/domain/RectShape.js';
import { TextShape } from '../src/domain/TextShape.js';

function service(): EditorService {
  const doc = new SvgDocument(400, 300);
  doc.insert(new GroupShape('g', [new RectShape('r', 1, 2, 3, 4), new TextShape('t', 5, 6, 'hello')]));
  return new EditorService(new EditorSession(doc, 'original.svg'));
}
test('full/subtree/shape projections preserve hierarchy, geometry, explicit attributes and parent', () => {
  const s = service(); const view = s.getTreeView();
  assert.equal(view.width, 400); assert.equal(view.height, 300); assert.equal(view.subtree, false);
  assert.deepEqual(view.roots[0]!.children.map(node => node.id), ['r', 't']);
  assert.equal(view.roots[0]!.parentId, undefined);
  assert.equal(view.roots[0]!.children[0]!.parentId, 'g');
  assert.deepEqual(s.getShapeView('r').attributes, { id: 'r', x: 1, y: 2, width: 3, height: 4 });
  assert.equal(Object.hasOwn(s.getShapeView('r').attributes, 'fill'), false);
  assert.equal(s.getShapeView('t').attributes.text, 'hello');
  assert.deepEqual(s.getTreeView('r').roots, [s.getShapeView('r')]);
  assert.equal(s.getTreeView('r').subtree, true);
});
test('projections are recursively frozen values, independent of later edits and each other', () => {
  const s = service(); const first = s.getTreeView(); const second = s.getTreeView();
  const node = first.roots[0]!.children[0]!;
  assert.notEqual(first, second); assert.notEqual(first.roots[0], second.roots[0]);
  for (const value of [first, first.roots, first.roots[0]!, first.roots[0]!.children, node, node.attributes]) assert(Object.isFrozen(value));
  assert.throws(() => Object.assign(node.attributes, { x: 100 }), TypeError);
  assert.throws(() => Object.assign(first.roots, { 0: node }), TypeError);
  s.execute(new MoveCommand('r', 10, 0));
  assert.equal(node.attributes.x, 1); assert.equal(s.getShapeView('r').attributes.x, 11);
  assert.equal('move' in node, false); assert.equal('clone' in node, false);
});
test('queries and missing targets preserve both history stacks, document and path', () => {
  const s = service(); s.execute(new MoveCommand('r', 1, 0)); s.execute(new MoveCommand('t', 1, 0)); s.undo();
  const history = s.getHistoryStatus(); const before = s.getTreeView();
  s.getTreeView(); s.getTreeView('g'); s.getShapeView('r'); s.getAttributeKind('r', 'x');
  assert.throws(() => s.getTreeView('missing'), /no such shape: missing/);
  assert.throws(() => s.getShapeView('missing'), /no such shape: missing/);
  assert.throws(() => s.getAttributeKind('missing', 'x'), /no such shape/);
  assert.throws(() => s.getAttributeKind('r', 'text'), /unknown attribute: text/);
  assert.deepEqual(s.getHistoryStatus(), history); assert.deepEqual(s.getTreeView(), before);
  assert.equal(s.defaultSavePath, 'original.svg'); s.redo(); assert.equal(s.getShapeView('t').attributes.x, 6);
});
test('query snapshot preparation failure does not change formal state or disable history', t => {
  const s = service(); const before = s.getTreeView(); const history = s.getHistoryStatus();
  const spy = t.mock.method(SvgDocument.prototype, 'clone', () => { throw new Error('query copy failure'); });
  assert.throws(() => s.getTreeView(), /query copy failure/);
  assert.throws(() => s.getShapeView('r'), /query copy failure/);
  spy.mock.restore(); assert.deepEqual(s.getTreeView(), before); assert.deepEqual(s.getHistoryStatus(), history);
});
test('no-document queries reject; creation metadata remains available before init', () => {
  const s = new EditorService();
  assert.throws(() => s.getTreeView(), /no document/); assert.throws(() => s.getShapeView('r'), /no document/);
  assert.throws(() => s.getAttributeKind('r', 'x'), /no document/);
  assert.equal(s.getCreationDescription('g').parameters.length, 0);
});
