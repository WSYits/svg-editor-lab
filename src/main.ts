import { EditorService } from './application/EditorService.js';
import { CommandDispatcher } from './cli/CommandDispatcher.js';
import { Presenter } from './cli/Presenter.js';
import { Repl } from './cli/Repl.js';
import { Tokenizer } from './cli/Tokenizer.js';
import { ConsoleTerminal } from './io/ConsoleTerminal.js';
import { LocalFileStore } from './io/LocalFileStore.js';
import { SvgCodec } from './svg/SvgCodec.js';

const presenter = new Presenter();
const service = new EditorService(undefined, undefined, new LocalFileStore(), new SvgCodec());
const dispatcher = new CommandDispatcher(service, new Tokenizer(), presenter);
process.exitCode = await new Repl(dispatcher, new ConsoleTerminal(), presenter).run();
