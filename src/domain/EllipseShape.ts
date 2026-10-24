import { Shape, type AttributeValue } from './Shape.js';

export class EllipseShape extends Shape {
  #geometry: { cx: number; cy: number; rx: number; ry: number };

  constructor(id: string, cx: number, cy: number, rx: number, ry: number, fill?: string) {
    super(id);
    this.#geometry = {
      cx: this.requireNumber(cx, 'cx'),
      cy: this.requireNumber(cy, 'cy'),
      rx: this.requireNumber(rx, 'rx', true),
      ry: this.requireNumber(ry, 'ry', true),
    };
    if (fill !== undefined) this.setAttribute('fill', fill);
  }

  get type(): string {
    return 'ellipse';
  }

  move(dx: number, dy: number): void {
    this.requireNumber(dx, 'dx');
    this.requireNumber(dy, 'dy');
    const next = {
      cx: this.requireNumber(this.#geometry.cx + dx, 'cx'),
      cy: this.requireNumber(this.#geometry.cy + dy, 'cy'),
      rx: this.#geometry.rx,
      ry: this.#geometry.ry,
    };
    this.#geometry = next;
  }

  scale(factor: number): void {
    this.requireScaleFactor(factor);
    const next = {
      cx: this.requireNumber(this.#geometry.cx * factor, 'cx'),
      cy: this.requireNumber(this.#geometry.cy * factor, 'cy'),
      rx: this.requireNumber(this.#geometry.rx * factor, 'rx', true),
      ry: this.requireNumber(this.#geometry.ry * factor, 'ry', true),
    };
    this.#geometry = next;
  }

  clone(): EllipseShape {
    const copy = new EllipseShape(this.id, this.#geometry.cx, this.#geometry.cy, this.#geometry.rx, this.#geometry.ry);
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
    const next = this.requireNumber(value, attribute, ['rx', 'ry'].includes(attribute));
    this.#geometry = { ...this.#geometry, [attribute]: next };
  }
}
