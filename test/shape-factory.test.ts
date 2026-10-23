import assert from 'node:assert/strict';
import test from 'node:test';
import { ShapeFactory } from '../src/domain/ShapeFactory.js';
import { RectShape } from '../src/domain/RectShape.js';
import { CircleShape } from '../src/domain/CircleShape.js';
import { EllipseShape } from '../src/domain/EllipseShape.js';
import { LineShape } from '../src/domain/LineShape.js';
import { TextShape } from '../src/domain/TextShape.js';
import { GroupShape } from '../src/domain/GroupShape.js';

const cases = [
  { type: 'rect', attributes: { x: 1, y: 2, width: 3, height: 4 }, expected: RectShape },
  { type: 'circle', attributes: { cx: 1, cy: 2, r: 3 }, expected: CircleShape },
  { type: 'ellipse', attributes: { cx: 1, cy: 2, rx: 3, ry: 4 }, expected: EllipseShape },
  { type: 'line', attributes: { x1: 1, y1: 2, x2: 3, y2: 4 }, expected: LineShape },
  { type: 'text', attributes: { x: 1, y: 2, text: '开始' }, expected: TextShape },
  { type: 'g', attributes: {}, expected: GroupShape },
];

for (const { type, attributes, expected } of cases) {
  test(`factory creates ${type} and leaves caller attributes untouched`, () => {
    const factory = new ShapeFactory();
    const input = Object.freeze({ ...attributes, fill: 'red', 'stroke-width': 0.5 });
    const shape = factory.create(type, 'id', input);
    assert.ok(shape instanceof expected);
    assert.equal(shape.type, type);
    assert.deepEqual(shape.getAttributes(), { id: 'id', ...input });
    shape.setAttribute('fill', 'blue');
    assert.equal(input.fill, 'red');
    assert.notEqual(factory.create(type, 'id', input), shape);
  });
}

test('factory rejects unknown names, including box and case variations', () => {
  const factory = new ShapeFactory();
  for (const type of ['box', 'hexagon', 'Rect', '__proto__', '']) {
    assert.throws(() => factory.create(type, 'x'), /unknown shape type:/);
  }
});

test('factory validates required fields, numeric values and attribute whitelist', () => {
  const factory = new ShapeFactory();
  assert.throws(() => factory.create('rect', 'r'));
  assert.throws(() => factory.create('circle', 'c', { cx: 0, cy: 0, r: -1 }));
  assert.throws(() => factory.create('line', 'l', { x1: 0, y1: 0, x2: 1, y2: Infinity }));
  assert.throws(() => factory.create('text', 't', { x: 0, y: 0, text: 1 }));
  assert.throws(() => factory.create('text', 't', { x: '0', y: 0, text: 'x' }));
  assert.throws(() => factory.create('g', 'g', { x: 1 }), /unknown attribute: x/);
  assert.throws(() => factory.create('g', 'g', { id: 'changed' }), /unknown attribute: id/);
  assert.throws(() => factory.create('g', 'g', { 'stroke-width': -1 }));
  assert.deepEqual(factory.create('g', 'g').getAttributes(), { id: 'g' });
});
