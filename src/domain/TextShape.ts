import { Shape, type AttributeValue } from './Shape.js';

export class TextShape extends Shape {
  #geometry: { x: number; y: number; text: string };

  constructor(id: string, x: number, y: number, text: string) {
    super(id);
    if (typeof text !== 'string') throw new Error('text must be a string');
    this.#geometry = {
      x: this.requireNumber(x, 'x'),
      y: this.requireNumber(y, 'y'),
      text,
    };
  }

  get type(): string {
    return 'text';
  }

  move(dx: number, dy: number): void {
    this.requireNumber(dx, 'dx');
    this.requireNumber(dy, 'dy');
    const next = {
      x: this.requireNumber(this.#geometry.x + dx, 'x'),
      y: this.requireNumber(this.#geometry.y + dy, 'y'),
      text: this.#geometry.text,
    };
    this.#geometry = next;
  }

  scale(factor: number): void {
    this.requireScaleFactor(factor);
    const next = {
      x: this.requireNumber(this.#geometry.x * factor, 'x'),
      y: this.requireNumber(this.#geometry.y * factor, 'y'),
      text: this.#geometry.text,
    };
    this.#geometry = next;
  }

  clone(): TextShape {
    const copy = new TextShape(this.id, this.#geometry.x, this.#geometry.y, this.#geometry.text);
    this.copyCommonStateTo(copy);
    return copy;
  }

  protected getOwnAttributes(): Readonly<Record<string, AttributeValue>> {
    return { ...this.#geometry };
  }

  protected setOwnAttribute(attribute: string, value: AttributeValue): void {
    if (attribute === 'text') {
      if (typeof value !== 'string') throw new Error('text must be a string');
      this.#geometry = { ...this.#geometry, text: value };
      return;
    }
    if (!Object.hasOwn(this.#geometry, attribute)) {
      throw new Error(`unknown attribute: ${attribute}`);
    }
    const next = this.requireNumber(value, attribute);
    this.#geometry = { ...this.#geometry, [attribute]: next };
  }
}
