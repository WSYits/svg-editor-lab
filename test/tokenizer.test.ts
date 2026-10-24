import assert from 'node:assert/strict';
import test from 'node:test';
import { Tokenizer } from '../src/cli/Tokenizer.js';

for (const line of ['', ' \t ', '# ignored "', ' \t # full line comment']) {
  test(`tokenizer ignores blank/comment ${JSON.stringify(line)}`, () => {
    assert.deepEqual(new Tokenizer().tokenize(line), []);
  });
}
for (const [line, expected] of [
  ['  move\tr  1 2  ', ['move', 'r', '1', '2']],
  ['create text t 1 2 "你好 世界"', ['create', 'text', 't', '1', '2', '你好 世界']],
  ['set t text ""', ['set', 't', 'text', '']],
  ['set r fill #ffffff', ['set', 'r', 'fill', '#ffffff']],
  ['set t text "a\\"b\\\\c"', ['set', 't', 'text', 'a"b\\c']],
  ['set t text "# in"', ['set', 't', 'text', '# in']],
  ['move r 12abc Infinity', ['move', 'r', '12abc', 'Infinity']],
  ['help # not a trailing comment', ['help', '#', 'not', 'a', 'trailing', 'comment']],
] as const) {
  test(`tokenizer parses ${line}`, () => {
    assert.deepEqual(new Tokenizer().tokenize(line).map(token => token.value), expected);
  });
}
test('quoted marker, frozen tokens and reuse do not share mutable parsing state', () => {
  const tokenizer = new Tokenizer(); const tokens = tokenizer.tokenize('in "in" ""');
  assert.deepEqual(tokens.map(token => token.quoted), [false, true, true]);
  assert(Object.isFrozen(tokens)); assert(tokens.every(Object.isFrozen));
  assert.throws(() => Object.assign(tokens[0]!, { value: 'outside' }), TypeError);
  assert.deepEqual(tokenizer.tokenize('help'), [{ value: 'help', quoted: false }]);
});
for (const line of ['"unfinished', '"bad\\n"', '"bad\\t"', '"bad\\', '"x"tail', 'head"tail"']) {
  test(`tokenizer rejects malformed quoting ${JSON.stringify(line)}`, () => {
    assert.throws(() => new Tokenizer().tokenize(line));
  });
}
