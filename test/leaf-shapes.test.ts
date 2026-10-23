import assert from 'node:assert/strict';
import test from 'node:test';
import { Shape, type AttributeValue } from '../src/domain/Shape.js';
import { RectShape } from '../src/domain/RectShape.js';
import { CircleShape } from '../src/domain/CircleShape.js';
import { EllipseShape } from '../src/domain/EllipseShape.js';
import { LineShape } from '../src/domain/LineShape.js';
import { TextShape } from '../src/domain/TextShape.js';

const max = Number.MAX_VALUE;
const cases: {
  name: string;
  create: () => Shape;
  moved: Record<string, AttributeValue>;
  scaled: Record<string, AttributeValue>;
  dimensions: string[];
  overflowMove: () => Shape;
  overflowScale: () => Shape;
}[] = [
  {
    name: 'rect', create: () => new RectShape('r', 2, 3, 4, 5),
    moved: { id: 'r', x: -0.5, y: 3.5, width: 4, height: 5 },
    scaled: { id: 'r', x: 1, y: 1.5, width: 2, height: 2.5 },
    dimensions: ['width', 'height'],
    overflowMove: () => new RectShape('r', 2, max, 4, 5),
    overflowScale: () => new RectShape('r', 2, 3, 4, max),
  },
  {
    name: 'circle', create: () => new CircleShape('c', 2, 3, 4),
    moved: { id: 'c', cx: -0.5, cy: 3.5, r: 4 },
    scaled: { id: 'c', cx: 1, cy: 1.5, r: 2 },
    dimensions: ['r'],
    overflowMove: () => new CircleShape('c', 2, max, 4),
    overflowScale: () => new CircleShape('c', 2, 3, max),
  },
  {
    name: 'ellipse', create: () => new EllipseShape('e', 2, 3, 4, 5),
    moved: { id: 'e', cx: -0.5, cy: 3.5, rx: 4, ry: 5 },
    scaled: { id: 'e', cx: 1, cy: 1.5, rx: 2, ry: 2.5 },
    dimensions: ['rx', 'ry'],
    overflowMove: () => new EllipseShape('e', 2, max, 4, 5),
    overflowScale: () => new EllipseShape('e', 2, 3, 4, max),
  },
  {
    name: 'line', create: () => new LineShape('l', 2, 3, 4, 5),
    moved: { id: 'l', x1: -0.5, y1: 3.5, x2: 1.5, y2: 5.5 },
    scaled: { id: 'l', x1: 1, y1: 1.5, x2: 2, y2: 2.5 },
    dimensions: [],
    overflowMove: () => new LineShape('l', 2, 3, 4, max),
    overflowScale: () => new LineShape('l', 2, 3, 4, max),
  },
  {
    name: 'text', create: () => new TextShape('t', 2, 3, '开始 diagram'),
    moved: { id: 't', x: -0.5, y: 3.5, text: '开始 diagram' },
    scaled: { id: 't', x: 1, y: 1.5, text: '开始 diagram' },
    dimensions: [],
    overflowMove: () => new TextShape('t', 2, max, 'unchanged'),
    overflowScale: () => new TextShape('t', 2, max, 'unchanged'),
  },
];

for (const example of cases) {
  const { name, create } = example;
  test(`${name}: polymorphic move translates only positions using fractional deltas`, () => {
    const shape: Shape = create();
    shape.move(-2.5, 0.5);
    assert.deepEqual(shape.getAttributes(), example.moved);
  });

  test(`${name}: polymorphic scale multiplies positions and sizes around the origin`, () => {
    const shape: Shape = create();
    shape.scale(0.5);
    assert.deepEqual(shape.getAttributes(), example.scaled);
    shape.scale(2);
    assert.deepEqual(shape.getAttributes(), create().getAttributes());
  });

  test(`${name}: negative coordinates are scaled without changing their signs`, () => {
    const shape = create();
    shape.move(-10, -10);
    const before = shape.getAttributes();
    shape.scale(2);
    for (const [attribute, value] of Object.entries(before)) {
      assert.equal(shape.getAttribute(attribute), typeof value === 'number' ? value * 2 : value);
    }
  });

  test(`${name}: invalid deltas and factors never change state`, () => {
    const shape = create();
    shape.setAttribute('stroke', 'red');
    const before = shape.getAttributes();
    for (const value of [NaN, Infinity, -Infinity]) {
      assert.throws(() => shape.move(value, 1));
      assert.deepEqual(shape.getAttributes(), before);
      assert.throws(() => shape.move(1, value));
      assert.deepEqual(shape.getAttributes(), before);
    }
    for (const factor of [0, -0, -1, NaN, Infinity, -Infinity]) {
      assert.throws(() => shape.scale(factor));
      assert.deepEqual(shape.getAttributes(), before);
    }
    assert.throws(() => shape.scale(0), /scale factor must be positive/);
  });

  test(`${name}: late-coordinate move overflow leaves earlier coordinates unchanged`, () => {
    const shape = example.overflowMove();
    const before = shape.getAttributes();
    assert.throws(() => shape.move(1, max), /finite number/);
    assert.deepEqual(shape.getAttributes(), before);
    assert.throws(() => shape.move(1, -Infinity));
    assert.deepEqual(shape.getAttributes(), before);
  });

  test(`${name}: late-field scale overflow leaves all geometry and styles unchanged`, () => {
    const shape = example.overflowScale();
    shape.setAttribute('fill', 'red');
    const before = shape.getAttributes();
    assert.throws(() => shape.scale(2), /finite number/);
    assert.deepEqual(shape.getAttributes(), before);
  });

  test(`${name}: own geometric attributes validate before replacement`, () => {
    const shape = create();
    const fields = Object.entries(shape.getAttributes()).filter(([, value]) => typeof value === 'number');
    for (const [attribute] of fields) {
      for (const invalid of [NaN, Infinity, -Infinity, '3']) {
        const before = shape.getAttributes();
        assert.throws(() => shape.setAttribute(attribute, invalid));
        assert.deepEqual(shape.getAttributes(), before);
      }
      const value = example.dimensions.includes(attribute) ? 0.25 : -0.25;
      const before = shape.getAttributes();
      shape.setAttribute(attribute, value);
      assert.deepEqual(shape.getAttributes(), { ...before, [attribute]: value });
    }
    for (const dimension of example.dimensions) {
      const before = shape.getAttributes();
      assert.throws(() => shape.setAttribute(dimension, -1), /nonnegative/);
      assert.deepEqual(shape.getAttributes(), before);
      shape.setAttribute(dimension, 0);
      assert.equal(shape.getAttribute(dimension), 0);
    }
  });
}

test('constructors reject invalid geometry before exposing an object', () => {
  const constructors = [
    () => new RectShape('r', 0, 0, -1, 2),
    () => new RectShape('r', 0, 0, 1, -2),
    () => new CircleShape('c', 0, 0, -1),
    () => new EllipseShape('e', 0, 0, -1, 1),
    () => new EllipseShape('e', 0, 0, 1, -1),
    () => new LineShape('l', 0, 0, 1, Infinity),
    () => new TextShape('t', 0, NaN, 'text'),
  ];
  for (const construct of constructors) assert.throws(construct);
  assert.equal(new CircleShape('zero', -1.5, 0.25, 0).getAttribute('r'), 0);
});

test('text content accepts empty and Unicode values, validates types and copies independently', () => {
  const text = new TextShape('t', 1, 2, '开始 diagram');
  const copy = text.clone();
  text.setAttribute('text', '');
  assert.equal(copy.getAttribute('text'), '开始 diagram');
  copy.setAttribute('text', '处理数据 v2');
  assert.equal(text.getAttribute('text'), '');
  const before = copy.getAttributes();
  assert.throws(() => copy.setAttribute('text', 42), /text must be a string/);
  assert.deepEqual(copy.getAttributes(), before);
});

test('attributes belonging to another shape are rejected', () => {
  assert.throws(() => new RectShape('r', 0, 0, 1, 1).setAttribute('r', 1), /unknown attribute: r/);
  assert.throws(() => new CircleShape('c', 0, 0, 1).setAttribute('width', 1), /unknown attribute: width/);
  assert.throws(() => new LineShape('l', 0, 0, 1, 1).setAttribute('text', 'x'), /unknown attribute: text/);
});
