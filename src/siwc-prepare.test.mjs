import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { test } from 'node:test';
import { unseal, binding } from './siwc/session.mjs';

test('prepare resolves the caller SDK and persists to the selected Environment before releasing a ticket', () => {
  const root = mkdtempSync(join(tmpdir(), 'midscene-siwc-prepare-'));
  try {
    const core = join(root, 'node_modules/@midscene/core');
    const bin = join(root, 'bin');
    mkdirSync(core, { recursive: true });
    mkdirSync(bin);
    writeFileSync(join(root, 'package.json'), '{}');
    writeFileSync(
      join(core, 'package.json'),
      JSON.stringify({ exports: { './siwc': './model.cjs' } }),
    );
    writeFileSync(
      join(core, 'model.cjs'),
      `exports.refreshSiwcCredentials = async c => ({...c,access_token:'next-access',refresh_token:'next-refresh',expires_at:Date.now()+3600000});`,
    );
    writeFileSync(
      join(bin, 'gh'),
      `#!/usr/bin/env node
const fs=require('node:fs');fs.writeFileSync(process.env.OWNER_CAPTURE, JSON.stringify({args:process.argv.slice(2),record:JSON.parse(fs.readFileSync(0,'utf8'))}));`,
      { mode: 0o700 },
    );
    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      SIWC_PROJECT_DIRECTORY: root,
      SIWC_ENVIRONMENT: 'custom-owner',
      SIWC_SECRET_NAME: 'CUSTOM_SESSION',
      GH_TOKEN: 'fixture-github',
      SIWC_TRANSPORT_KEY: 'ab'.repeat(32),
      GITHUB_REPOSITORY: 'example/project',
      GITHUB_RUN_ID: '42',
      GITHUB_RUN_ATTEMPT: '1',
      GITHUB_OUTPUT: join(root, 'outputs'),
      OWNER_CAPTURE: join(root, 'capture'),
      SIWC_CREDENTIALS: JSON.stringify({
        host: 'keep-metadata',
        credentials: {
          access_token: 'old-access',
          refresh_token: 'old-refresh',
          expires_at: 0,
        },
      }),
    };
    const run = spawnSync(process.execPath, [resolve('src/siwc/prepare.mjs')], {
      env,
      encoding: 'utf8',
    });
    assert.equal(run.status, 0, run.stderr);
    const captured = JSON.parse(readFileSync(env.OWNER_CAPTURE, 'utf8'));
    assert.deepEqual(captured.args, [
      'secret',
      'set',
      'CUSTOM_SESSION',
      '--repo',
      'example/project',
      '--env',
      'custom-owner',
    ]);
    assert.equal(captured.record.host, 'keep-metadata');
    assert.equal(captured.record.credentials.refresh_token, 'next-refresh');
    const ticket = readFileSync(env.GITHUB_OUTPUT, 'utf8')
      .trim()
      .slice('ticket='.length);
    assert.equal(
      unseal(ticket, env.SIWC_TRANSPORT_KEY, binding(env)).access_token,
      'next-access',
    );
    assert.ok(
      run.stdout.indexOf('persisted') < run.stdout.indexOf('handoff ready'),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const scenario of [
  {
    name: 'missing SDK entry',
    exports: {},
    expected: /SDK SIWC entry; code=ERR_PACKAGE_PATH_NOT_EXPORTED/,
  },
  {
    name: 'missing SDK method',
    source: 'module.exports = {}',
    expected: /SDK SIWC entry;.*Install a Core build/,
  },
  {
    name: 'malformed credentials',
    credentials: '{fixture-sensitive-json',
    expected: /credential JSON; code=INVALID_JSON/,
  },
  {
    name: 'refresh timeout',
    source: `exports.refreshSiwcCredentials=async()=>{throw Object.assign(new Error('fixture-sensitive-body'),{name:'TimeoutError'})}`,
    expected: /OpenAI refresh; code=TIMEOUT/,
  },
  {
    name: 'refresh HTTP rejection',
    source: `exports.refreshSiwcCredentials=async()=>{throw Object.assign(new Error('HTTP status: 401\\nResponse body: fixture-sensitive-body'),{name:'SiwcError'})}`,
    expected: /OpenAI refresh; code=UNCLASSIFIED; http=401/,
  },
]) {
  test(`prepare distinguishes ${scenario.name} without leaking raw diagnostics or releasing a ticket`, () => {
    const root = mkdtempSync(join(tmpdir(), 'siwc-errors-'));
    try {
      const core = join(root, 'node_modules/@midscene/core');
      mkdirSync(core, { recursive: true });
      writeFileSync(join(root, 'package.json'), '{}');
      writeFileSync(
        join(core, 'package.json'),
        JSON.stringify({
          exports: scenario.exports ?? { './siwc': './model.cjs' },
        }),
      );
      writeFileSync(
        join(core, 'model.cjs'),
        scenario.source ?? 'module.exports = {}',
      );
      const output = join(root, 'output');
      const result = spawnSync(
        process.execPath,
        [resolve('src/siwc/prepare.mjs')],
        {
          env: {
            ...process.env,
            SIWC_PROJECT_DIRECTORY: root,
            SIWC_ENVIRONMENT: 'owner',
            SIWC_SECRET_NAME: 'SESSION',
            GH_TOKEN: 'fixture-gh',
            GITHUB_OUTPUT: output,
            SIWC_TRANSPORT_KEY: 'ab'.repeat(32),
            GITHUB_REPOSITORY: 'example/project',
            GITHUB_RUN_ID: '42',
            SIWC_CREDENTIALS:
              scenario.credentials ??
              JSON.stringify({
                credentials: {
                  access_token: 'fixture-access',
                  refresh_token: 'fixture-refresh',
                  expires_at: 0,
                },
              }),
          },
          encoding: 'utf8',
        },
      );
      assert.equal(result.status, 1);
      assert.match(result.stderr, scenario.expected);
      assert.doesNotMatch(
        result.stderr,
        /fixture-sensitive|fixture-access|fixture-refresh|fixture-gh|Response body|model.cjs/,
      );
      assert.equal(result.stdout.includes('ticket='), false);
      assert.throws(() => readFileSync(output), { code: 'ENOENT' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
