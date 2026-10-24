import { Shape, type AttributeValue } from './Shape.js';

export class CircleShape extends Shape {
  #geometry: { cx: number; cy: number; r: number };

  constructor(id: string, cx: number, cy: number, r: number, fill?: string) {
    super(id);
    this.#geometry = {
      cx: this.requireNumber(cx, 'cx'),
      cy: this.requireNumber(cy, 'cy'),
      r: this.requireNumber(r, 'r', true),
    };
    if (fill !== undefined) this.setAttribute('fill', fill);
  }

  get type(): string {
    return 'circle';
  }

  move(dx: number, dy: number): void {
    this.requireNumber(dx, 'dx');
    this.requireNumber(dy, 'dy');
    const next = {
      cx: this.requireNumber(this.#geometry.cx + dx, 'cx'),
      cy: this.requireNumber(this.#geometry.cy + dy, 'cy'),
      r: this.#geometry.r,
    };
    this.#geometry = next;
  }

  scale(factor: number): void {
    this.requireScaleFactor(factor);
    const next = {
      cx: this.requireNumber(this.#geometry.cx * factor, 'cx'),
      cy: this.requireNumber(this.#geometry.cy * factor, 'cy'),
      r: this.requireNumber(this.#geometry.r * factor, 'r', true),
    };
    this.#geometry = next;
  }

  clone(): CircleShape {
    const copy = new CircleShape(this.id, this.#geometry.cx, this.#geometry.cy, this.#geometry.r);
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
    const next = this.requireNumber(value, attribute, attribute === 'r');
    this.#geometry = { ...this.#geometry, [attribute]: next };
  }
}
