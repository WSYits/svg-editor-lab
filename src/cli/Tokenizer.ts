export interface Token {
  readonly value: string;
  readonly quoted: boolean;
}

export class Tokenizer {
  tokenize(line: string): readonly Token[] {
    if (/^\s*(?:#|$)/u.test(line)) return Object.freeze([]);
    const tokens: Token[] = [];
    let index = 0;
    while (index < line.length) {
      if (/\s/u.test(line[index]!)) { index++; continue; }
      const quoted = line[index] === '"';
      let value = '';
      if (quoted) {
        index++;
        let closed = false;
        while (index < line.length) {
          const char = line[index++]!;
          if (char === '"') { closed = true; break; }
          if (char === '\\') {
            const escaped = line[index++];
            if (escaped !== '"' && escaped !== '\\') throw new Error('invalid escape in quoted string');
            value += escaped;
          } else value += char;
        }
        if (!closed) throw new Error('unterminated quoted string');
        if (index < line.length && !/\s/u.test(line[index]!)) throw new Error('expected whitespace after quoted string');
      } else {
        while (index < line.length && !/\s/u.test(line[index]!)) {
          const char = line[index++]!;
          if (char === '"') throw new Error('quote must start a token');
          value += char;
        }
      }
      tokens.push(Object.freeze({ value, quoted }));
    }
    return Object.freeze(tokens);
  }
}
