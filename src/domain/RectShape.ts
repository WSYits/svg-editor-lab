import { Shape, type AttributeValue } from './Shape.js';

export class RectShape extends Shape {
  #geometry: { x: number; y: number; width: number; height: number };

  constructor(id: string, x: number, y: number, width: number, height: number, fill?: string) {
    super(id);
    this.#geometry = {
      x: this.requireNumber(x, 'x'),
      y: this.requireNumber(y, 'y'),
      width: this.requireNumber(width, 'width', true),
      height: this.requireNumber(height, 'height', true),
    };
    if (fill !== undefined) this.setAttribute('fill', fill);
  }

  get type(): string {
    return 'rect';
  }

  move(dx: number, dy: number): void {
    this.requireNumber(dx, 'dx');
    this.requireNumber(dy, 'dy');
    const next = {
      x: this.requireNumber(this.#geometry.x + dx, 'x'),
      y: this.requireNumber(this.#geometry.y + dy, 'y'),
      width: this.#geometry.width,
      height: this.#geometry.height,
    };
    this.#geometry = next;
  }

  scale(factor: number): void {
    this.requireScaleFactor(factor);
    const next = {
      x: this.requireNumber(this.#geometry.x * factor, 'x'),
      y: this.requireNumber(this.#geometry.y * factor, 'y'),
      width: this.requireNumber(this.#geometry.width * factor, 'width', true),
      height: this.requireNumber(this.#geometry.height * factor, 'height', true),
    };
    this.#geometry = next;
  }

  clone(): RectShape {
    const copy = new RectShape(this.id, this.#geometry.x, this.#geometry.y, this.#geometry.width, this.#geometry.height);
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
    const next = this.requireNumber(value, attribute, ['width', 'height'].includes(attribute));
    this.#geometry = { ...this.#geometry, [attribute]: next };
  }
}
