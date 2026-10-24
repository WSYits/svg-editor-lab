import assert from 'node:assert/strict';
import test from 'node:test';
import { ShapeFactory } from '../src/domain/ShapeFactory.js';

for (const [type, names, optional] of [
  ['rect', ['x', 'y', 'width', 'height', 'fill'], 'fill'], ['circle', ['cx', 'cy', 'r', 'fill'], 'fill'],
  ['ellipse', ['cx', 'cy', 'rx', 'ry', 'fill'], 'fill'], ['line', ['x1', 'y1', 'x2', 'y2', 'stroke'], 'stroke'],
  ['text', ['x', 'y', 'text'], undefined], ['g', [], undefined],
] as const) {
  test(`${type}: creation metadata is immutable and agrees with factory attribute types`, () => {
    const factory = new ShapeFactory(); const description = factory.describe(type);
    assert.deepEqual(description.parameters.map(parameter => parameter.name), names);
    assert(Object.isFrozen(description)); assert(Object.isFrozen(description.parameters));
    for (const parameter of description.parameters) {
      assert(Object.isFrozen(parameter)); assert.equal(parameter.optional, parameter.name === optional);
      assert.equal(factory.attributeKind(type, parameter.name), parameter.kind);
      assert.throws(() => Object.assign(parameter, { name: 'external' }), TypeError);
    }
    for (const [attr, kind] of [['fill', 'string'], ['stroke', 'string'], ['stroke-width', 'number']] as const) assert.equal(factory.attributeKind(type, attr), kind);
    assert.throws(() => factory.attributeKind(type, 'id'), /unknown attribute/);
  });
}
test('factory alone lists supported names, rejects unknown types and exposes no constructors in descriptions', () => {
  const factory = new ShapeFactory(); const types = factory.getTypes();
  assert.deepEqual(types, ['rect', 'circle', 'ellipse', 'line', 'text', 'g']); assert(Object.isFrozen(types));
  assert.throws(() => factory.describe('box'), /unknown shape type: box/);
  assert.throws(() => factory.describe('constructor'), /unknown shape type/);
  assert.deepEqual(Object.keys(factory.describe('rect')), ['parameters']);
  assert.throws(() => factory.attributeKind('circle', 'width'), /unknown attribute/);
  assert.throws(() => factory.attributeKind('g', 'x'), /unknown attribute/);
});
