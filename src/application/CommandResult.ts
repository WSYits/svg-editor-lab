/** A stable value for later presentation; never contains domain references. */
export class CommandResult {
  readonly #summary: string;

  constructor(summary: string) {
    if (typeof summary !== 'string') throw new Error('command result summary must be a string');
    this.#summary = summary;
    Object.freeze(this);
  }

  get summary(): string { return this.#summary; }
}
