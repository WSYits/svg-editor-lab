import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { SvgCodec } from '../src/svg/SvgCodec.js';
import { EditorService } from '../src/application/EditorService.js';
import { CommandDispatcher } from '../src/cli/CommandDispatcher.js';

for (const [name, start, count] of [['§6 main session', '## 6. 典型会话', 5], ['§6.1 manual flowchart', '会话过程：', 8]] as const) {
  test(`${name}: task memory commands produce an SVG model that round trips before the unimplemented save step`, () => {
    const task = readFileSync('requirements/phase1.md', 'utf8');
    const part = task.slice(task.indexOf(start));
    const service = new EditorService(); const dispatcher = new CommandDispatcher(service);
    for (const match of part.matchAll(/^svg> (.+)$/gmu)) {
      const command = match[1]!;
      if (command.startsWith('save ')) break;
      if (command.startsWith('group bad ')) assert.throws(() => dispatcher.dispatch(command), /descendant/);
      else dispatcher.dispatch(command);
    }
    const document = service.getDocumentSnapshot()!; const codec = new SvgCodec();
    const encoded = codec.encode(document); const restored = codec.decode(encoded);
    const traverse = (nodes: typeof document.roots): number => nodes.reduce((sum, node) => sum + 1 + traverse(node.children), 0);
    assert.equal(traverse(restored.document.roots), count);
    assert.equal(codec.encode(restored.document), encoded);
    assert.equal(restored.document.width, 800); assert.equal(restored.document.height, 600);
    assert.deepEqual(restored.warnings, []);
  });
}
