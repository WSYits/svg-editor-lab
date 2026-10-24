import type { SvgDocument } from '../../domain/SvgDocument.js';
import { CommandResult } from '../CommandResult.js';
import { Command } from './Command.js';

export class BackCommand extends Command {
  readonly #id: string;

  constructor(id: string) {
    super();
    this.#id = id;
  }

  execute(candidate: SvgDocument): CommandResult {
    candidate.back(this.#id);
    const shape = candidate.findById(this.#id)!;
    return new CommandResult(`${shape.type}#${shape.id} moved to back`);
  }
}
