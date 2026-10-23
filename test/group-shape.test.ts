import assert from 'node:assert/strict';
import test from 'node:test';
import { Shape } from '../src/domain/Shape.js';
import { GroupShape } from '../src/domain/GroupShape.js';
import { RectShape } from '../src/domain/RectShape.js';
import { TextShape } from '../src/domain/TextShape.js';
import { LineShape } from '../src/domain/LineShape.js';

test('nested groups move and scale polymorphically, preserving child identities and order', () => {
  const rect = new RectShape('r', 1, 2, 3, 4);
  const text = new TextShape('t', 5, 6, 'hello');
  const inner = new GroupShape('inner', [text]);
  const group: Shape = new GroupShape('outer', [rect, inner]);
  group.move(10, -2);
  group.scale(2);
  assert.deepEqual(rect.getAttributes(), { id: 'r', x: 22, y: 0, width: 6, height: 8 });
  assert.deepEqual(text.getAttributes(), { id: 't', x: 30, y: 8, text: 'hello' });
  assert.deepEqual(group.children, [rect, inner]);
  assert.equal(inner.children[0], text);
});

test('group styles belong only to the group, with no geometry attributes', () => {
  const rect = new RectShape('r', 0, 0, 1, 1, 'red');
  const group = new GroupShape('g', [rect]);
  group.setAttribute('fill', 'blue');
  group.setAttribute('stroke', 'black');
  group.setAttribute('stroke-width', 2);
  group.scale(2);
  assert.equal(rect.getAttribute('fill'), 'red');
  assert.equal(rect.getAttribute('stroke'), undefined);
  assert.deepEqual(group.getAttributes(), { id: 'g', fill: 'blue', stroke: 'black', 'stroke-width': 2 });
  const before = group.getAttributes();
  assert.throws(() => group.setAttribute('x', 1), /unknown attribute/);
  assert.deepEqual(group.getAttributes(), before);
});

for (const operation of ['move', 'scale'] as const) {
  test(`nested late ${operation} overflow restores every original node and style`, () => {
    const first = new RectShape('first', 1, 2, 3, 4, 'red');
    const middle = new TextShape('middle', 1, 2, 'unchanged');
    const last = new LineShape('last', 1, 2, 3, Number.MAX_VALUE);
    const inner = new GroupShape('inner', [middle, last]);
    const outer = new GroupShape('outer', [first, inner]);
    outer.setAttribute('fill', 'blue');
    inner.setAttribute('stroke-width', 0.5);
    const nodes = [outer, first, inner, middle, last];
    const before = nodes.map(node => node.getAttributes());
    assert.throws(() => operation === 'move' ? outer.move(1, Number.MAX_VALUE) : outer.scale(2), /finite number/);
    assert.deepEqual(nodes.map(node => node.getAttributes()), before);
    assert.deepEqual(outer.children, [first, inner]);
    assert.deepEqual(inner.children, [middle, last]);
    outer.move(0, -1);
    assert.equal(first.getAttribute('y'), 1);
  });
}

test('empty groups validate operations and preserve optional styles when cloned', () => {
  const group = new GroupShape('g');
  group.move(1, 2);
  group.scale(2);
  for (const factor of [0, -1, NaN, Infinity]) assert.throws(() => group.scale(factor));
  assert.throws(() => group.move(0, Infinity));
  assert.deepEqual(group.clone().getAttributes(), { id: 'g' });
  assert.deepEqual(group.children, []);
});

test('deep clone after edits preserves every level while isolating descendants and styles', () => {
  const text = new TextShape('t', 1, 2, 'before');
  const inner = new GroupShape('inner', [text]);
  const original = new GroupShape('outer', [inner]);
  text.setAttribute('text', 'after');
  text.setAttribute('fill', 'red');
  inner.setAttribute('stroke', 'black');
  original.setAttribute('fill', 'blue');
  original.move(10, 20);
  const copy = original.clone();
  const copyInner = copy.children[0]!;
  const copyText = copyInner.children[0]!;
  assert.ok(copy instanceof GroupShape);
  assert.ok(copyInner instanceof GroupShape);
  assert.ok(copyText instanceof TextShape);
  assert.notEqual(copyInner, inner);
  assert.notEqual(copyText, text);
  assert.deepEqual(copy.getAttributes(), original.getAttributes());
  assert.deepEqual(copyInner.getAttributes(), inner.getAttributes());
  assert.deepEqual(copyText.getAttributes(), text.getAttributes());
  const before = text.getAttributes();
  copy.move(1, 2);
  copyText.setAttribute('text', 'copy');
  copyInner.setAttribute('stroke', 'orange');
  assert.deepEqual(text.getAttributes(), before);
  assert.equal(inner.getAttribute('stroke'), 'black');
  const copied = copyText.getAttributes();
  original.scale(2);
  assert.deepEqual(copyText.getAttributes(), copied);
});

test('constructor copies and freezes child collections; leaves expose no children', () => {
  const rect = new RectShape('r', 0, 0, 1, 1);
  const input: Shape[] = [rect];
  const group = new GroupShape('g', input);
  input.length = 0;
  assert.deepEqual(group.children, [rect]);
  assert.throws(() => Object.assign(group.children, { 0: group }), TypeError);
  assert.deepEqual(rect.children, []);
  assert.throws(() => group.appendChild(group, Symbol()), /document access/);
  assert.throws(() => group.removeChild(rect, Symbol()), /document access/);
  assert.deepEqual(group.children, [rect]);
});

test('invalid group construction does not claim earlier detached children', () => {
  const first = new RectShape('first', 0, 0, 1, 1);
  const owned = new TextShape('owned', 0, 0, 'x');
  const owner = new GroupShape('owner', [owned]);
  assert.throws(() => new GroupShape('bad', [first, owned]), /already belongs/);
  assert.deepEqual(new GroupShape('valid', [first]).children, [first]);
  assert.deepEqual(owner.children, [owned]);
});

test('group rejects duplicate object, duplicate subtree ids and own-id collisions', () => {
  const rect = new RectShape('r', 0, 0, 1, 1);
  assert.throws(() => new GroupShape('g', [rect, rect]));
  assert.throws(() => new GroupShape('g', [rect, rect.clone()]), /id already exists/);
  assert.throws(() => new GroupShape('r', [rect]), /id already exists/);
  const a = new GroupShape('a', [new TextShape('same', 0, 0, 'a')]);
  const b = new GroupShape('b', [new TextShape('same', 0, 0, 'b')]);
  assert.throws(() => new GroupShape('root', [a, b]), /id already exists/);
  assert.deepEqual(new GroupShape('valid', [rect]).children, [rect]);
});
