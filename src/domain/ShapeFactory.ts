import { Shape, type AttributeValue } from './Shape.js';
import { RectShape } from './RectShape.js';
import { CircleShape } from './CircleShape.js';
import { EllipseShape } from './EllipseShape.js';
import { LineShape } from './LineShape.js';
import { TextShape } from './TextShape.js';
import { GroupShape } from './GroupShape.js';

export type AttributeKind = 'number' | 'string';
export interface CreationParameter {
  readonly name: string;
  readonly kind: AttributeKind;
  readonly optional: boolean;
}
export interface CreationDescription {
  readonly parameters: readonly CreationParameter[];
}
export interface SvgShapeDescription {
  readonly numericAttributes: readonly string[];
  readonly content: 'container' | 'text' | 'empty';
}
interface ShapeDefinition {
  readonly svg: SvgShapeDescription;
  readonly description: CreationDescription;
  readonly construct: (id: string, attributes: Readonly<Record<string, AttributeValue>>) => Shape;
}

export class ShapeFactory {
  // The only shape-type dispatch/catalogue; still a documented refactoring point.
  static readonly #definitions = new Map<string, ShapeDefinition>([
    ['rect', this.#definition(['x', 'y', 'width', 'height'], 'fill',
      (id, a) => new RectShape(id, this.#number(a, 'x'), this.#number(a, 'y'), this.#number(a, 'width'), this.#number(a, 'height')))],
    ['circle', this.#definition(['cx', 'cy', 'r'], 'fill',
      (id, a) => new CircleShape(id, this.#number(a, 'cx'), this.#number(a, 'cy'), this.#number(a, 'r')))],
    ['ellipse', this.#definition(['cx', 'cy', 'rx', 'ry'], 'fill',
      (id, a) => new EllipseShape(id, this.#number(a, 'cx'), this.#number(a, 'cy'), this.#number(a, 'rx'), this.#number(a, 'ry')))],
    ['line', this.#definition(['x1', 'y1', 'x2', 'y2'], 'stroke',
      (id, a) => new LineShape(id, this.#number(a, 'x1'), this.#number(a, 'y1'), this.#number(a, 'x2'), this.#number(a, 'y2')))],
    ['text', this.#definition(['x', 'y', 'text'], undefined,
      (id, a) => {
        if (typeof a.text !== 'string') throw new Error('text must be a string');
        return new TextShape(id, this.#number(a, 'x'), this.#number(a, 'y'), a.text);
      })],
    ['g', this.#definition([], undefined, id => new GroupShape(id), true)],
  ]);

  getTypes(): readonly string[] { return Object.freeze([...ShapeFactory.#definitions.keys()]); }

  describe(type: string): CreationDescription { return this.#definitionFor(type).description; }

  describeSvg(type: string): SvgShapeDescription { return this.#definitionFor(type).svg; }

  attributeKind(type: string, attribute: string): AttributeKind {
    const parameters = this.describe(type).parameters;
    const own = parameters.find(parameter => parameter.name === attribute);
    if (own) return own.kind;
    if (attribute === 'fill' || attribute === 'stroke') return 'string';
    if (attribute === 'stroke-width') return 'number';
    throw new Error(`unknown attribute: ${attribute}`);
  }

  create(type: string, id: string, attributes: Readonly<Record<string, AttributeValue>> = {}): Shape {
    const shape = this.#definitionFor(type).construct(id, attributes);
    for (const [attribute, value] of Object.entries(attributes)) shape.setAttribute(attribute, value);
    return shape;
  }

  #definitionFor(type: string): ShapeDefinition {
    const definition = ShapeFactory.#definitions.get(type);
    if (!definition) throw new Error(`unknown shape type: ${type} (is the plugin loaded?)`);
    return definition;
  }

  static #definition(names: readonly string[], optionalStyle: string | undefined,
    construct: ShapeDefinition['construct'], container = false): ShapeDefinition {
    const parameters: CreationParameter[] = names.map(name => Object.freeze({ name, kind: name === 'text' ? 'string' : 'number', optional: false }));
    if (optionalStyle) parameters.push(Object.freeze({ name: optionalStyle, kind: 'string', optional: true }));
    return Object.freeze({ description: Object.freeze({ parameters: Object.freeze(parameters) }), construct,
      svg: Object.freeze({ numericAttributes: Object.freeze(names.filter(name => name !== 'text')),
        content: container ? 'container' : names.includes('text') ? 'text' : 'empty' }) });
  }

  static #number(attributes: Readonly<Record<string, AttributeValue>>, key: string): number {
    const value = attributes[key];
    if (typeof value !== 'number') throw new Error(`${key} must be a finite number`);
    return value;
  }
}
