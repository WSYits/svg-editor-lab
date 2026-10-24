import { createInterface, type Interface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { setImmediate } from 'node:timers/promises';
import type { Terminal } from './Terminal.js';

export class ConsoleTerminal implements Terminal {
  readonly #input: Readable;
  readonly #output: Writable;
  readonly #error: Writable;
  readonly #interactive: boolean;
  #reader: Interface | undefined;
  #inputFailure: Error | undefined;
  #outputFailure: Error | undefined;
  #closed = false;
  #started = false;
  #inputEnded = false;
  readonly #inputError = (error: Error): void => { this.#inputFailure = error; this.#reader?.close(); };
  readonly #outputError = (error: Error): void => { this.#outputFailure = error; this.#reader?.close(); };
  readonly #inputClose = (): void => {
    if (!this.#closed && !this.#input.readableEnded) this.#inputError(new Error('terminal input closed before EOF'));
  };
  readonly #outputClose = (): void => {
    if (!this.#closed) this.#outputError(new Error('terminal output closed'));
  };

  constructor(input: Readable & { isTTY?: boolean } = process.stdin,
    output: Writable & { isTTY?: boolean } = process.stdout, error: Writable = process.stderr) {
    this.#input = input; this.#output = output; this.#error = error;
    this.#interactive = input.isTTY === true && output.isTTY === true;
    input.on('error', this.#inputError); output.on('error', this.#outputError);
    input.on('close', this.#inputClose); output.on('close', this.#outputClose);
  }

  lines(): AsyncIterable<string> {
    if (this.#started || this.#closed) throw new Error('terminal input is single use');
    this.#started = true;
    if (this.#inputFailure) throw this.#inputFailure;
    if (this.#input.destroyed && !this.#input.readableEnded) throw new Error('terminal input unavailable');
    if (this.#input.readableEnded) return (async function* (): AsyncIterable<string> {})();
    const reader = createInterface({ input: this.#input, output: this.#output,
      terminal: this.#interactive, crlfDelay: Infinity, prompt: 'svg> ' });
    this.#reader = reader;
    // Input errors may also be forwarded by readline after our input listener
    // closes it. Keep an explicit interface listener through the cleanup turn.
    reader.on('error', this.#inputError);
    reader.once('close', () => { this.#inputEnded = true; });
    // Subscribe before the first prompt/await, so a piped burst is queued.
    const iterator = reader[Symbol.asyncIterator]();
    return this.#lines(iterator);
  }

  async *#lines(iterator: AsyncIterator<string>): AsyncIterable<string> {
    while (true) {
      const next = await iterator.next();
      if (this.#inputFailure) throw this.#inputFailure;
      if (this.#outputFailure) throw this.#outputFailure;
      if (next.done) return;
      yield next.value;
    }
  }

  async write(text: string): Promise<void> {
    if (this.#outputFailure) throw this.#outputFailure;
    await this.#write(this.#output, text);
  }

  async writeError(text: string): Promise<void> {
    // Also safe for the one diagnostic after a cleanup failure.
    const ignore = (): void => {};
    this.#error.on('error', ignore);
    try { await this.#write(this.#error, text); }
    finally { await setImmediate(); this.#error.off('error', ignore); }
  }

  async prompt(): Promise<void> {
    if (this.#outputFailure) throw this.#outputFailure;
    if (this.#interactive && this.#reader && !this.#inputEnded && !this.#input.readableEnded) {
      this.#reader.prompt();
      // readline handles cursor redraw itself; its writes use the persistent
      // output-error listener rather than being mistaken for command failures.
      await setImmediate();
      if (this.#outputFailure) throw this.#outputFailure;
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#reader?.close(); this.#input.pause();
    // Writable callbacks can precede their error events. Drain that turn before
    // detaching listeners; do not end process-owned stdout/stderr.
    await setImmediate();
    this.#reader?.off('error', this.#inputError);
    this.#input.off('error', this.#inputError); this.#output.off('error', this.#outputError);
    this.#input.off('close', this.#inputClose); this.#output.off('close', this.#outputClose);
    if (this.#inputFailure) throw this.#inputFailure;
    if (this.#outputFailure) throw this.#outputFailure;
  }

  async #write(stream: Writable, text: string): Promise<void> {
    if (stream.destroyed || stream.writableEnded) throw new Error('terminal output unavailable');
    await new Promise<void>((resolve, reject) => {
      stream.write(text, error => { if (error) reject(error); else resolve(); });
    });
  }
}
