/** Validated immutable SVG presentation metadata, separate from editable state. */
export class PreservedAttributes {
  readonly #values: Readonly<Record<string, string>>;

  constructor(input: Readonly<Record<string, string>> = {}, root = false) {
    const values: Record<string, string> = {};
    for (const [name, value] of Object.entries(input)) {
      if (typeof value !== 'string') throw new Error(`preserved attribute must be a string: ${name}`);
      PreservedAttributes.assertXmlText(value);
      if (name === 'font-size') {
        PreservedAttributes.length(value, name, true);
      } else if (name === 'font-family') {
        if (!value.trim() || /[\\();{}@:<>]/u.test(value)) throw new Error('unsupported font-family');
      } else if (name === 'font-weight') {
        if (!/^(?:normal|bold|bolder|lighter|[1-9]00)$/u.test(value)) throw new Error('unsupported font-weight');
      } else if (name === 'text-anchor') {
        if (!['start', 'middle', 'end'].includes(value)) throw new Error('unsupported text-anchor');
      } else if (['opacity', 'fill-opacity', 'stroke-opacity'].includes(name)) {
        const number = PreservedAttributes.number(value, name);
        if (number < 0 || number > 1) throw new Error(`${name} must be between 0 and 1`);
      } else if (name === 'xml:space') {
        if (value !== 'preserve' && value !== 'default') throw new Error('unsupported xml:space');
      } else if (/^data-[a-z][a-z0-9-]*$/u.test(name)) {
        // Opaque inert data, never interpreted as plugin registration or a URL.
      } else if (root && (name === 'fill' || name === 'stroke')) {
        PreservedAttributes.assertPaint(value);
      } else if (root && name === 'stroke-width') {
        PreservedAttributes.length(value, name, true);
      } else {
        throw new Error(`unsupported preserved attribute: ${name}`);
      }
      values[name] = value;
    }
    this.#values = Object.freeze(values);
  }

  get values(): Readonly<Record<string, string>> { return this.#values; }

  static number(raw: string, name: string): number {
    const value = Number(raw);
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(raw) || !Number.isFinite(value)) {
      throw new Error(`${name} must be a finite decimal number`);
    }
    return value;
  }

  static length(raw: string, name: string, nonnegative = false): number {
    const value = this.number(raw.endsWith('px') ? raw.slice(0, -2) : raw, name);
    if (nonnegative && value < 0) throw new Error(`${name} must be nonnegative`);
    return value;
  }

  static assertPaint(value: string): void {
    // No URL, CSS escape, variable, context-paint or resource references.
    if (/^(?:currentColor|context-fill|context-stroke)$/iu.test(value) ||
      !/^(?:[a-zA-Z]+|#[\da-fA-F]{3}|#[\da-fA-F]{4}|#[\da-fA-F]{6}|#[\da-fA-F]{8})$/u.test(value)) {
      throw new Error(`unsupported paint or resource reference: ${value}`);
    }
  }

  static assertXmlText(value: string): void {
    for (const char of value) {
      const point = char.codePointAt(0)!;
      if (!(point === 9 || point === 10 || point === 13 || (point >= 0x20 && point <= 0xd7ff) ||
        (point >= 0xe000 && point <= 0xfffd) || (point >= 0x10000 && point <= 0x10ffff))) {
        throw new Error('invalid XML 1.0 character');
      }
    }
  }
}
