import type { AttributeValue } from '../../domain/Shape.js';
import type { SvgDocument } from '../../domain/SvgDocument.js';
import { CommandResult } from '../CommandResult.js';
import { Command } from './Command.js';

export class SetAttributeCommand extends Command {
  readonly #id: string;
  readonly #attribute: string;
  readonly #value: AttributeValue;

  constructor(id: string, attribute: string, value: AttributeValue) {
    super();
    this.#id = id;
    this.#attribute = attribute;
    this.#value = value;
  }

  execute(candidate: SvgDocument): CommandResult {
    const shape = candidate.findById(this.#id);
    if (shape === undefined) throw new Error(`no such shape: ${this.#id}`);
    shape.setAttribute(this.#attribute, this.#value);
    return new CommandResult(`${shape.type}#${shape.id} updated: ${this.#attribute}=${this.#value}`);
  }
}
