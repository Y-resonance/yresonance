import { sqlLiteral, type SqlDialect } from './dialect';
export type FormulaMode = 'row' | 'aggregate';
export type FormulaType = 'number' | 'text' | 'date' | 'boolean' | 'null' | 'unknown';

export interface FormulaField {
  canonicalName: string;
  sql: string;
  type: FormulaType;
}

export interface CompiledFormula {
  sql: string;
  type: FormulaType;
  identifiers: string[];
}

type Token =
  | { kind: 'number'; value: string; position: number }
  | { kind: 'string'; value: string; position: number }
  | { kind: 'identifier'; value: string; position: number }
  | { kind: 'operator'; value: string; position: number }
  | { kind: 'punctuation'; value: '(' | ')' | ','; position: number }
  | { kind: 'eof'; value: ''; position: number };

type FormulaNode =
  | { kind: 'literal'; value: string | number | boolean | null }
  | { kind: 'identifier'; name: string }
  | { kind: 'unary'; operator: string; operand: FormulaNode }
  | { kind: 'binary'; operator: string; left: FormulaNode; right: FormulaNode }
  | { kind: 'call'; name: string; arguments: FormulaNode[] };

export const aggregateFormulaFunctions = [
  'sum',
  'avg',
  'min',
  'max',
  'count',
  'count_distinct',
] as const;
const aggregateFunctions = new Set<string>(aggregateFormulaFunctions);
export const rowFormulaFunctions = [
  'abs',
  'ceil',
  'floor',
  'round',
  'lower',
  'upper',
  'length',
  'contains',
  'starts_with',
  'ends_with',
  'coalesce',
  'if',
  'date_part',
  'nullif',
] as const;
const binaryPrecedence = new Map([
  ['or', 1],
  ['and', 2],
  ['=', 3],
  ['!=', 3],
  ['<>', 3],
  ['<', 3],
  ['<=', 3],
  ['>', 3],
  ['>=', 3],
  ['+', 4],
  ['-', 4],
  ['*', 5],
  ['/', 5],
  ['%', 5],
]);

export function compileFormula(
  source: string,
  options: { mode: FormulaMode; fields: FormulaField[]; dialect?: SqlDialect },
): CompiledFormula {
  const parser = new FormulaParser(tokenize(source));
  const node = parser.parse();
  const fields = new Map<string, FormulaField>();
  for (const field of options.fields) {
    const key = field.canonicalName.toLocaleLowerCase('en-US');
    if (fields.has(key)) throw new Error(`Formula field ${field.canonicalName} is ambiguous.`);
    fields.set(key, field);
  }
  const identifiers = new Set<string>();

  const compile = (
    current: FormulaNode,
    aggregateDepth = 0,
  ): { sql: string; type: FormulaType } => {
    if (current.kind === 'literal') return compileLiteral(current.value, options.dialect);
    if (current.kind === 'identifier') {
      const field = fields.get(current.name.toLocaleLowerCase('en-US'));
      if (!field) throw new Error(`Unknown formula field ${current.name}.`);
      if (options.mode === 'aggregate' && aggregateDepth === 0)
        throw new Error(`Aggregate formulas must aggregate field ${current.name}.`);
      identifiers.add(field.canonicalName);
      return { sql: field.sql, type: field.type };
    }
    if (current.kind === 'unary') {
      const operand = compile(current.operand, aggregateDepth);
      if (current.operator === 'not') {
        requireType(operand.type, 'boolean', 'NOT');
        return { sql: `(NOT ${operand.sql})`, type: 'boolean' };
      }
      requireType(operand.type, 'number', current.operator);
      return { sql: `(${current.operator}${operand.sql})`, type: 'number' };
    }
    if (current.kind === 'binary') {
      const left = compile(current.left, aggregateDepth);
      const right = compile(current.right, aggregateDepth);
      if (current.operator === 'and' || current.operator === 'or') {
        requireType(left.type, 'boolean', current.operator.toUpperCase());
        requireType(right.type, 'boolean', current.operator.toUpperCase());
        return {
          sql: `(${left.sql} ${current.operator.toUpperCase()} ${right.sql})`,
          type: 'boolean',
        };
      }
      if (['+', '-', '*', '/', '%'].includes(current.operator)) {
        requireType(left.type, 'number', current.operator);
        requireType(right.type, 'number', current.operator);
        return { sql: `(${left.sql} ${current.operator} ${right.sql})`, type: 'number' };
      }
      requireComparable(left.type, right.type, current.operator);
      return { sql: `(${left.sql} ${current.operator} ${right.sql})`, type: 'boolean' };
    }

    const name = current.name.toLocaleLowerCase('en-US');
    const aggregate = aggregateFunctions.has(name);
    if (aggregate) {
      if (options.mode === 'row')
        throw new Error(
          `${current.name} is only allowed in aggregate formulas. Create a library metric instead.`,
        );
      if (aggregateDepth > 0) throw new Error('Aggregate functions cannot be nested.');
    }
    const compiledArguments = current.arguments.map((argument) =>
      compile(argument, aggregate ? aggregateDepth + 1 : aggregateDepth),
    );
    return compileCall(name, compiledArguments, options.dialect);
  };

  const result = compile(node);
  return { ...result, identifiers: [...identifiers] };
}

export function formulaIdentifiers(source: string) {
  const root = new FormulaParser(tokenize(source)).parse();
  const identifiers = new Set<string>();
  const visit = (node: FormulaNode) => {
    if (node.kind === 'identifier') {
      identifiers.add(node.name);
      return;
    }
    if (node.kind === 'unary') {
      visit(node.operand);
      return;
    }
    if (node.kind === 'binary') {
      visit(node.left);
      visit(node.right);
      return;
    }
    if (node.kind === 'call') for (const argument of node.arguments) visit(argument);
  };
  visit(root);
  return [...identifiers];
}

export function formulaTypeForSemanticType(semanticType: string): FormulaType {
  if (semanticType === 'currency' || semanticType === 'count' || semanticType === 'ratio')
    return 'number';
  if (semanticType === 'date') return 'date';
  if (semanticType === 'text' || semanticType === 'id') return 'text';
  return 'unknown';
}

function compileCall(
  name: string,
  args: Array<{ sql: string; type: FormulaType }>,
  dialect?: SqlDialect,
): { sql: string; type: FormulaType } {
  if (name === 'sum' || name === 'avg') {
    requireArgumentCount(name, args, 1);
    requireType(args[0].type, 'number', name);
    return { sql: `${name.toUpperCase()}(${args[0].sql})`, type: 'number' };
  }
  if (name === 'count' || name === 'count_distinct') {
    requireArgumentCount(name, args, 1);
    return {
      sql: name === 'count' ? `COUNT(${args[0].sql})` : `COUNT(DISTINCT ${args[0].sql})`,
      type: 'number',
    };
  }
  if (name === 'min' || name === 'max') {
    requireArgumentCount(name, args, 1);
    return { sql: `${name.toUpperCase()}(${args[0].sql})`, type: args[0].type };
  }
  if (name === 'abs' || name === 'ceil' || name === 'floor') {
    requireArgumentCount(name, args, 1);
    requireType(args[0].type, 'number', name);
    return { sql: `${name.toUpperCase()}(${args[0].sql})`, type: 'number' };
  }
  if (name === 'round') {
    if (args.length < 1 || args.length > 2) throw new Error('round expects one or two arguments.');
    requireType(args[0].type, 'number', name);
    if (args[1]) requireType(args[1].type, 'number', name);
    return { sql: `ROUND(${args.map((argument) => argument.sql).join(', ')})`, type: 'number' };
  }
  if (name === 'lower' || name === 'upper') {
    requireArgumentCount(name, args, 1);
    requireType(args[0].type, 'text', name);
    return { sql: `${name.toUpperCase()}(${args[0].sql})`, type: 'text' };
  }
  if (name === 'length') {
    requireArgumentCount(name, args, 1);
    requireType(args[0].type, 'text', name);
    return {
      sql: `${dialect === 'clickhouse' ? 'lengthUTF8' : 'LENGTH'}(${args[0].sql})`,
      type: 'number',
    };
  }
  if (name === 'contains' || name === 'starts_with' || name === 'ends_with') {
    requireArgumentCount(name, args, 2);
    requireType(args[0].type, 'text', name);
    requireType(args[1].type, 'text', name);
    if (dialect === 'clickhouse') {
      const sql =
        name === 'contains'
          ? `(position(${args[0].sql}, ${args[1].sql}) > 0)`
          : `${name === 'starts_with' ? 'startsWith' : 'endsWith'}(${args[0].sql}, ${args[1].sql})`;
      return { sql, type: 'boolean' };
    }
    const sqlName: Record<string, string> = {
      contains: 'CONTAINS',
      starts_with: 'STARTS_WITH',
      ends_with: 'ENDS_WITH',
    };
    return { sql: `${sqlName[name]}(${args[0].sql}, ${args[1].sql})`, type: 'boolean' };
  }
  if (name === 'coalesce') {
    if (!args.length) throw new Error('coalesce expects at least one argument.');
    const type = commonType(
      args.map((argument) => argument.type),
      name,
    );
    return { sql: `COALESCE(${args.map((argument) => argument.sql).join(', ')})`, type };
  }
  if (name === 'if') {
    requireArgumentCount(name, args, 3);
    requireType(args[0].type, 'boolean', name);
    const type = commonType([args[1].type, args[2].type], name);
    return { sql: `CASE WHEN ${args[0].sql} THEN ${args[1].sql} ELSE ${args[2].sql} END`, type };
  }
  if (name === 'date_part') {
    requireArgumentCount(name, args, 2);
    requireType(args[0].type, 'text', name);
    requireType(args[1].type, 'date', name);
    return { sql: `DATE_PART(${args[0].sql}, ${args[1].sql})`, type: 'number' };
  }
  if (name === 'nullif') {
    requireArgumentCount(name, args, 2);
    requireComparable(args[0].type, args[1].type, name);
    return { sql: `NULLIF(${args[0].sql}, ${args[1].sql})`, type: args[0].type };
  }
  throw new Error(`Formula function ${name} is not allowed.`);
}

function compileLiteral(value: string | number | boolean | null, dialect?: SqlDialect) {
  if (value === null) return { sql: 'NULL', type: 'null' as const };
  if (typeof value === 'boolean')
    return { sql: value ? 'TRUE' : 'FALSE', type: 'boolean' as const };
  if (typeof value === 'number') return { sql: String(value), type: 'number' as const };
  return { sql: sqlLiteral(value, dialect), type: 'text' as const };
}

function requireArgumentCount(name: string, args: unknown[], expected: number) {
  if (args.length !== expected)
    throw new Error(`${name} expects ${expected} argument${expected === 1 ? '' : 's'}.`);
}

function requireType(actual: FormulaType, expected: FormulaType, operation: string) {
  if (actual !== expected && actual !== 'null' && actual !== 'unknown')
    throw new Error(`${operation} expects ${expected} values, received ${actual}.`);
}

function requireComparable(left: FormulaType, right: FormulaType, operation: string) {
  if (
    left !== right &&
    left !== 'null' &&
    right !== 'null' &&
    left !== 'unknown' &&
    right !== 'unknown'
  )
    throw new Error(`${operation} cannot compare ${left} and ${right}.`);
}

function commonType(types: FormulaType[], operation: string) {
  const concrete = [...new Set(types.filter((type) => type !== 'null' && type !== 'unknown'))];
  if (concrete.length > 1) throw new Error(`${operation} branches must return the same type.`);
  return concrete[0] ?? 'unknown';
}

class FormulaParser {
  private index = 0;

  constructor(private readonly tokens: Token[]) {}

  parse() {
    const expression = this.parseExpression(0);
    const token = this.peek();
    if (token.kind !== 'eof') throw syntaxError(token, `Unexpected ${token.value}.`);
    return expression;
  }

  private parseExpression(minimumPrecedence: number): FormulaNode {
    let left = this.parsePrefix();
    while (true) {
      const token = this.peek();
      const operator = binaryOperator(token);
      if (!operator) break;
      const precedence = binaryPrecedence.get(operator);
      if (precedence === undefined || precedence < minimumPrecedence) break;
      this.index += 1;
      const right = this.parseExpression(precedence + 1);
      left = { kind: 'binary', operator, left, right };
    }
    return left;
  }

  private parsePrefix(): FormulaNode {
    const token = this.take();
    if (token.kind === 'number') {
      const value = Number(token.value);
      if (!Number.isFinite(value)) throw syntaxError(token, 'Number must be finite.');
      return { kind: 'literal', value };
    }
    if (token.kind === 'string') return { kind: 'literal', value: token.value };
    if (token.kind === 'operator' && (token.value === '+' || token.value === '-'))
      return { kind: 'unary', operator: token.value, operand: this.parseExpression(6) };
    if (token.kind === 'identifier') {
      const name = token.value.toLocaleLowerCase('en-US');
      if (name === 'true' || name === 'false') return { kind: 'literal', value: name === 'true' };
      if (name === 'null') return { kind: 'literal', value: null };
      if (name === 'not')
        return { kind: 'unary', operator: name, operand: this.parseExpression(3) };
      if (this.peek().kind === 'punctuation' && this.peek().value === '(') {
        this.index += 1;
        const arguments_: FormulaNode[] = [];
        if (!(this.peek().kind === 'punctuation' && this.peek().value === ')')) {
          arguments_.push(this.parseExpression(0));
          while (this.peek().kind === 'punctuation' && this.peek().value === ',') {
            this.index += 1;
            arguments_.push(this.parseExpression(0));
          }
        }
        const closing = this.take();
        if (closing.kind !== 'punctuation' || closing.value !== ')')
          throw syntaxError(closing, 'Expected a closing parenthesis.');
        return { kind: 'call', name: token.value, arguments: arguments_ };
      }
      return { kind: 'identifier', name: token.value };
    }
    if (token.kind === 'punctuation' && token.value === '(') {
      const expression = this.parseExpression(0);
      const closing = this.take();
      if (closing.kind !== 'punctuation' || closing.value !== ')')
        throw syntaxError(closing, 'Expected a closing parenthesis.');
      return expression;
    }
    throw syntaxError(token, 'Expected a value, field, or function.');
  }

  private peek() {
    return this.tokens[this.index];
  }

  private take() {
    return this.tokens[this.index++];
  }
}

function binaryOperator(token: Token) {
  if (token.kind === 'operator') return token.value;
  if (token.kind !== 'identifier') return undefined;
  const value = token.value.toLocaleLowerCase('en-US');
  return value === 'and' || value === 'or' ? value : undefined;
}

function tokenize(source: string) {
  if (!source.trim()) throw new Error('Formula cannot be empty.');
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (/\s/u.test(character)) {
      index += 1;
      continue;
    }
    const position = index;
    if (/\d/u.test(character) || (character === '.' && /\d/u.test(source[index + 1] ?? ''))) {
      const value = source.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/iu)?.[0];
      if (!value) throw new Error(`Invalid number at position ${position + 1}.`);
      tokens.push({ kind: 'number', value, position });
      index += value.length;
      continue;
    }
    if (character === "'") {
      let value = '';
      index += 1;
      let closed = false;
      while (index < source.length) {
        if (source[index] !== "'") {
          value += source[index++];
          continue;
        }
        if (source[index + 1] === "'") {
          value += "'";
          index += 2;
          continue;
        }
        index += 1;
        closed = true;
        break;
      }
      if (!closed) throw new Error(`Unclosed string at position ${position + 1}.`);
      tokens.push({ kind: 'string', value, position });
      continue;
    }
    if (character === '"') {
      let value = '';
      index += 1;
      let closed = false;
      while (index < source.length) {
        if (source[index] !== '"') {
          value += source[index++];
          continue;
        }
        if (source[index + 1] === '"') {
          value += '"';
          index += 2;
          continue;
        }
        index += 1;
        closed = true;
        break;
      }
      if (!closed) throw new Error(`Unclosed field name at position ${position + 1}.`);
      tokens.push({ kind: 'identifier', value, position });
      continue;
    }
    const identifier = source.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/u)?.[0];
    if (identifier) {
      tokens.push({ kind: 'identifier', value: identifier, position });
      index += identifier.length;
      continue;
    }
    const twoCharacters = source.slice(index, index + 2);
    if (['<=', '>=', '!=', '<>'].includes(twoCharacters)) {
      tokens.push({ kind: 'operator', value: twoCharacters, position });
      index += 2;
      continue;
    }
    if ('+-*/%=<>'.includes(character)) {
      tokens.push({ kind: 'operator', value: character, position });
      index += 1;
      continue;
    }
    if (character === '(' || character === ')' || character === ',') {
      tokens.push({ kind: 'punctuation', value: character, position });
      index += 1;
      continue;
    }
    throw new Error(`Unexpected ${character} at position ${position + 1}.`);
  }
  tokens.push({ kind: 'eof', value: '', position: source.length });
  return tokens;
}

function syntaxError(token: Token, message: string) {
  return new Error(`${message} Position ${token.position + 1}.`);
}
