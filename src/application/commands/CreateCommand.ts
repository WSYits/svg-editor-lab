import type { AttributeValue } from '../../domain/Shape.js';
import type { SvgDocument } from '../../domain/SvgDocument.js';
import { ShapeFactory } from '../../domain/ShapeFactory.js';
import { CommandResult } from '../CommandResult.js';
import { Command } from './Command.js';

export class CreateCommand extends Command {
  readonly #type: string;
  readonly #id: string;
  readonly #attributes: Readonly<Record<string, AttributeValue>>;
  readonly #parentId: string | undefined;

  constructor(type: string, id: string, attributes: Readonly<Record<string, AttributeValue>> = {}, parentId?: string) {
    super();
    this.#type = type;
    this.#id = id;
    this.#attributes = Object.freeze({ ...attributes });
    this.#parentId = parentId;
  }

  execute(candidate: SvgDocument): CommandResult {
    const shape = new ShapeFactory().create(this.#type, this.#id, this.#attributes);
    candidate.insert(shape, this.#parentId);
    return new CommandResult(`${shape.type}#${shape.id} created${this.#parentId === undefined ? '' : ` in g#${this.#parentId}`}`);
  }
}
