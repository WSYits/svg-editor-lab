export type AttributeValue = string | number;

/** Common behavior without assuming any particular geometric fields. */
export abstract class Shape {
  readonly #id: string;
  #styles: Record<string, AttributeValue> = {};

  protected constructor(id: string) {
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new Error('id must not be empty');
    }
    this.#id = id;
  }

  get id(): string {
    return this.#id;
  }

  abstract get type(): string;
  abstract move(dx: number, dy: number): void;
  abstract scale(factor: number): void;
  abstract clone(): Shape;

  getAttributes(): Readonly<Record<string, AttributeValue>> {
    return Object.freeze({ id: this.id, ...this.getOwnAttributes(), ...this.#styles });
  }

  getAttribute(attribute: string): AttributeValue | undefined {
    const attributes = this.getAttributes();
    if (Object.hasOwn(attributes, attribute)) return attributes[attribute];
    if (['fill', 'stroke', 'stroke-width'].includes(attribute)) return undefined;
    throw new Error(`unknown attribute: ${attribute}`);
  }

  setAttribute(attribute: string, value: AttributeValue): void {
    if (attribute === 'fill' || attribute === 'stroke') {
      if (typeof value !== 'string') throw new Error(`${attribute} must be a string`);
      this.#styles = { ...this.#styles, [attribute]: value };
      return;
    }
    if (attribute === 'stroke-width') {
      const width = this.requireNumber(value, attribute, true);
      this.#styles = { ...this.#styles, [attribute]: width };
      return;
    }
    this.setOwnAttribute(attribute, value);
  }

  protected abstract getOwnAttributes(): Readonly<Record<string, AttributeValue>>;
  protected abstract setOwnAttribute(attribute: string, value: AttributeValue): void;

  protected requireNumber(value: AttributeValue, attribute: string, nonnegative = false): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`${attribute} must be a finite number`);
    }
    if (nonnegative && value < 0) throw new Error(`${attribute} must be nonnegative`);
    return value;
  }

  protected requireScaleFactor(factor: number): void {
    this.requireNumber(factor, 'scale factor');
    if (factor <= 0) throw new Error('scale factor must be positive');
  }

  protected copyStylesTo(target: Shape): void {
    target.#styles = { ...this.#styles };
  }
}
