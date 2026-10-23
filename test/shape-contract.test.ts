import assert from 'node:assert/strict';
import test from 'node:test';
import { Shape } from '../src/domain/Shape.js';
import { RectShape } from '../src/domain/RectShape.js';
import { CircleShape } from '../src/domain/CircleShape.js';
import { EllipseShape } from '../src/domain/EllipseShape.js';
import { LineShape } from '../src/domain/LineShape.js';
import { TextShape } from '../src/domain/TextShape.js';

const cases: { name: string; create: () => Shape }[] = [
  { name: 'rect', create: () => new RectShape('R1', 2, 3, 4, 5) },
  { name: 'circle', create: () => new CircleShape('C1', 2, 3, 4) },
  { name: 'ellipse', create: () => new EllipseShape('E1', 2, 3, 4, 5) },
  { name: 'line', create: () => new LineShape('L1', 2, 3, 4, 5) },
  { name: 'text', create: () => new TextShape('T1', 2, 3, '开始 diagram') },
];

for (const { name, create } of cases) {
  test(`${name}: clone captures edited geometry and preserves absent styles`, () => {
    const shape: Shape = create();
    shape.move(-3.5, 7);
    shape.scale(0.25);
    const numeric = Object.entries(shape.getAttributes()).find(([, value]) => typeof value === 'number');
    assert.ok(numeric);
    shape.setAttribute(numeric[0], 9.5);
    const before = shape.getAttributes();
    const copy: Shape = shape.clone();
    assert.deepEqual(copy.getAttributes(), before);
    assert.equal(Object.getPrototypeOf(copy), Object.getPrototypeOf(shape));
    for (const attr of ['fill', 'stroke', 'stroke-width']) {
      assert.equal(copy.getAttribute(attr), undefined);
      assert.equal(Object.hasOwn(copy.getAttributes(), attr), false);
    }
    copy.move(1, 2);
    assert.deepEqual(shape.getAttributes(), before);
  });

  test(`${name}: styles remain unset until explicitly assigned`, () => {
    const shape = create();
    for (const attr of ['fill', 'stroke', 'stroke-width']) {
      assert.equal(shape.getAttribute(attr), undefined);
      assert.equal(Object.hasOwn(shape.getAttributes(), attr), false);
    }
    shape.setAttribute('fill', 'red');
    shape.setAttribute('stroke', '#123456');
    shape.setAttribute('stroke-width', 0.5);
    assert.equal(shape.getAttribute('fill'), 'red');
    assert.equal(shape.getAttribute('stroke'), '#123456');
    assert.equal(shape.getAttribute('stroke-width'), 0.5);
    shape.scale(2);
    assert.equal(shape.getAttribute('stroke-width'), 0.5);
  });

  test(`${name}: failed attribute changes preserve the complete state`, () => {
    const shape = create();
    shape.setAttribute('fill', 'blue');
    shape.setAttribute('stroke-width', 2);
    const before = shape.getAttributes();
    const invalid: [string, string | number][] = [
      ['fill', 3], ['stroke', 3], ['stroke-width', -1],
      ['stroke-width', NaN], ['stroke-width', Infinity], ['stroke-width', '2'],
      ['id', 'changed'], ['label', 'new'], ['transform', 'scale(2)'],
      ['__proto__', 'bad'], ['constructor', 'bad'],
    ];
    for (const [attribute, value] of invalid) {
      assert.throws(() => shape.setAttribute(attribute, value));
      assert.deepEqual(shape.getAttributes(), before);
    }
    assert.throws(() => shape.getAttribute('unknown'), /unknown attribute: unknown/);
    assert.throws(() => shape.setAttribute('label', 'x'), /unknown attribute: label/);
  });

  test(`${name}: id and attribute snapshots cannot mutate internal state`, () => {
    const shape = create();
    const id = shape.id;
    const snapshot = shape.getAttributes();
    assert.equal(snapshot.id, id);
    assert.throws(() => Object.assign(shape, { id: 'changed' }), TypeError);
    assert.throws(() => Object.assign(snapshot, { fill: 'bad' }), TypeError);
    shape.setAttribute('fill', 'green');
    assert.equal(snapshot.fill, undefined);
    assert.equal(shape.id, id);
    assert.equal(shape.type, name);
  });

  test(`${name}: clone preserves concrete type and is independent in both directions`, () => {
    const original = create();
    original.setAttribute('fill', 'red');
    original.setAttribute('stroke', 'black');
    original.setAttribute('stroke-width', 1.5);
    const before = original.getAttributes();
    const copy: Shape = original.clone();
    assert.notEqual(copy, original);
    assert.equal(Object.getPrototypeOf(copy), Object.getPrototypeOf(original));
    assert.equal(copy.type, original.type);
    assert.equal(copy.id, original.id);
    assert.deepEqual(copy.getAttributes(), before);
    copy.move(10, 20);
    copy.setAttribute('fill', 'blue');
    assert.deepEqual(original.getAttributes(), before);
    const copyBefore = copy.getAttributes();
    original.scale(0.5);
    original.setAttribute('stroke', 'orange');
    assert.deepEqual(copy.getAttributes(), copyBefore);
  });
}

test('empty ids are rejected without normalizing case-sensitive ids', () => {
  for (const id of ['', ' ', '\t']) {
    assert.throws(() => new RectShape(id, 0, 0, 0, 0), /id must not be empty/);
  }
  assert.equal(new CircleShape('c1', 0, 0, 0).id, 'c1');
  assert.equal(new CircleShape('C1', 0, 0, 0).id, 'C1');
});

test('optional constructor styles are retained without adding defaults', () => {
  assert.equal(new RectShape('r', 0, 0, 1, 1, '#eee').getAttribute('fill'), '#eee');
  assert.equal(new CircleShape('c', 0, 0, 1, 'red').getAttribute('fill'), 'red');
  assert.equal(new EllipseShape('e', 0, 0, 1, 2, 'blue').getAttribute('fill'), 'blue');
  const line = new LineShape('l', 0, 0, 1, 1, 'black');
  assert.equal(line.getAttribute('stroke'), 'black');
  assert.equal(line.getAttribute('fill'), undefined);
});

test('clone captures edited text content rather than constructor content', () => {
  const shape: Shape = new TextShape('t', 1, 2, 'initial');
  shape.setAttribute('text', '修改后的内容');
  const copy = shape.clone();
  assert.deepEqual(copy.getAttributes(), shape.getAttributes());
  copy.setAttribute('text', '');
  assert.equal(shape.getAttribute('text'), '修改后的内容');
});
