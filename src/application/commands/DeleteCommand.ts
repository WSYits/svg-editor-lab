import type { SvgDocument } from '../../domain/SvgDocument.js';
import { CommandResult } from '../CommandResult.js';
import { Command } from './Command.js';

export class DeleteCommand extends Command {
  readonly #id: string;

  constructor(id: string) {
    super();
    this.#id = id;
  }

  execute(candidate: SvgDocument): CommandResult {
    const removed = candidate.remove(this.#id);
    return new CommandResult(`${removed.type}#${removed.id} deleted`);
  }
}
