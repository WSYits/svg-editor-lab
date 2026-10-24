import type { Terminal } from '../io/Terminal.js';
import { CommandDispatcher } from './CommandDispatcher.js';
import type { CommandOutput } from './CommandOutput.js';
import { Presenter } from './Presenter.js';

export class Repl {
  readonly #dispatcher: CommandDispatcher;
  readonly #terminal: Terminal;
  readonly #presenter: Presenter;
  #started = false;

  constructor(dispatcher: CommandDispatcher, terminal: Terminal, presenter = new Presenter()) {
    this.#dispatcher = dispatcher; this.#terminal = terminal; this.#presenter = presenter;
  }

  async run(): Promise<number> {
    if (this.#started) throw new Error('REPL is single use');
    this.#started = true;
    let status = 0;
    try {
      await this.#terminal.write("svg-editor 0.1 — type 'help' for commands\n");
      const lines = this.#terminal.lines();
      await this.#terminal.prompt();
      for await (const line of lines) {
        let output: CommandOutput | undefined;
        let failure: unknown;
        let failed = false;
        try { output = this.#dispatcher.execute(line); }
        catch (error) { failed = true; failure = error; }
        // Presentation/transport are outside the command catch. An operation
        // already committed must never be retried or described as having failed.
        const display = failed ? this.#presenter.error(failure) : this.#presenter.output(output!);
        if (display !== '') await this.#terminal.write(`${display}\n`);
        await this.#terminal.prompt();
      }
    } catch {
      status = 1;
      await this.#diagnose();
    } finally {
      try { await this.#terminal.close(); } catch { if (status === 0) await this.#diagnose(); status = 1; }
    }
    return status;
  }

  async #diagnose(): Promise<void> {
    try { await this.#terminal.writeError('terminal failure: input/output or presentation unavailable; session stopped\n'); }
    catch { /* One diagnostic attempt only; no fallback loop. */ }
  }
}
