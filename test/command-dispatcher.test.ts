import assert from 'node:assert/strict';
import test from 'node:test';
import { CommandDispatcher } from '../src/cli/CommandDispatcher.js';
import { Presenter } from '../src/cli/Presenter.js';
import { EditorService } from '../src/application/EditorService.js';
import { EditorSession } from '../src/application/EditorSession.js';
import { SvgDocument } from '../src/domain/SvgDocument.js';

function fixture(): { s: EditorService; d: CommandDispatcher } {
  const s = new EditorService(new EditorSession(new SvgDocument(400, 300), 'kept.svg'));
  const d = new CommandDispatcher(s);
  for (const line of ['create g g', 'create rect r 1 2 3 4 red in g', 'create text t 5 6 "hello" in g']) d.dispatch(line);
  d.dispatch('move r 1 0'); d.dispatch('set t text "after"'); d.dispatch('undo');
  return { s, d };
}
function capture(s: EditorService): unknown {
  return { document: s.hasDocument ? s.getTreeView() : undefined, history: s.getHistoryStatus(), path: s.defaultSavePath };
}
for (const [line, type, expected] of [
  ['create rect r 1 2 3 4', 'rect', { id: 'r', x: 1, y: 2, width: 3, height: 4 }],
  ['create circle c 1 2 3 red', 'circle', { id: 'c', cx: 1, cy: 2, r: 3, fill: 'red' }],
  ['create ellipse e 1 2 3 4 blue', 'ellipse', { id: 'e', cx: 1, cy: 2, rx: 3, ry: 4, fill: 'blue' }],
  ['create line l 1 2 3 4 black', 'line', { id: 'l', x1: 1, y1: 2, x2: 3, y2: 4, stroke: 'black' }],
  ['create text t 1 2 "你好 世界"', 'text', { id: 't', x: 1, y: 2, text: '你好 世界' }],
  ['create g g', 'g', { id: 'g' }],
] as const) {
  for (const nested of [false, true]) {
    test(`generic creation parsing: ${type}, nested=${nested}`, () => {
      const s = new EditorService(); const d = new CommandDispatcher(s); d.dispatch('init');
      d.dispatch('create g parent'); d.dispatch(line + (nested ? ' in parent' : ''));
      const shape = s.getShapeView(expected.id);
      assert.equal(shape.type, type); assert.deepEqual(shape.attributes, expected);
      assert.equal(shape.parentId, nested ? 'parent' : undefined);
    });
  }
}
test('all memory commands share the existing execution/history chain', () => {
  const s = new EditorService(); const d = new CommandDispatcher(s);
  assert.equal(d.dispatch('init 400 300'), 'canvas 400x300 created');
  d.dispatch('create g outer'); d.dispatch('create g target in outer');
  d.dispatch('create rect r 1 2 3 4 in outer'); d.dispatch('create text t 5 6 "hello" in outer');
  d.dispatch('move r 10 20'); d.dispatch('scale r 2'); d.dispatch('set r stroke-width .5');
  assert.equal(s.getShapeView('r').attributes.x, 22); assert.equal(s.getShapeView('r').attributes.width, 6);
  d.dispatch('group inner t r');
  assert.deepEqual(s.getShapeView('inner').children.map(n => n.id), ['r', 't']);
  d.dispatch('ungroup inner'); d.dispatch('undo'); assert.equal(s.getShapeView('r').parentId, 'inner');
  d.dispatch('redo'); assert.equal(s.getShapeView('r').parentId, 'outer');
  d.dispatch('addto target r'); assert.equal(s.getShapeView('r').parentId, 'target');
  d.dispatch('front target'); assert.deepEqual(s.getShapeView('outer').children.map(n => n.id), ['t', 'target']);
  d.dispatch('back target'); assert.deepEqual(s.getShapeView('outer').children.map(n => n.id), ['target', 't']);
  d.dispatch('delete target'); assert.throws(() => s.getShapeView('r'), /no such shape/);
  d.dispatch('undo'); assert.equal(s.getShapeView('r').attributes['stroke-width'], .5);
  const before = capture(s); assert.match(d.dispatch('tree'), /w=6 h=8/); assert.match(d.dispatch('show r'), /parent=g#target/);
  assert.equal(d.dispatch('canvas'), 'canvas 400x300'); d.dispatch('help'); assert.deepEqual(capture(s), before);
  d.dispatch('canvas 500 400'); assert.equal(s.getHistoryStatus().disabled, true);
  assert.throws(() => d.dispatch('undo'), { message: 'undo not allowed after io command' });
  d.dispatch('move r 0 0'); d.dispatch('undo'); assert.equal(s.getHistoryStatus().disabled, false);
  assert.throws(() => d.dispatch('undo'), /nothing to undo/);
});
test('quoted in, empty text, escaped text and hex colors are preserved as values', () => {
  const s = new EditorService(); const d = new CommandDispatcher(s); d.dispatch('init'); d.dispatch('create g g');
  d.dispatch('create text t 1 2 "in" in g'); assert.equal(s.getShapeView('t').attributes.text, 'in');
  d.dispatch('create text empty 0 0 ""'); assert.equal(s.getShapeView('empty').attributes.text, '');
  d.dispatch('create text label 0 0 "in"'); assert.equal(s.getShapeView('label').attributes.text, 'in');
  d.dispatch('set t text "a\\"b\\\\c"'); assert.equal(s.getShapeView('t').attributes.text, 'a"b\\c');
  d.dispatch('set t text "123"'); assert.equal(s.getShapeView('t').attributes.text, '123');
  d.dispatch('set t fill 123'); assert.equal(s.getShapeView('t').attributes.fill, '123');
  d.dispatch('set t x "7.5"'); assert.equal(s.getShapeView('t').attributes.x, 7.5);
  d.dispatch('set t text 456'); assert.equal(s.getShapeView('t').attributes.text, '456');
  d.dispatch('create rect color 0 0 1 1 #ffffff'); assert.equal(s.getShapeView('color').attributes.fill, '#ffffff');
});
for (const value of ['12abc', 'Infinity', 'NaN', '0x10', '0b10', '1_000', '1e309', '""', '" 1 "', '--1']) {
  test(`strict numeric parsing rejects ${value} without affecting Redo`, () => {
    const { s, d } = fixture(); const before = capture(s);
    for (const line of [`move r ${value} 0`, `scale r ${value}`, `set r x ${value}`, `canvas ${value} 100`, `init 100 ${value}`, `create circle bad 0 0 ${value}`]) {
      assert.throws(() => d.dispatch(line), /invalid number/); assert.deepEqual(capture(s), before);
    }
    d.dispatch('redo'); assert.equal(s.getShapeView('t').attributes.text, 'after');
  });
}
test('strict decimals accept signs, fractions and exponents', () => {
  const s = new EditorService(); const d = new CommandDispatcher(s);
  d.dispatch('init 1e3 +2E2'); d.dispatch('create rect r -.5 +.25 3. 4e-1'); d.dispatch('move r +1e1 -2.5');
  assert.deepEqual(s.getShapeView('r').attributes, { id: 'r', x: 9.5, y: -2.25, width: 3, height: .4 });
});
for (const line of ['init 10', 'init 1 2 3', 'canvas 10', 'canvas 1 2 3', 'move r 1', 'move r 1 2 extra',
  'scale r', 'set r x', 'delete', 'delete r extra', 'group x', 'ungroup', 'addto g', 'front r extra', 'back',
  'tree r extra', 'show', 'show r extra', 'undo extra', 'redo extra', 'help extra', 'create g new extra',
  'create rect new 1 2 3', 'create text new 1 2 "hello" extra', 'create rect new 1 2 3 4 red extra', 'create g new in',
  'create rect new 1 2 3 4 "in" g', 'move r 1 2 # comment']) {
  test(`invalid arity/suffix preserves formal state: ${line}`, () => {
    const { s, d } = fixture(); const before = capture(s);
    assert.throws(() => d.dispatch(line)); assert.deepEqual(capture(s), before);
    d.dispatch('redo'); assert.equal(s.getShapeView('t').attributes.text, 'after');
  });
}
for (const line of ['create box b', 'create Rect b', 'create rect r 0 0 1 1', 'create g new in missing',
  'create g new in r', 'create rect new 0 0 -1 2', 'move missing 1 2', 'scale r 0', 'set r text "x"',
  'set r id new', 'set r stroke-width -1', 'group bad g r', 'group bad r r', 'ungroup g', 'addto g g',
  'front missing', 'back missing', 'tree missing', 'show missing']) {
  test(`domain failure retains original state and Redo: ${line}`, () => {
    const { s, d } = fixture(); const before = capture(s);
    assert.throws(() => d.dispatch(line)); assert.deepEqual(capture(s), before);
    d.dispatch('redo'); assert.equal(s.getShapeView('t').attributes.text, 'after');
  });
}
test('error priority is lexical, unknown name, then known-command no-document before arity/numbers', () => {
  const s = new EditorService(); const d = new CommandDispatcher(s); const before = capture(s);
  assert.throws(() => d.dispatch('move "unfinished'), /unterminated/);
  assert.throws(() => d.dispatch('unknown bad'), /unknown command: unknown/);
  for (const syntax of d.getHelpSyntaxes()) {
    const name = syntax.split(' ')[0]!;
    if (name !== 'init' && name !== 'help') assert.throws(() => d.dispatch(`${name} invalid extra`), { message: "no document. use 'init' or 'read' first" });
  }
  assert.throws(() => d.dispatch('init 10'), /zero or two/); assert.deepEqual(capture(s), before);
  assert.match(d.dispatch('help'), /create/); d.dispatch('init'); assert.equal(s.hasDocument, true);
});
test('blank/comment/help/query do not change disabled history, and malformed input does not prevent later calls', () => {
  const s = new EditorService(); const d = new CommandDispatcher(s); d.dispatch('init'); const before = capture(s);
  for (const line of ['', '\t ', '  # ignored "', 'help', 'tree', 'canvas']) d.dispatch(line);
  assert.throws(() => d.dispatch('set "'), /unterminated/); assert.deepEqual(capture(s), before);
  d.dispatch('create g g'); assert.equal(s.getHistoryStatus().disabled, false);
});
test('one command catalogue drives help; read/save are absent and genuinely unknown', () => {
  const { s, d } = fixture(); const before = capture(s); const syntaxes = d.getHelpSyntaxes();
  assert.equal(syntaxes.length, 17); assert.equal(new Set(syntaxes.map(s => s.split(' ')[0])).size, 17);
  assert(Object.isFrozen(syntaxes));
  const help = d.dispatch('help'); for (const syntax of syntaxes) assert(help.split('\n').includes(syntax));
  for (const type of s.getCreationTypes()) assert(help.includes(`create ${type} <id>`));
  for (const name of ['read', 'save', 'HELP', 'constructor', '__proto__']) assert.throws(() => d.dispatch(name), /unknown command/);
  assert.deepEqual(capture(s), before);
});
test('domain errors remain raw until Presenter adds one prefix', () => {
  const { d } = fixture(); let error: unknown;
  try { d.dispatch('move missing 1 2'); } catch (caught) { error = caught; }
  assert(error instanceof Error); assert.equal(error.message, 'no such shape: missing');
  assert.equal(new Presenter().error(error), 'error: no such shape: missing');
});
