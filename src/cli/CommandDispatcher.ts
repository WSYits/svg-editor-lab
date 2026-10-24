import type { EditorService } from '../application/EditorService.js';
import type { Command } from '../application/commands/Command.js';
import { CreateCommand } from '../application/commands/CreateCommand.js';
import { DeleteCommand } from '../application/commands/DeleteCommand.js';
import { MoveCommand } from '../application/commands/MoveCommand.js';
import { ScaleCommand } from '../application/commands/ScaleCommand.js';
import { SetAttributeCommand } from '../application/commands/SetAttributeCommand.js';
import { GroupCommand } from '../application/commands/GroupCommand.js';
import { UngroupCommand } from '../application/commands/UngroupCommand.js';
import { AddToCommand } from '../application/commands/AddToCommand.js';
import { FrontCommand } from '../application/commands/FrontCommand.js';
import { BackCommand } from '../application/commands/BackCommand.js';
import { Tokenizer, type Token } from './Tokenizer.js';
import { Presenter } from './Presenter.js';

interface CommandDefinition {
  readonly syntax: string;
  readonly requiresDocument: boolean;
  readonly minimum: number;
  readonly maximum: number;
  readonly run: (args: readonly Token[]) => string;
}

export class CommandDispatcher {
  readonly #service: EditorService;
  readonly #tokenizer: Tokenizer;
  readonly #presenter: Presenter;
  readonly #commands = new Map<string, CommandDefinition>();

  constructor(service: EditorService, tokenizer = new Tokenizer(), presenter = new Presenter()) {
    this.#service = service; this.#tokenizer = tokenizer; this.#presenter = presenter;
    // Single command-name registration point. Help uses these same entries.
    this.#register('init [w] [h]', false, 0, 2, args => {
      this.#dimensions(args);
      return this.#presenter.summary(args.length === 0 ? service.init() : service.init(this.#number(args[0]!), this.#number(args[1]!)));
    });
    this.#register('canvas [w] [h]', true, 0, 2, args => {
      this.#dimensions(args);
      return args.length === 0 ? this.#presenter.canvas(service.getCanvasSize())
        : this.#presenter.summary(service.resizeCanvas(this.#number(args[0]!), this.#number(args[1]!)));
    });
    this.#register('create <type> <id> [params…] [in <containerId>]', true, 2, Infinity, args => this.#create(args));
    this.#register('delete <id>', true, 1, 1, args => this.#edit(new DeleteCommand(args[0]!.value)));
    this.#register('move <id> <dx> <dy>', true, 3, 3, args => this.#edit(new MoveCommand(args[0]!.value, this.#number(args[1]!), this.#number(args[2]!))));
    this.#register('scale <id> <factor>', true, 2, 2, args => this.#edit(new ScaleCommand(args[0]!.value, this.#number(args[1]!))));
    this.#register('set <id> <attr> <value>', true, 3, 3, args => {
      const [id, attribute, value] = args;
      const kind = service.getAttributeKind(id!.value, attribute!.value);
      return this.#edit(new SetAttributeCommand(id!.value, attribute!.value, kind === 'number' ? this.#number(value!) : value!.value));
    });
    this.#register('group <newGid> <id1> [id2…]', true, 2, Infinity, args => this.#edit(new GroupCommand(args[0]!.value, args.slice(1).map(token => token.value))));
    this.#register('ungroup <gid>', true, 1, 1, args => this.#edit(new UngroupCommand(args[0]!.value)));
    this.#register('addto <gid> <id>', true, 2, 2, args => this.#edit(new AddToCommand(args[0]!.value, args[1]!.value)));
    this.#register('front <id>', true, 1, 1, args => this.#edit(new FrontCommand(args[0]!.value)));
    this.#register('back <id>', true, 1, 1, args => this.#edit(new BackCommand(args[0]!.value)));
    this.#register('tree [id]', true, 0, 1, args => this.#presenter.tree(service.getTreeView(args[0]?.value)));
    this.#register('show <id>', true, 1, 1, args => this.#presenter.show(service.getShapeView(args[0]!.value)));
    this.#register('help', false, 0, 0, () => this.#help());
    this.#register('undo', true, 0, 0, () => this.#presenter.summary(service.undo()));
    this.#register('redo', true, 0, 0, () => this.#presenter.summary(service.redo()));
  }

  dispatch(line: string): string {
    const tokens = this.#tokenizer.tokenize(line);
    if (tokens.length === 0) return '';
    const definition = this.#commands.get(tokens[0]!.value);
    if (!definition) throw new Error(`unknown command: ${tokens[0]!.value}`);
    if (definition.requiresDocument && !this.#service.hasDocument) {
      throw new Error("no document. use 'init' or 'read' first");
    }
    const args = tokens.slice(1);
    if (args.length < definition.minimum || args.length > definition.maximum) {
      throw new Error(`usage: ${definition.syntax}`);
    }
    return definition.run(args);
  }

  getHelpSyntaxes(): readonly string[] {
    return Object.freeze([...this.#commands.values()].map(definition => definition.syntax));
  }

  #register(syntax: string, requiresDocument: boolean, minimum: number, maximum: number, run: CommandDefinition['run']): void {
    this.#commands.set(syntax.split(' ')[0]!, Object.freeze({ syntax, requiresDocument, minimum, maximum, run }));
  }

  #help(): string {
    const creation = this.#service.getCreationTypes().map(type => {
      const parameters = this.#service.getCreationDescription(type).parameters
        .map(parameter => parameter.optional ? `[${parameter.name}]` : `<${parameter.name}>`).join(' ');
      return `create ${type} <id>${parameters ? ` ${parameters}` : ''} [in <containerId>]`;
    });
    return this.#presenter.help([...this.getHelpSyntaxes(), ...creation]);
  }

  #edit(command: Command): string { return this.#presenter.summary(this.#service.execute(command)); }

  #create(args: readonly Token[]): string {
    const description = this.#service.getCreationDescription(args[0]!.value);
    let values = args.slice(2);
    let parentId: string | undefined;
    const suffix = values.at(-2);
    if (suffix?.value === 'in' && !suffix.quoted) {
      parentId = values.at(-1)!.value;
      values = values.slice(0, -2);
    }
    const minimum = description.parameters.filter(parameter => !parameter.optional).length;
    if (values.length < minimum || values.length > description.parameters.length) {
      throw new Error(`invalid creation parameters for ${args[0]!.value}`);
    }
    const attributes: Record<string, string | number> = {};
    values.forEach((token, index) => {
      const parameter = description.parameters[index]!;
      attributes[parameter.name] = parameter.kind === 'number' ? this.#number(token) : token.value;
    });
    return this.#edit(new CreateCommand(args[0]!.value, args[1]!.value, attributes, parentId));
  }

  #dimensions(args: readonly Token[]): void {
    if (args.length === 1) throw new Error('expected zero or two dimensions');
  }

  #number(token: Token): number {
    const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u;
    const value = Number(token.value);
    if (!decimal.test(token.value) || !Number.isFinite(value)) throw new Error(`invalid number: ${token.value}`);
    return value;
  }
}
