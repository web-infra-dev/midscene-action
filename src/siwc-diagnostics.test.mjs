import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reportFailure } from './siwc/diagnostics.mjs';

test('diagnostics use only allowlisted fields, including nested network errors', () => {
  const original = console.error;
  const logs = [];
  console.error = (line) => logs.push(line);
  try {
    reportFailure(
      'SIWC preparation',
      'OpenAI refresh',
      new Error('sensitive-token', {
        cause: Object.assign(new Error('sensitive-body'), {
          code: 'ETIMEDOUT',
        }),
      }),
    );
    reportFailure(
      'SIWC preparation',
      'OpenAI refresh',
      Object.assign(new Error('sensitive-token'), {
        code: 'secret-as-code',
        name: 'secret-as-name',
        status: 'secret-as-status',
      }),
    );
    reportFailure(
      'SIWC preparation',
      'environment-secret writeback',
      Object.assign(new Error('sensitive-gh-stderr'), { code: 'EACCES' }),
    );
  } finally {
    console.error = original;
  }
  assert.match(logs[0], /code=ETIMEDOUT/);
  assert.match(logs[1], /code=UNCLASSIFIED/);
  assert.match(logs[2], /writeback; code=EACCES/);
  assert.doesNotMatch(logs.join('\n'), /sensitive|secret-as/);
});
