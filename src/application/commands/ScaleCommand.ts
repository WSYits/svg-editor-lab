import type { SvgDocument } from '../../domain/SvgDocument.js';
import { CommandResult } from '../CommandResult.js';
import { Command } from './Command.js';

export class ScaleCommand extends Command {
  readonly #id: string;
  readonly #factor: number;

  constructor(id: string, factor: number) {
    super();
    this.#id = id;
    this.#factor = factor;
  }

  execute(candidate: SvgDocument): CommandResult {
    const shape = candidate.findById(this.#id);
    if (shape === undefined) throw new Error(`no such shape: ${this.#id}`);
    shape.scale(this.#factor);
    return new CommandResult(`${shape.type}#${shape.id} scaled by ${this.#factor}`);
  }
}
