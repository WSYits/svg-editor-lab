import { Shape, type AttributeValue } from './Shape.js';
import { RectShape } from './RectShape.js';
import { CircleShape } from './CircleShape.js';
import { EllipseShape } from './EllipseShape.js';
import { LineShape } from './LineShape.js';
import { TextShape } from './TextShape.js';
import { GroupShape } from './GroupShape.js';

export class ShapeFactory {
  create(type: string, id: string, attributes: Readonly<Record<string, AttributeValue>> = {}): Shape {
    let shape: Shape;
    // The only shape-type behavior dispatch; a documented future refactoring point.
    switch (type) {
      case 'rect': shape = new RectShape(id, this.number(attributes, 'x'), this.number(attributes, 'y'), this.number(attributes, 'width'), this.number(attributes, 'height')); break;
      case 'circle': shape = new CircleShape(id, this.number(attributes, 'cx'), this.number(attributes, 'cy'), this.number(attributes, 'r')); break;
      case 'ellipse': shape = new EllipseShape(id, this.number(attributes, 'cx'), this.number(attributes, 'cy'), this.number(attributes, 'rx'), this.number(attributes, 'ry')); break;
      case 'line': shape = new LineShape(id, this.number(attributes, 'x1'), this.number(attributes, 'y1'), this.number(attributes, 'x2'), this.number(attributes, 'y2')); break;
      case 'text': {
        const text = attributes.text;
        if (typeof text !== 'string') throw new Error('text must be a string');
        shape = new TextShape(id, this.number(attributes, 'x'), this.number(attributes, 'y'), text);
        break;
      }
      case 'g': shape = new GroupShape(id); break;
      default: throw new Error(`unknown shape type: ${type} (is the plugin loaded?)`);
    }
    for (const [attribute, value] of Object.entries(attributes)) shape.setAttribute(attribute, value);
    return shape;
  }

  private number(attributes: Readonly<Record<string, AttributeValue>>, key: string): number {
    const value = attributes[key];
    if (typeof value !== 'number') throw new Error(`${key} must be a finite number`);
    return value;
  }
}
