// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

import * as fs from 'fs';
import * as path from 'path';
import * as vsctm from 'vscode-textmate';
import * as oniguruma from 'vscode-oniguruma';

/**
 * Tokenizes Cedar policy and Cedar schema with the same TextMate engine VS Code
 * uses (vscode-textmate over the Oniguruma regex engine), so that
 * syntaxes/*.tmLanguage.json can be asserted on directly.
 */

export const CEDAR = 'source.cedar';
export const CEDARSCHEMA = 'source.cedarschema';

export interface TmToken {
  text: string;
  scopes: string[];
}

// out/test/suite -> repository root
const root = path.join(__dirname, '..', '..', '..');

const GRAMMARS: Record<string, string> = {
  [CEDAR]: path.join(root, 'syntaxes', 'cedar.tmLanguage.json'),
  [CEDARSCHEMA]: path.join(root, 'syntaxes', 'cedarschema.tmLanguage.json'),
};

const onigLib = (async () => {
  const wasm = fs.readFileSync(
    require.resolve('vscode-oniguruma/release/onig.wasm')
  );
  await oniguruma.loadWASM(wasm);
  return {
    createOnigScanner: (patterns: string[]) =>
      new oniguruma.OnigScanner(patterns),
    createOnigString: (s: string) => new oniguruma.OnigString(s),
  };
})();

const registry = new vsctm.Registry({
  onigLib,
  loadGrammar: async (scopeName: string) => {
    const file = GRAMMARS[scopeName];
    if (!file) {
      return null;
    }
    return vsctm.parseRawGrammar(fs.readFileSync(file, 'utf8'), file);
  },
});

const cache = new Map<string, vsctm.IGrammar>();

export const grammarFor = async (scopeName: string): Promise<vsctm.IGrammar> => {
  let grammar = cache.get(scopeName);
  if (!grammar) {
    const loaded = await registry.loadGrammar(scopeName);
    if (!loaded) {
      throw new Error(`no grammar registered for ${scopeName}`);
    }
    grammar = loaded;
    cache.set(scopeName, grammar);
  }
  return grammar;
};

/**
 * Tokenize source text, returning every token whose text is not pure
 * whitespace.
 */
export const tokenize = async (
  scopeName: string,
  source: string
): Promise<TmToken[]> => {
  const grammar = await grammarFor(scopeName);
  const tokens: TmToken[] = [];
  let ruleStack = vsctm.INITIAL;
  for (const line of source.split(/\r?\n/)) {
    const result = grammar.tokenizeLine(line, ruleStack);
    ruleStack = result.ruleStack;
    for (const token of result.tokens) {
      const text = line.substring(token.startIndex, token.endIndex);
      if (text.trim() === '') {
        continue;
      }
      tokens.push({ text, scopes: token.scopes });
    }
  }
  return tokens;
};

/**
 * The scopes applied to the first token matching `text`, with the root scope
 * removed. Token text is compared after trimming, because TextMate emits an
 * unscoped run together with the whitespace around it. Returns an empty array
 * when the token carries no grammar scope, and undefined when there is no such
 * token.
 */
export const scopesOf = async (
  scopeName: string,
  source: string,
  text: string
): Promise<string[] | undefined> => {
  const tokens = await tokenize(scopeName, source);
  const hit = tokens.find((t) => t.text === text || t.text.trim() === text);
  if (!hit) {
    return undefined;
  }
  return hit.scopes.filter((s) => s !== scopeName);
};

/** Asserts that the token matching `text` carries a scope starting with `prefix`. */
export const assertScope = async (
  scopeName: string,
  source: string,
  text: string,
  prefix: string
): Promise<void> => {
  const scopes = await scopesOf(scopeName, source, text);
  if (scopes === undefined) {
    throw new Error(
      `no token ${JSON.stringify(text)} in ${JSON.stringify(source)}`
    );
  }
  if (!scopes.some((s) => s.startsWith(prefix))) {
    throw new Error(
      `expected ${JSON.stringify(text)} to carry a scope starting with ` +
        `"${prefix}", got ${JSON.stringify(scopes)}`
    );
  }
};

/** Asserts that the token matching `text` does not carry a scope starting with `prefix`. */
export const assertNotScope = async (
  scopeName: string,
  source: string,
  text: string,
  prefix: string
): Promise<void> => {
  const scopes = await scopesOf(scopeName, source, text);
  if (scopes === undefined) {
    throw new Error(
      `no token ${JSON.stringify(text)} in ${JSON.stringify(source)}`
    );
  }
  if (scopes.some((s) => s.startsWith(prefix))) {
    throw new Error(
      `expected ${JSON.stringify(text)} NOT to carry "${prefix}", ` +
        `got ${JSON.stringify(scopes)}`
    );
  }
};

/** Asserts that the token matching `text` exists and carries no grammar scope. */
export const assertUnscoped = async (
  scopeName: string,
  source: string,
  text: string
): Promise<void> => {
  const scopes = await scopesOf(scopeName, source, text);
  if (scopes === undefined) {
    throw new Error(
      `no token ${JSON.stringify(text)} in ${JSON.stringify(source)}`
    );
  }
  if (scopes.length !== 0) {
    throw new Error(
      `expected ${JSON.stringify(text)} to be unscoped, got ${JSON.stringify(scopes)}`
    );
  }
};

/** Wraps an expression in a minimal well formed policy. */
export const policy = (expr: string): string =>
  `permit (principal, action, resource)\nwhen { ${expr} };`;
