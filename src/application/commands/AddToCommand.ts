import type { SvgDocument } from '../../domain/SvgDocument.js';
import { CommandResult } from '../CommandResult.js';
import { Command } from './Command.js';

export class AddToCommand extends Command {
  readonly #groupId: string;
  readonly #id: string;

  constructor(groupId: string, id: string) {
    super();
    this.#groupId = groupId;
    this.#id = id;
  }

  execute(candidate: SvgDocument): CommandResult {
    candidate.addTo(this.#groupId, this.#id);
    const shape = candidate.findById(this.#id)!;
    return new CommandResult(`${shape.type}#${shape.id} moved into g#${this.#groupId}`);
  }
}
