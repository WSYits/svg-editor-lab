import type { SvgDocument } from '../../domain/SvgDocument.js';
import { CommandResult } from '../CommandResult.js';
import { Command } from './Command.js';

export class MoveCommand extends Command {
  readonly #id: string;
  readonly #dx: number;
  readonly #dy: number;

  constructor(id: string, dx: number, dy: number) {
    super();
    this.#id = id;
    this.#dx = dx;
    this.#dy = dy;
  }

  execute(candidate: SvgDocument): CommandResult {
    const shape = candidate.findById(this.#id);
    if (shape === undefined) throw new Error(`no such shape: ${this.#id}`);
    shape.move(this.#dx, this.#dy);
    return new CommandResult(`${shape.type}#${shape.id} moved by (${this.#dx},${this.#dy})`);
  }
}
