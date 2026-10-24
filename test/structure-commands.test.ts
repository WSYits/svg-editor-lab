import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorService } from '../src/application/EditorService.js';
import { EditorSession } from '../src/application/EditorSession.js';
import { HistoryManager } from '../src/application/HistoryManager.js';
import type { Command } from '../src/application/commands/Command.js';
import { CreateCommand } from '../src/application/commands/CreateCommand.js';
import { DeleteCommand } from '../src/application/commands/DeleteCommand.js';
import { GroupCommand } from '../src/application/commands/GroupCommand.js';
import { UngroupCommand } from '../src/application/commands/UngroupCommand.js';
import { AddToCommand } from '../src/application/commands/AddToCommand.js';
import { FrontCommand } from '../src/application/commands/FrontCommand.js';
import { BackCommand } from '../src/application/commands/BackCommand.js';
import { MoveCommand } from '../src/application/commands/MoveCommand.js';
import { SetAttributeCommand } from '../src/application/commands/SetAttributeCommand.js';
import { SvgDocument } from '../src/domain/SvgDocument.js';
import { GroupShape } from '../src/domain/GroupShape.js';
import { RectShape } from '../src/domain/RectShape.js';
import { CircleShape } from '../src/domain/CircleShape.js';
import { EllipseShape } from '../src/domain/EllipseShape.js';
import { LineShape } from '../src/domain/LineShape.js';
import { TextShape } from '../src/domain/TextShape.js';
import type { Shape, AttributeValue } from '../src/domain/Shape.js';
import { TreeOwnership } from '../src/domain/TreeOwnership.js';

function fixture(): SvgDocument {
  const doc = new SvgDocument(640.5, 480.25);
  const a = new RectShape('a', 1, 2, 3, 4, 'red');
  a.setAttribute('stroke-width', 0.5);
  const inner = new GroupShape('inner', [a, new CircleShape('s', 5, 6, 7)]);
  inner.setAttribute('stroke', 'blue');
  const p = new GroupShape('P', [inner, new EllipseShape('x', 1, 2, 3, 4)]);
  p.move(2, 3);
  const q = new GroupShape('Q', [new TextShape('b', 8, 9, 'hello'), new LineShape('y', 1, 2, 3, 4, 'green')]);
  q.scale(1.5);
  const scene = new GroupShape('scene', [new GroupShape('head'), p, q, new GroupShape('foot')]);
  scene.setAttribute('fill', 'orange');
  doc.insert(scene);
  doc.insert(new GroupShape('tail'));
  return doc;
}

function service(doc = fixture()): EditorService {
  return new EditorService(new EditorSession(doc, 'original.svg'));
}

function nodes(doc: SvgDocument): Shape[] { return doc.roots.flatMap(root => TreeOwnership.nodes(root)); }

function tree(doc: SvgDocument): unknown {
  const visit = (node: Shape): unknown => ({ type: node.type, attributes: node.getAttributes(), children: node.children.map(visit) });
  return { width: doc.width, height: doc.height, roots: doc.roots.map(visit) };
}

function assertConsistent(doc: SvgDocument): void {
  const objects = new Set<Shape>();
  const ids = new Set<string>();
  const visit = (node: Shape, owner: Shape | SvgDocument): void => {
    assert.equal(objects.has(node), false); assert.equal(ids.has(node.id), false);
    objects.add(node); ids.add(node.id);
    assert.equal(doc.findById(node.id), node);
    assert.equal(TreeOwnership.ownerOf(node), owner);
    assert.equal(doc.parentOf(node.id), owner === doc ? undefined : owner);
    for (const child of node.children) visit(child, node);
  };
  for (const root of doc.roots) visit(root, doc);
}

function snapshot(editor: EditorService): SvgDocument {
  assert.equal(editor.defaultSavePath, 'original.svg');
  const doc = editor.getDocumentSnapshot()!;
  assertConsistent(doc);
  return doc;
}

function assertRestored(actual: SvgDocument, expected: SvgDocument): void {
  assert.notEqual(actual, expected);
  assert.deepEqual(tree(actual), tree(expected));
  assertConsistent(actual);
  const originals = new Set(nodes(expected));
  for (const node of nodes(actual)) {
    assert.equal(originals.has(node), false);
    assert.equal(node.constructor, expected.findById(node.id)!.constructor);
  }
}

function order(doc: SvgDocument, parent: string | undefined, ids: readonly string[]): void {
  assert.deepEqual((parent === undefined ? doc.roots : doc.findById(parent)!.children).map(node => node.id), ids);
}

function assertAttributesPreserved(after: SvgDocument, before: SvgDocument): void {
  for (const node of nodes(before)) {
    const remaining = after.findById(node.id);
    if (remaining) assert.deepEqual(remaining.getAttributes(), node.getAttributes());
  }
}

function roundTrip(editor: EditorService, command: Command, check: (after: SvgDocument, before: SvgDocument) => void): void {
  const before = snapshot(editor);
  const previousCount = editor.getHistoryStatus().undoCount;
  const result = editor.execute(command);
  assert.equal(typeof result.summary, 'string');
  assert.equal(Object.isFrozen(result), true);
  const after = snapshot(editor);
  check(after, before);
  assertAttributesPreserved(after, before);
  assert.equal(editor.getHistoryStatus().undoCount, previousCount + 1);
  assert.equal(editor.getHistoryStatus().redoCount, 0);
  editor.undo();
  assertRestored(snapshot(editor), before);
  assert.equal(editor.getHistoryStatus().undoCount, previousCount);
  assert.equal(editor.getHistoryStatus().redoCount, 1);
  editor.redo();
  assertRestored(snapshot(editor), after);
  assert.equal(editor.getHistoryStatus().undoCount, previousCount + 1);
  assert.equal(editor.getHistoryStatus().redoCount, 0);
}

const types: { type: string; attributes: Record<string, AttributeValue> }[] = [
  { type: 'rect', attributes: { x: 1, y: 2, width: 3, height: 4, fill: 'red' } },
  { type: 'circle', attributes: { cx: 1, cy: 2, r: 3 } },
  { type: 'ellipse', attributes: { cx: 1, cy: 2, rx: 3, ry: 4 } },
  { type: 'line', attributes: { x1: 1, y1: 2, x2: 3, y2: 4, stroke: 'blue' } },
  { type: 'text', attributes: { x: 1, y: 2, text: 'new text' } },
  { type: 'g', attributes: {} },
];

for (const { type, attributes } of types) {
  for (const parentId of [undefined, 'P']) {
    test(`CreateCommand ${type} at ${parentId ?? 'root'} has an independent Undo/Redo unit`, () => {
      roundTrip(service(), new CreateCommand(type, 'created', attributes, parentId), doc => {
        const shape = doc.findById('created')!;
        assert.equal(shape.type, type);
        assert.deepEqual(shape.getAttributes(), { id: 'created', ...attributes });
        assert.equal(doc.parentOf('created')?.id, parentId);
        if (parentId === undefined) order(doc, undefined, ['scene', 'tail', 'created']);
        else order(doc, 'P', ['inner', 'x', 'created']);
        if (!Object.hasOwn(attributes, 'fill')) {
          assert.equal(shape.getAttribute('fill'), undefined);
          assert.equal(Object.hasOwn(shape.getAttributes(), 'fill'), false);
        }
      });
    });
  }
}

test('CreateCommand copies attributes and creates fresh owned objects on every execution', () => {
  const attributes: Record<string, AttributeValue> = { x: 1, y: 2, width: 3, height: 4 };
  const command = new CreateCommand('rect', 'created', attributes);
  attributes.x = 999; attributes.fill = 'external'; delete attributes.height;
  const first = new SvgDocument(); const second = new SvgDocument();
  command.execute(first); command.execute(second);
  assert.equal(first.findById('created')!.getAttribute('x'), 1);
  assert.equal(second.findById('created')!.getAttribute('height'), 4);
  assert.equal(first.findById('created')!.getAttribute('fill'), undefined);
  assertRestored(second, first);
  const before = tree(first);
  assert.throws(() => command.execute(first), /id already exists/);
  assert.deepEqual(tree(first), before);
  const editor = service(); editor.execute(command);
  const committed = snapshot(editor); const status = editor.getHistoryStatus();
  assert.throws(() => editor.execute(command), /id already exists/);
  assert.deepEqual(editor.getHistoryStatus(), status); assertRestored(snapshot(editor), committed);
  editor.undo(); editor.execute(command);
  assertRestored(snapshot(editor), committed);
  assert.equal(editor.getHistoryStatus().redoCount, 0);
});

test('CreateCommand can retry after failed parent insertion without reusing an already-owned shape', () => {
  const command = new CreateCommand('g', 'created', {}, 'parent');
  const doc = new SvgDocument();
  assert.throws(() => command.execute(doc), /no such container/);
  assert.equal(doc.findById('created'), undefined);
  doc.insert(new GroupShape('parent'));
  command.execute(doc);
  assert.equal(doc.parentOf('created')!.id, 'parent');
  assertConsistent(doc);
});

for (const id of ['a', 'P', 'scene']) {
  test(`DeleteCommand ${id} restores complete removed content, attributes and position`, () => {
    roundTrip(service(), new DeleteCommand(id), (doc, before) => {
      for (const node of TreeOwnership.nodes(before.findById(id)!)) assert.equal(doc.findById(node.id), undefined);
      if (id === 'a') order(doc, 'inner', ['s']);
      else if (id === 'P') order(doc, 'scene', ['head', 'Q', 'foot']);
      else order(doc, undefined, ['tail']);
    });
  });
}

for (const choice of [
  { name: 'same-parent noncontiguous subtrees', ids: ['foot', 'P'], members: ['P', 'foot'], parent: 'scene' },
  { name: 'single node', ids: ['a'], members: ['a'], parent: 'inner' },
  { name: 'cross-parent and cross-depth leaves', ids: ['b', 'a'], members: ['a', 'b'], parent: 'scene' },
  { name: 'nested container and foreign leaf', ids: ['b', 'inner'], members: ['inner', 'b'], parent: 'scene' },
]) {
  test(`GroupCommand ${choice.name} restores exact original parents and order with one Undo`, () => {
    roundTrip(service(), new GroupCommand('combined', choice.ids), doc => {
      order(doc, 'combined', choice.members);
      assert.equal(doc.parentOf('combined')!.id, choice.parent);
      if (choice.name === 'same-parent noncontiguous subtrees') order(doc, 'scene', ['head', 'combined', 'Q']);
      if (choice.ids.includes('b')) {
        order(doc, 'scene', ['head', 'combined', 'P', 'Q', 'foot']);
        order(doc, 'Q', ['y']);
      }
      if (choice.ids.includes('inner')) { order(doc, 'inner', ['a', 's']); order(doc, 'P', ['x']); }
      if (choice.ids.includes('a') && choice.ids.includes('b')) order(doc, 'inner', ['s']);
    });
  });
}

test('GroupCommand with the SVG document root as common container restores root and deep parents', () => {
  roundTrip(service(), new GroupCommand('combined', ['tail', 'a']), doc => {
    order(doc, undefined, ['combined', 'scene']);
    order(doc, 'combined', ['a', 'tail']);
    order(doc, 'inner', ['s']);
    assert.equal(doc.parentOf('combined'), undefined);
    assert.equal(doc.parentOf('a')!.id, 'combined');
    assert.equal(doc.parentOf('tail')!.id, 'combined');
  });
});

test('GroupCommand snapshots its input list and rejects invalid reuse without modifying history', () => {
  const ids = ['b', 'a'];
  const command = new GroupCommand('combined', ids);
  ids[0] = 'missing'; ids.push('a');
  const editor = service(); editor.execute(command);
  order(snapshot(editor), 'combined', ['a', 'b']);
  const before = snapshot(editor); const status = editor.getHistoryStatus();
  assert.throws(() => editor.execute(command), /id already exists/);
  assert.deepEqual(editor.getHistoryStatus(), status); assertRestored(snapshot(editor), before);
  editor.undo(); editor.execute(command);
  assertRestored(snapshot(editor), before);
  const other = service(); other.execute(command);
  assertRestored(snapshot(other), before);
});

for (const id of ['head', 'inner', 'single', 'P']) {
  test(`UngroupCommand ${id} promotes only direct children and Undo restores the removed container`, () => {
    const doc = fixture();
    if (id === 'single') doc.insert(new GroupShape('single', [new TextShape('only', 1, 2, 'only')]), 'P');
    roundTrip(service(doc), new UngroupCommand(id), after => {
      assert.equal(after.findById(id), undefined);
      if (id === 'head') order(after, 'scene', ['P', 'Q', 'foot']);
      if (id === 'inner') order(after, 'P', ['a', 's', 'x']);
      if (id === 'single') order(after, 'P', ['inner', 'x', 'only']);
      if (id === 'P') { order(after, 'scene', ['head', 'inner', 'x', 'Q', 'foot']); order(after, 'inner', ['a', 's']); }
    });
  });
}

test('ungroup after cross-parent grouping promotes into the current parent; Undo recovers both distinct states', () => {
  const editor = service(); const initial = snapshot(editor);
  editor.execute(new GroupCommand('combined', ['b', 'a'])); const grouped = snapshot(editor);
  editor.execute(new UngroupCommand('combined')); const ungrouped = snapshot(editor);
  order(ungrouped, 'scene', ['head', 'a', 'b', 'P', 'Q', 'foot']);
  assert.equal(ungrouped.parentOf('a')!.id, 'scene'); assert.equal(ungrouped.parentOf('b')!.id, 'scene');
  assert.equal(editor.getHistoryStatus().undoCount, 2);
  editor.undo(); assertRestored(snapshot(editor), grouped);
  editor.undo(); assertRestored(snapshot(editor), initial);
  editor.redo(); assertRestored(snapshot(editor), grouped);
  editor.redo(); assertRestored(snapshot(editor), ungrouped);
});

for (const choice of [
  { name: 'root subtree', parent: 'P', id: 'tail', order: ['inner', 'x', 'tail'] },
  { name: 'nested subtree between groups', parent: 'Q', id: 'inner', order: ['b', 'y', 'inner'] },
  { name: 'same parent reorder', parent: 'Q', id: 'b', order: ['y', 'b'] },
  { name: 'already last', parent: 'Q', id: 'y', order: ['b', 'y'] },
]) {
  test(`AddToCommand ${choice.name} has consistent ownership and snapshot restoration`, () => {
    roundTrip(service(), new AddToCommand(choice.parent, choice.id), doc => {
      order(doc, choice.parent, choice.order);
      assert.equal(doc.parentOf(choice.id)!.id, choice.parent);
      if (choice.id === 'inner') { order(doc, 'P', ['x']); order(doc, 'inner', ['a', 's']); }
      if (choice.id === 'tail') order(doc, undefined, ['scene']);
    });
  });
}

for (const front of [true, false]) {
  for (const nested of [true, false]) {
    test(`${front ? 'Front' : 'Back'}Command changes ${nested ? 'nested' : 'root'} order and restores it`, () => {
      const id = nested ? 'P' : front ? 'scene' : 'tail';
      roundTrip(service(), front ? new FrontCommand(id) : new BackCommand(id), doc => {
        order(doc, nested ? 'scene' : undefined, nested
          ? front ? ['head', 'Q', 'foot', 'P'] : ['P', 'head', 'Q', 'foot'] : ['tail', 'scene']);
      });
    });
  }
}

const failures: { name: string; command: Command; message: RegExp }[] = [
  { name: 'unknown type', command: new CreateCommand('hexagon', 'new'), message: /unknown shape type/ },
  { name: 'box outside scope', command: new CreateCommand('box', 'new'), message: /unknown shape type/ },
  { name: 'duplicate create id', command: new CreateCommand('g', 'a'), message: /id already exists/ },
  { name: 'missing geometry', command: new CreateCommand('rect', 'new'), message: /finite number/ },
  { name: 'nonfinite geometry', command: new CreateCommand('circle', 'new', { cx: 1, cy: 2, r: Infinity }), message: /finite number/ },
  { name: 'negative geometry', command: new CreateCommand('rect', 'new', { x: 1, y: 2, width: -1, height: 4 }), message: /nonnegative/ },
  { name: 'unknown create attribute', command: new CreateCommand('g', 'new', { arbitrary: 1 }), message: /unknown attribute/ },
  { name: 'missing create parent', command: new CreateCommand('g', 'new', {}, 'missing'), message: /no such container/ },
  { name: 'leaf create parent', command: new CreateCommand('g', 'new', {}, 'a'), message: /not a container/ },
  { name: 'missing delete target', command: new DeleteCommand('missing'), message: /no such shape/ },
  { name: 'duplicate group id', command: new GroupCommand('scene', ['a']), message: /id already exists/ },
  { name: 'duplicate selection', command: new GroupCommand('new', ['a', 'a']), message: /duplicate selection/ },
  { name: 'late missing selection', command: new GroupCommand('new', ['a', 'missing']), message: /no such shape/ },
  { name: 'ancestor and descendant', command: new GroupCommand('new', ['P', 'a']), message: /own descendant/ },
  { name: 'empty group selection', command: new GroupCommand('new', []), message: /at least one/ },
  { name: 'blank new id', command: new GroupCommand(' ', ['a']), message: /id must not be empty/ },
  { name: 'top-level ungroup', command: new UngroupCommand('scene'), message: /top-level/ },
  { name: 'leaf ungroup', command: new UngroupCommand('a'), message: /not a container/ },
  { name: 'missing ungroup', command: new UngroupCommand('missing'), message: /no such shape/ },
  { name: 'addto self', command: new AddToCommand('P', 'P'), message: /cycle/ },
  { name: 'addto descendant', command: new AddToCommand('inner', 'P'), message: /cycle/ },
  { name: 'missing addto node', command: new AddToCommand('P', 'missing'), message: /no such shape/ },
  { name: 'missing addto container', command: new AddToCommand('missing', 'a'), message: /no such container/ },
  { name: 'leaf addto container', command: new AddToCommand('a', 'b'), message: /not a container/ },
  { name: 'missing front target', command: new FrontCommand('missing'), message: /no such shape/ },
  { name: 'missing back target', command: new BackCommand('missing'), message: /no such shape/ },
];

for (const { name, command, message } of failures) {
  test(`failed structure edit (${name}) preserves document/path/history and can still Redo`, () => {
    const editor = service(); editor.execute(new MoveCommand('a', 1, 0));
    const edited = snapshot(editor); editor.undo();
    const before = snapshot(editor); const status = editor.getHistoryStatus();
    assert.throws(() => editor.execute(command), message);
    assertRestored(snapshot(editor), before);
    assert.deepEqual(editor.getHistoryStatus(), status);
    editor.redo(); assertRestored(snapshot(editor), edited);
  });
}

test('failed structure command preserves disabled history; successful creation alone re-enables it', () => {
  const editor = new EditorService(new EditorSession(fixture(), 'original.svg'), new HistoryManager().resetBoundary());
  const before = snapshot(editor); const status = editor.getHistoryStatus();
  assert.throws(() => editor.execute(new GroupCommand('bad', ['P', 'a'])), /own descendant/);
  assertRestored(snapshot(editor), before); assert.deepEqual(editor.getHistoryStatus(), status);
  editor.execute(new CreateCommand('g', 'created'));
  assert.equal(editor.getHistoryStatus().disabled, false);
  editor.undo(); assertRestored(snapshot(editor), before);
});

test('ten mixed edits undo and redo every full tree state, including id reuse after subtree deletion', () => {
  const editor = service();
  const commands: Command[] = [
    new CreateCommand('circle', 'created', { cx: 1, cy: 2, r: 3 }, 'P'),
    new GroupCommand('combined', ['b', 'a']), new AddToCommand('Q', 'combined'),
    new FrontCommand('a'), new BackCommand('a'), new UngroupCommand('combined'),
    new DeleteCommand('inner'), new SetAttributeCommand('y', 'stroke', 'purple'),
    new DeleteCommand('Q'), new CreateCommand('rect', 'a', { x: 50, y: 60, width: 70, height: 80 }, 'P'),
  ];
  const states = [snapshot(editor)];
  for (const command of commands) { editor.execute(command); states.push(snapshot(editor)); }
  for (let index = commands.length - 1; index >= 0; index--) {
    editor.undo(); assertRestored(snapshot(editor), states[index]!);
    assert.equal(editor.getHistoryStatus().undoCount, index);
    assert.equal(editor.getHistoryStatus().redoCount, commands.length - index);
  }
  for (let index = 1; index <= commands.length; index++) {
    editor.redo(); assertRestored(snapshot(editor), states[index]!);
    assert.equal(editor.getHistoryStatus().undoCount, index);
    assert.equal(editor.getHistoryStatus().redoCount, commands.length - index);
  }
});

test('Undo and Redo restore snapshots without calling Group/Ungroup behavior again', t => {
  const editor = service(); const initial = snapshot(editor);
  editor.execute(new GroupCommand('combined', ['b', 'a'])); const grouped = snapshot(editor);
  t.mock.method(GroupCommand.prototype, 'execute', () => { throw new Error('must not replay Command'); });
  t.mock.method(SvgDocument.prototype, 'group', () => { throw new Error('must not group'); });
  t.mock.method(SvgDocument.prototype, 'ungroup', () => { throw new Error('must not reverse group'); });
  editor.undo(); assertRestored(snapshot(editor), initial);
  editor.redo(); assertRestored(snapshot(editor), grouped);
});

test('reused Delete/Ungroup Commands fail while absent and work again after Undo restoration', () => {
  for (const command of [new DeleteCommand('a'), new UngroupCommand('inner')]) {
    const editor = service(); const initial = snapshot(editor);
    editor.execute(command); const edited = snapshot(editor); const status = editor.getHistoryStatus();
    assert.throws(() => editor.execute(command), /no such shape/);
    assertRestored(snapshot(editor), edited); assert.deepEqual(editor.getHistoryStatus(), status);
    editor.undo(); assertRestored(snapshot(editor), initial);
    editor.execute(command); assertRestored(snapshot(editor), edited);
    assert.equal(editor.getHistoryStatus().redoCount, 0);
  }
});

test('reused reparenting and ordering Commands are legal no-change edits when already positioned', () => {
  for (const command of [new AddToCommand('Q', 'b'), new FrontCommand('P'), new BackCommand('Q')]) {
    const editor = service(); editor.execute(command); const edited = snapshot(editor);
    editor.execute(command); assertRestored(snapshot(editor), edited);
    assert.equal(editor.getHistoryStatus().undoCount, 2);
    editor.undo(); assertRestored(snapshot(editor), edited);
    assert.equal(editor.getHistoryStatus().redoCount, 1);
  }
});
