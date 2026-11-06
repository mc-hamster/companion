// SPDX-License-Identifier: GPL-3.0-or-later
export const CONDITIONAL_RULE_LIMIT = 20000;

function compileCondition(source) {
  const pattern = /\s*(?:\$(TA|TI|UP)\{([^{}]+)\}|(AND|OR|NOT)\b|([()]))/iy;
  const tokens = [];
  while (pattern.lastIndex < source.length) {
    const match = pattern.exec(source);
    if (!match) throw new Error('Expected a tag, title, uploader, or logical operator.');
    const [, selector, value, operator, paren] = match;
    if (selector && !value.trim()) throw new Error('A selector needs a value between braces.');
    tokens.push(selector ? { selector: selector.toUpperCase(), value: value.trim(), key: value.trim().toLocaleLowerCase() } :
      operator?.toUpperCase() || paren);
    if (tokens.length > 128) throw new Error('Split this expression into smaller rules.');
  }

  let index = 0;
  const take = token => {
    if (tokens[index] !== token) return false;
    index++;
    return true;
  };
  function term() {
    if (take('NOT')) {
      const test = term();
      return row => !test(row);
    }
    if (take('(')) {
      const test = expression();
      if (!take(')')) throw new Error('Missing a closing parenthesis.');
      return test;
    }
    const atom = tokens[index++];
    if (typeof atom !== 'object') throw new Error('Expected a selector or an opening parenthesis.');
    if (atom.selector === 'TA') return row => row.tags.has(atom.key);
    if (atom.selector === 'UP') return row => row.uploader === atom.key;
    return row => row.title.includes(atom.key);
  }
  function conjunction() {
    const tests = [term()];
    while (take('AND')) tests.push(term());
    return row => tests.every(test => test(row));
  }
  function expression() {
    const tests = [conjunction()];
    while (take('OR')) tests.push(conjunction());
    return row => tests.some(test => test(row));
  }
  const test = expression();
  if (index !== tokens.length) throw new Error('Expected AND or OR between conditions.');
  return { test, tokens };
}

export function compileConditionalRules(text) {
  if (text.length > CONDITIONAL_RULE_LIMIT) throw new Error('Conditional rules exceed 20,000 characters.');
  const rules = [];
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    try {
      const match = /^(HIDE|SHOW|PASS)\s*:\s*(.+)$/i.exec(line);
      if (!match) throw new Error('Start with HIDE, SHOW, or PASS followed by a colon and a condition.');
      rules.push({ action: match[1].toUpperCase(), line: index, ...compileCondition(match[2]) });
    } catch (error) {
      throw new Error('Line ' + (index + 1) + ' · ' + error.message);
    }
  }
  return rules;
}
