import type { SvgDocument } from '../../domain/SvgDocument.js';
import type { CommandResult } from '../CommandResult.js';

/** Synchronous editing behavior. The receiver is always an isolated candidate. */
export abstract class Command {
  abstract execute(candidate: SvgDocument): CommandResult;
}
