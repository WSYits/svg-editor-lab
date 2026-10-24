import type { SvgDocument } from '../../domain/SvgDocument.js';
import { CommandResult } from '../CommandResult.js';
import { Command } from './Command.js';

export class GroupCommand extends Command {
  readonly #id: string;
  readonly #ids: readonly string[];

  constructor(newId: string, ids: readonly string[]) {
    super();
    this.#id = newId;
    this.#ids = Object.freeze([...ids]);
  }

  execute(candidate: SvgDocument): CommandResult {
    const group = candidate.group(this.#id, this.#ids);
    return new CommandResult(`g#${group.id} created with ${group.children.length} children`);
  }
}
