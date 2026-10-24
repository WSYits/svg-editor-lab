import { Shape, type AttributeValue } from './Shape.js';

export class LineShape extends Shape {
  #geometry: { x1: number; y1: number; x2: number; y2: number };

  constructor(id: string, x1: number, y1: number, x2: number, y2: number, stroke?: string) {
    super(id);
    this.#geometry = {
      x1: this.requireNumber(x1, 'x1'),
      y1: this.requireNumber(y1, 'y1'),
      x2: this.requireNumber(x2, 'x2'),
      y2: this.requireNumber(y2, 'y2'),
    };
    if (stroke !== undefined) this.setAttribute('stroke', stroke);
  }

  get type(): string {
    return 'line';
  }

  move(dx: number, dy: number): void {
    this.requireNumber(dx, 'dx');
    this.requireNumber(dy, 'dy');
    const next = {
      x1: this.requireNumber(this.#geometry.x1 + dx, 'x1'),
      y1: this.requireNumber(this.#geometry.y1 + dy, 'y1'),
      x2: this.requireNumber(this.#geometry.x2 + dx, 'x2'),
      y2: this.requireNumber(this.#geometry.y2 + dy, 'y2'),
    };
    this.#geometry = next;
  }

  scale(factor: number): void {
    this.requireScaleFactor(factor);
    const next = {
      x1: this.requireNumber(this.#geometry.x1 * factor, 'x1'),
      y1: this.requireNumber(this.#geometry.y1 * factor, 'y1'),
      x2: this.requireNumber(this.#geometry.x2 * factor, 'x2'),
      y2: this.requireNumber(this.#geometry.y2 * factor, 'y2'),
    };
    this.#geometry = next;
  }

  clone(): LineShape {
    const copy = new LineShape(this.id, this.#geometry.x1, this.#geometry.y1, this.#geometry.x2, this.#geometry.y2);
    this.copyCommonStateTo(copy);
    return copy;
  }

  protected getOwnAttributes(): Readonly<Record<string, AttributeValue>> {
    return { ...this.#geometry };
  }

  protected setOwnAttribute(attribute: string, value: AttributeValue): void {
    if (!Object.hasOwn(this.#geometry, attribute)) {
      throw new Error(`unknown attribute: ${attribute}`);
    }
    const next = this.requireNumber(value, attribute);
    this.#geometry = { ...this.#geometry, [attribute]: next };
  }
}
