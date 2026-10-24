import assert from 'node:assert/strict';
import test from 'node:test';
import { SvgCodec } from '../src/svg/SvgCodec.js';
import { SvgDocument } from '../src/domain/SvgDocument.js';
import { ShapeFactory } from '../src/domain/ShapeFactory.js';
import { GroupShape } from '../src/domain/GroupShape.js';
import { RectShape } from '../src/domain/RectShape.js';
import { TextShape } from '../src/domain/TextShape.js';
import { TreeOwnership } from '../src/domain/TreeOwnership.js';
import { EditorService } from '../src/application/EditorService.js';
import { EditorSession } from '../src/application/EditorSession.js';
import { HistoryManager } from '../src/application/HistoryManager.js';
import { MoveCommand } from '../src/application/commands/MoveCommand.js';
import { GroupCommand } from '../src/application/commands/GroupCommand.js';
import { UngroupCommand } from '../src/application/commands/UngroupCommand.js';
import { DeleteCommand } from '../src/application/commands/DeleteCommand.js';
import { SetAttributeCommand } from '../src/application/commands/SetAttributeCommand.js';

const attributes = { 'font-size': '12px', 'font-family': 'Noto Sans, serif', 'font-weight': '500',
  'text-anchor': 'end', opacity: '.5', 'fill-opacity': '0', 'stroke-opacity': '1', 'data-note': 'a & "b"\t\n\r', 'xml:space': 'preserve' };
const source = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" fill="red" opacity=".8"><g id="outer" font-family="serif"><g id="left"><rect id="a" x="1" y="2" width="3" height="4" opacity=".4"/></g><g id="right"><text id="b" x="5" y="6" font-size="12">hello</text></g></g></svg>';

for (const type of new ShapeFactory().getTypes()) {
  test(`${type}: safe properties are isolated, non-editable and cloned outside rollback attributes`, () => {
    const factory = new ShapeFactory(); const fields = Object.fromEntries(factory.describe(type).parameters
      .filter(p => !p.optional).map(p => [p.name, p.kind === 'number' ? 1 : 'text']));
    const shape = factory.create(type, 'shape', fields); const input = { ...attributes };
    shape.setPreservedAttributes(input); const before = shape.getAttributes();
    input['font-size'] = '99'; assert.equal(shape.getPreservedAttributes()['font-size'], '12px');
    assert(Object.isFrozen(shape.getPreservedAttributes()));
    assert.throws(() => Object.assign(shape.getPreservedAttributes(), { opacity: '1' }), TypeError);
    const copy = shape.clone(); assert.equal(copy.constructor, shape.constructor);
    assert.deepEqual(copy.getPreservedAttributes(), attributes); assert.notEqual(copy.getPreservedAttributes(), shape.getPreservedAttributes());
    copy.setPreservedAttributes({ opacity: '1' }); assert.deepEqual(shape.getPreservedAttributes(), attributes);
    assert.deepEqual(shape.getAttributes(), before);
    assert.throws(() => shape.setAttribute('font-size', 3), /unknown attribute/);
    assert.throws(() => shape.getAttribute('opacity'), /unknown attribute/);
  });
}
for (const [name, value] of [
  ['font-size', '-1'], ['font-size', '20%'], ['font-size', 'Infinity'], ['font-weight', '550'],
  ['font-family', ''], ['font-family', 'url(http://bad)'], ['font-family', 'serif;fill:red'],
  ['text-anchor', 'outside'], ['opacity', '1.1'], ['fill-opacity', '-.1'], ['stroke-opacity', 'NaN'],
  ['data-Bad', 'x'], ['data-', 'x'], ['transform', 'translate(1)'], ['style', 'fill:red'], ['id', 'new'],
  ['x', '1'], ['fill', 'red'], ['onclick', 'bad'], ['href', 'bad'], ['xml:space', 'invalid'],
  ['data-note', '\u0000'], ['data-note', '\ud800'], ['__proto__', 'x'],
] as const) {
  test(`invalid metadata ${name}=${JSON.stringify(value)} leaves all shape state unchanged`, () => {
    const shape = new RectShape('r', 1, 2, 3, 4); shape.setPreservedAttributes(attributes);
    const before = shape.getAttributes();
    assert.throws(() => shape.setPreservedAttributes(Object.fromEntries([['opacity', '0'], [name, value]])));
    assert.deepEqual(shape.getAttributes(), before); assert.deepEqual(shape.getPreservedAttributes(), attributes);
  });
}
test('root properties have a controlled independent whitelist and participate in document clone', () => {
  const doc = new SvgDocument(); const root = { ...attributes, fill: '#abc', stroke: 'blue', 'stroke-width': '2px' };
  doc.setPreservedAttributes(root); root.fill = 'outside';
  assert.equal(doc.getPreservedAttributes().fill, '#abc');
  const copy = doc.clone(); assert.deepEqual(copy.getPreservedAttributes(), doc.getPreservedAttributes());
  assert.notEqual(copy.getPreservedAttributes(), doc.getPreservedAttributes()); copy.setPreservedAttributes({ fill: 'green' });
  assert.equal(doc.getPreservedAttributes().fill, '#abc');
  for (const name of ['id', 'width', 'height', 'viewBox', 'xmlns', 'style', 'transform']) {
    assert.throws(() => doc.setPreservedAttributes({ opacity: '0', [name]: 'bad' }));
    assert.equal(doc.getPreservedAttributes().fill, '#abc');
  }
  assert.throws(() => doc.setPreservedAttributes({ fill: 'url(#a)' }), /resource reference/);
  assert.throws(() => doc.setPreservedAttributes({ 'stroke-width': '-1' }), /nonnegative/);
});
for (const operation of ['move', 'scale'] as const) {
  test(`nested ${operation} failure restores geometry and retains every preserved property and identity`, () => {
    const first = new RectShape('first', 1, 2, 3, 4);
    const last = new TextShape('last', 5, Number.MAX_VALUE, 'hello');
    const inner = new GroupShape('inner', [last]); const outer = new GroupShape('outer', [first, inner]);
    const document = new SvgDocument(); document.insert(outer); document.setPreservedAttributes({ opacity: '.7' });
    for (const node of [outer, first, inner, last]) node.setPreservedAttributes(attributes);
    const nodes = [outer, first, inner, last];
    const before = nodes.map(node => ({ editable: node.getAttributes(), preserved: node.getPreservedAttributes() }));
    assert.throws(() => operation === 'move' ? outer.move(1, Number.MAX_VALUE) : outer.scale(2), /finite/);
    assert.deepEqual(nodes.map(node => ({ editable: node.getAttributes(), preserved: node.getPreservedAttributes() })), before);
    assert.equal(outer.children[0], first); assert.equal(outer.children[1], inner); assert.equal(inner.children[0], last);
    for (const node of nodes) assert.equal(document.findById(node.id), node);
    assert.equal(TreeOwnership.ownerOf(first), outer); assert.equal(TreeOwnership.ownerOf(last), inner);
    assert.equal(document.getPreservedAttributes().opacity, '.7');
  });
}
test('preserved properties follow actual nodes through group, ungroup, reparent, reorder, removal and reinsertion', () => {
  const codec = new SvgCodec(); const doc = codec.decode(source).document;
  const a = doc.findById('a')!; const b = doc.findById('b')!;
  doc.group('new', ['b', 'a']); assert.equal(doc.findById('a'), a); assert.equal(a.getPreservedAttributes().opacity, '.4');
  doc.ungroup('new'); assert.equal(doc.parentOf('a')!.id, 'outer'); assert.equal(doc.parentOf('b')!.id, 'outer');
  doc.addTo('right', 'a'); doc.front('a'); doc.back('a');
  const detached = doc.remove('right'); assert.equal(doc.findById('a'), undefined);
  doc.insert(detached, 'outer'); assert.equal(doc.findById('a'), a); assert.equal(doc.findById('b'), b);
  const copy = doc.clone(); assert.notEqual(copy.findById('a'), a);
  copy.findById('a')!.setPreservedAttributes({ opacity: '.9' }); assert.equal(a.getPreservedAttributes().opacity, '.4');
  assert.equal(codec.decode(codec.encode(doc)).document.findById('a')!.getPreservedAttributes().opacity, '.4');
});
test('Service Undo/Redo restores root/node metadata, complete subtrees and original parents independently', () => {
  const codec = new SvgCodec(); const input = codec.decode(source).document;
  const service = new EditorService(new EditorSession(input, 'kept.svg'));
  const snapshot = (): string => codec.encode(service.getDocumentSnapshot()!);
  const states = [snapshot()];
  for (const command of [new GroupCommand('combined', ['a', 'b']), new MoveCommand('combined', 1, 2),
    new UngroupCommand('combined'), new DeleteCommand('outer')]) { service.execute(command); states.push(snapshot()); }
  for (let i = states.length - 2; i >= 0; i--) { service.undo(); assert.equal(snapshot(), states[i]); }
  assert.equal(service.getDocumentSnapshot()!.parentOf('a')!.id, 'left');
  for (let i = 1; i < states.length; i++) { service.redo(); assert.equal(snapshot(), states[i]); }
  service.undo(); const before = snapshot(); const history = service.getHistoryStatus();
  assert.throws(() => service.execute(new SetAttributeCommand('a', 'opacity', 0)), /unknown attribute/);
  assert.equal(snapshot(), before); assert.deepEqual(service.getHistoryStatus(), history);
  const exposed = service.getDocumentSnapshot()!; exposed.findById('a')!.setPreservedAttributes({ opacity: '1' });
  input.findById('a')!.setPreservedAttributes({ opacity: '0' }); assert.equal(snapshot(), before);
  assert.equal(service.defaultSavePath, 'kept.svg'); service.redo(); assert.equal(snapshot(), states.at(-1));
});
test('HistoryManager versions with identical ids do not cross-pollute metadata snapshots or returned documents', () => {
  const codec = new SvgCodec(); const before = codec.decode(source).document; const after = before.clone();
  after.findById('a')!.setPreservedAttributes({ opacity: '.9' }); after.setPreservedAttributes({ fill: 'blue' });
  const h1 = new HistoryManager().recordEdit(before); const h2 = h1.recordEdit(after);
  before.findById('a')!.setPreservedAttributes({ opacity: '0' });
  const first = h1.prepareUndo(after).document; assert.equal(first.findById('a')!.getPreservedAttributes().opacity, '.4');
  first.findById('a')!.setPreservedAttributes({ opacity: '1' });
  assert.equal(h1.prepareUndo(after).document.findById('a')!.getPreservedAttributes().opacity, '.4');
  const second = h2.prepareUndo(before); assert.equal(second.document.findById('a')!.getPreservedAttributes().opacity, '.9');
  assert.equal(second.history.prepareUndo(second.document).document.findById('a')!.getPreservedAttributes().opacity, '.4');
});
test('metadata XML escaping preserves whitespace and punctuation without sharing caller state', () => {
  const codec = new SvgCodec(); const doc = new SvgDocument(); const text = new TextShape('t', 0, 0, '  A  B  ');
  text.setPreservedAttributes(attributes); doc.insert(text); doc.setPreservedAttributes({ 'xml:space': 'default', 'data-root': 'x\r\ny' });
  const encoded = codec.encode(doc); assert.match(encoded, /&amp;/); assert.match(encoded, /&quot;/); assert.match(encoded, /&#13;/);
  const restored = codec.decode(encoded).document;
  assert.deepEqual(restored.getPreservedAttributes(), doc.getPreservedAttributes());
  assert.deepEqual(restored.findById('t')!.getPreservedAttributes(), attributes);
  assert.equal(restored.findById('t')!.getAttribute('text'), '  A  B  ');
});
