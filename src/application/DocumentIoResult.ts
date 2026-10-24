/** Prepared success data only. No output, mutable document or deferred callback. */
export class DocumentIoResult {
  readonly #summary: string;
  readonly #warnings: readonly string[];

  constructor(summary: string, warnings: readonly string[] = []) {
    if (typeof summary !== 'string' || warnings.some(value => typeof value !== 'string')) {
      throw new Error('document IO result requires strings');
    }
    this.#summary = summary;
    this.#warnings = Object.freeze([...warnings]);
    Object.freeze(this);
  }

  get summary(): string { return this.#summary; }
  get warnings(): readonly string[] { return this.#warnings; }
}
