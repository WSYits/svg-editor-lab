import type { SvgDocument } from '../../domain/SvgDocument.js';
import { CommandResult } from '../CommandResult.js';
import { Command } from './Command.js';

export class UngroupCommand extends Command {
  readonly #id: string;

  constructor(id: string) {
    super();
    this.#id = id;
  }

  execute(candidate: SvgDocument): CommandResult {
    const group = candidate.ungroup(this.#id);
    return new CommandResult(`g#${group.id} ungrouped`);
  }
}
