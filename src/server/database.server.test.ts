import { expect, test } from 'vitest';
import { database } from './database.server';

test('database access outside an invocation fails before opening a connection', () => {
  expect(() => database()).toThrow('database() requires an invocation scope.');
});
