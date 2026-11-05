import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  accessLease,
  binding,
  prepare,
  seal,
  unseal,
} from './siwc/session.mjs';

const key = 'ab'.repeat(32);
const env = {
  GITHUB_REPOSITORY: 'tapilot-ai/tapilot',
  GITHUB_RUN_ID: '123',
  GITHUB_RUN_ATTEMPT: '1',
};
const context = binding(env);
const now = 1_800_000_000_000;
const credentials = {
  access_token: 'fixture-access',
  expires_at: now + 60 * 60_000,
  refresh_token: 'fixture-refresh',
  client_id: 'fixture-client',
  id_token: 'fixture-identity',
};

test('a valid session issues four access-only leases without rotating the shared session', async () => {
  let refreshes = 0;
  const ticket = await prepare(
    { credentials },
    {
      key,
      context,
      now: () => now,
      refresh: async () => {
        refreshes++;
        throw new Error('must not refresh');
      },
      persist: async () =>
        assert.fail('must not persist unchanged credentials'),
    },
  );
  for (let lane = 1; lane <= 4; lane++) {
    assert.deepEqual(unseal(ticket, key, context, now), {
      access_token: credentials.access_token,
      expires_at: credentials.expires_at,
    });
  }
  assert.equal(refreshes, 0);
  assert.ok(!ticket.includes(credentials.access_token));
  assert.ok(!ticket.includes(credentials.refresh_token));
});

test('an expired session rotates once and persists the replacement before releasing all consumers', async () => {
  const events = [];
  let stored = {
    ext_agent_host_id: 'fixture-host',
    credentials: { ...credentials, expires_at: now - 1 },
  };
  const replacement = {
    ...credentials,
    access_token: 'next-access',
    refresh_token: 'next-refresh',
  };
  const options = {
    key,
    context,
    now: () => now,
    refresh: async (saved) => {
      events.push('refresh');
      assert.equal(saved.refresh_token, 'fixture-refresh');
      return replacement;
    },
    persist: async (saved) => {
      events.push('persist');
      stored = saved;
    },
  };
  const ticket = await prepare(stored, options);
  events.push('release');
  assert.deepEqual(events, ['refresh', 'persist', 'release']);
  assert.equal(stored.ext_agent_host_id, 'fixture-host');
  assert.equal(stored.credentials.refresh_token, 'next-refresh');
  assert.equal(unseal(ticket, key, context, now).access_token, 'next-access');
  // Next serialized owner reads the updated environment secret; no second refresh.
  await prepare(stored, {
    ...options,
    context: binding({ ...env, GITHUB_RUN_ID: '124' }),
  });
  assert.deepEqual(events, ['refresh', 'persist', 'release']);
});

test('failed writeback never publishes a lease or retries the rotating grant', async () => {
  let refreshes = 0;
  await assert.rejects(
    prepare(
      { credentials: { ...credentials, expires_at: now - 1 } },
      {
        key,
        context,
        now: () => now,
        refresh: async () => {
          refreshes++;
          return credentials;
        },
        persist: async () => {
          throw new Error('write denied');
        },
      },
    ),
    /write denied/,
  );
  assert.equal(refreshes, 1);
});

test('manual acceptance can force a real refresh without falsifying the token expiration', async () => {
  let refreshes = 0;
  let stored;
  const ticket = await prepare(
    { credentials },
    {
      key,
      context,
      now: () => now,
      forceRefresh: true,
      refresh: async (saved) => {
        refreshes++;
        assert.equal(saved.expires_at, credentials.expires_at);
        return {
          ...saved,
          access_token: 'manually-refreshed',
          refresh_token: 'replacement',
        };
      },
      persist: async (saved) => {
        stored = saved;
      },
    },
  );
  assert.equal(refreshes, 1);
  assert.equal(stored.credentials.refresh_token, 'replacement');
  assert.equal(
    unseal(ticket, key, context, now).access_token,
    'manually-refreshed',
  );
});

test('invalid transport configuration cannot consume the refresh token', async () => {
  let refreshed = false;
  await assert.rejects(
    prepare(
      { credentials: { ...credentials, expires_at: now - 1 } },
      {
        key: 'bad',
        context,
        now: () => now,
        refresh: async () => {
          refreshed = true;
          return credentials;
        },
        persist: async () => {},
      },
    ),
    /32 random bytes/,
  );
  assert.equal(refreshed, false);
});

test('rotation is persisted even if the server gives a lease too short for the suite', async () => {
  let stored;
  await assert.rejects(
    prepare(
      { credentials: { ...credentials, expires_at: now - 1 } },
      {
        key,
        context,
        now: () => now,
        refresh: async () => ({
          ...credentials,
          refresh_token: 'rotated',
          expires_at: now + 60_000,
        }),
        persist: async (value) => {
          stored = value;
        },
      },
    ),
    /insufficient lifetime/,
  );
  assert.equal(stored.credentials.refresh_token, 'rotated');
});

test('same-run attempts reuse valid tickets; other repositories/runs, tampering and expiration fail closed', () => {
  const ticket = seal(accessLease(credentials, now), key, context);
  for (const changed of [
    { ...env, GITHUB_REPOSITORY: 'another/repo' },
    { ...env, GITHUB_RUN_ID: '124' },
  ])
    assert.throws(
      () => unseal(ticket, key, binding(changed), now),
      /Invalid SIWC/,
    );
  assert.throws(
    () => unseal(ticket, 'cd'.repeat(32), context, now),
    /Invalid SIWC/,
  );
  const bytes = Buffer.from(ticket, 'base64url');
  bytes[30] ^= 1;
  assert.throws(
    () => unseal(bytes.toString('base64url'), key, context, now),
    /Invalid SIWC/,
  );
  assert.throws(
    () => unseal(ticket, key, context, now + 39 * 60_000),
    /insufficient lifetime.*entire workflow/,
  );
  assert.deepEqual(
    unseal(ticket, key, binding({ ...env, GITHUB_RUN_ATTEMPT: '2' }), now),
    accessLease(credentials, now),
  );
  assert.equal(
    binding({
      GITHUB_REPOSITORY: env.GITHUB_REPOSITORY,
      GITHUB_RUN_ID: env.GITHUB_RUN_ID,
    }),
    context,
  );
  assert.throws(
    () => unseal(seal(credentials, key, context), key, context, now),
    /Invalid SIWC/,
  );
});

test('four separate runner homes retain configuration and caches while access files are removed', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'tapilot-siwc-test-'));
  const lease = {
    access_token: 'fixture-shard-access',
    expires_at: Date.now() + 60 * 60_000,
  };
  const ticket = seal(lease, key, context);
  const probe = `
    const fs = require('node:fs'); const assert = require('node:assert/strict');
    const file = process.env.HOME + '/.midscene/siwc.json';
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(Object.keys(record.credentials).sort(), ['access_token','expires_at']);
    assert.equal(process.env.HOME, process.env.EXPECTED_HOME);
    assert.equal(fs.readFileSync(process.env.HOME + '/.config/fixture', 'utf8'), 'existing-config');
    assert.equal(fs.readFileSync(process.env.HOME + '/.cache/ms-playwright/fixture', 'utf8'), 'installed-browser');
    assert.equal(process.env.MIDSCENE_MODEL_AUTH_MODE, 'siwc');
    assert.equal(record.credentials.access_token, process.env.MIDSCENE_SIWC_ACCESS_TOKEN);
    for (const name of ['SIWC_TICKET','SIWC_TRANSPORT_KEY','SIWC_CREDENTIALS','GH_TOKEN','MIDSCENE_MODEL_API_KEY'])
      assert.equal(process.env[name], undefined);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    fs.writeFileSync(process.argv[1], process.env.HOME);
  `;
  try {
    const results = await Promise.all(
      Array.from(
        { length: 4 },
        (_, lane) =>
          new Promise((resolve, reject) => {
            const home = join(directory, `home-${lane}`);
            mkdirSync(join(home, '.config'), { recursive: true });
            mkdirSync(join(home, '.cache/ms-playwright'), { recursive: true });
            writeFileSync(join(home, '.config/fixture'), 'existing-config');
            writeFileSync(
              join(home, '.cache/ms-playwright/fixture'),
              'installed-browser',
            );
            const output = join(directory, String(lane));
            const child = spawn(
              process.execPath,
              ['src/siwc/run.mjs', process.execPath, '-e', probe, output],
              {
                env: {
                  ...process.env,
                  ...env,
                  HOME: home,
                  EXPECTED_HOME: home,
                  SIWC_TICKET: ticket,
                  SIWC_TRANSPORT_KEY: key,
                  SIWC_CREDENTIALS: 'must-not-inherit',
                  GH_TOKEN: 'must-not-inherit',
                  MIDSCENE_MODEL_API_KEY: 'must-not-inherit',
                },
                stdio: 'pipe',
              },
            );
            let error = '';
            child.stderr.on('data', (data) => {
              error += data;
            });
            child.once('error', reject);
            child.once('exit', (code) => {
              if (code !== 0) reject(new Error(error));
              else resolve(readFileSync(output, 'utf8'));
            });
          }),
      ),
    );
    assert.equal(new Set(results).size, 4);
    for (const home of results) {
      assert.equal(existsSync(home), true);
      assert.equal(existsSync(join(home, '.midscene/siwc.json')), false);
      assert.equal(
        readFileSync(join(home, '.config/fixture'), 'utf8'),
        'existing-config',
      );
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('an existing credential file or symlink is rejected and preserved', async () => {
  const { spawnSync } = await import('node:child_process');
  const { symlinkSync } = await import('node:fs');
  const directory = mkdtempSync(join(tmpdir(), 'siwc-existing-'));
  try {
    for (const symlink of [false, true]) {
      const home = join(directory, String(symlink));
      mkdirSync(join(home, '.midscene'), { recursive: true });
      const file = join(home, '.midscene/siwc.json');
      const original = 'caller-owned-credentials';
      if (symlink) {
        const target = join(home, 'original');
        writeFileSync(target, original);
        symlinkSync(target, file);
      } else writeFileSync(file, original, { mode: 0o640 });
      const result = spawnSync(
        process.execPath,
        ['src/siwc/run.mjs', process.execPath, '-e', 'process.exit(99)'],
        {
          env: {
            ...process.env,
            ...env,
            HOME: home,
            SIWC_TRANSPORT_KEY: key,
            SIWC_TICKET: seal(
              {
                access_token: 'fixture-access',
                expires_at: Date.now() + 3600000,
              },
              key,
              context,
            ),
          },
          encoding: 'utf8',
        },
      );
      assert.equal(result.status, 1);
      assert.match(result.stderr, /credential file; code=EEXIST/);
      assert.equal(readFileSync(file, 'utf8'), original);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('command failure and spawn failure remove only the owned credential file', async () => {
  const { spawnSync } = await import('node:child_process');
  const directory = mkdtempSync(join(tmpdir(), 'siwc-failure-'));
  try {
    for (const command of [
      [process.execPath, '-e', 'process.exit(7)'],
      ['/missing-siwc-command'],
    ]) {
      const result = spawnSync(
        process.execPath,
        ['src/siwc/run.mjs', ...command],
        {
          env: {
            ...process.env,
            ...env,
            HOME: directory,
            SIWC_TRANSPORT_KEY: key,
            SIWC_TICKET: seal(
              {
                access_token: 'fixture-access',
                expires_at: Date.now() + 3600000,
              },
              key,
              context,
            ),
          },
          encoding: 'utf8',
        },
      );
      assert.equal(result.status, command.length === 1 ? 1 : 7);
      assert.equal(existsSync(join(directory, '.midscene/siwc.json')), false);
      assert.equal(existsSync(directory), true);
      if (command.length === 1)
        assert.match(result.stderr, /test command; code=ENOENT/);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test(
  'SIGTERM stops the shell and its grandchild before credential cleanup',
  { skip: process.platform === 'win32', timeout: 15000 },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), 'siwc-signal-'));
    const pidFile = join(directory, 'grandchild');
    let wrapper;
    let pid;
    try {
      const grandchild = join(directory, 'child.cjs');
      writeFileSync(
        grandchild,
        `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(()=>{}, 1000);`,
      );
      wrapper = spawn(
        process.execPath,
        [
          'src/siwc/run.mjs',
          'bash',
          '-c',
          '"$1" "$2" & wait',
          'fixture',
          process.execPath,
          grandchild,
        ],
        {
          env: {
            ...process.env,
            ...env,
            HOME: directory,
            SIWC_TRANSPORT_KEY: key,
            SIWC_TICKET: seal(
              {
                access_token: 'fixture-access',
                expires_at: Date.now() + 3600000,
              },
              key,
              context,
            ),
          },
          stdio: 'ignore',
        },
      );
      const exited = new Promise((resolve) => wrapper.once('exit', resolve));
      const deadline = Date.now() + 5000;
      while (!existsSync(pidFile) && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 20));
      pid = Number(readFileSync(pidFile, 'utf8'));
      wrapper.kill('SIGTERM');
      assert.equal(await exited, 1);
      assert.equal(existsSync(join(directory, '.midscene/siwc.json')), false);
      // Give the OS time to reap a terminated descendant.
      let alive = true;
      for (let attempt = 0; attempt < 100 && alive; attempt++) {
        try {
          process.kill(pid, 0);
          await new Promise((resolve) => setTimeout(resolve, 20));
        } catch (error) {
          if (error.code !== 'ESRCH') throw error;
          alive = false;
        }
      }
      assert.equal(alive, false);
    } finally {
      if (wrapper?.exitCode === null) wrapper.kill('SIGKILL');
      if (pid) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch (error) {
          assert.equal(error.code, 'ESRCH');
        }
      }
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
