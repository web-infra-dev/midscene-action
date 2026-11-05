import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { binding, prepare } from './session.mjs';
import { reportFailure } from './diagnostics.mjs';

let stage = 'configuration';
try {
  const env = process.env;
  if (
    !env.SIWC_ENVIRONMENT ||
    !/^[a-zA-Z0-9_-]+$/.test(env.SIWC_SECRET_NAME || '') ||
    !env.GH_TOKEN ||
    !env.GITHUB_OUTPUT
  ) {
    throw new Error('Missing SIWC environment or secret-write credentials');
  }
  stage = 'credential JSON';
  const record = JSON.parse(env.SIWC_CREDENTIALS || 'null');
  function mask(credentials) {
    for (const field of ['access_token', 'refresh_token', 'id_token']) {
      const value = credentials?.[field];
      if (typeof value === 'string' && value && !/[\r\n]/.test(value))
        console.log(`::add-mask::${value}`);
    }
  }
  mask(record?.credentials);
  const require = createRequire(
    resolve(env.SIWC_PROJECT_DIRECTORY, 'package.json'),
  );
  stage = 'SDK SIWC entry';
  const { refreshSiwcCredentials } = require('@midscene/core/siwc');
  if (typeof refreshSiwcCredentials !== 'function')
    throw new TypeError('Missing public refreshSiwcCredentials');
  stage = 'access-only handoff';
  const ticket = await prepare(record, {
    key: env.SIWC_TRANSPORT_KEY,
    context: binding(env),
    forceRefresh: env.SIWC_FORCE_REFRESH === 'true',
    refresh: async (credentials) => {
      stage = 'OpenAI refresh';
      const updated = await refreshSiwcCredentials(
        credentials,
        AbortSignal.timeout(30_000),
      );
      mask(updated);
      console.log(
        'OpenAI SIWC refresh succeeded; persisting the replacement before admitting shards',
      );
      return updated;
    },
    persist: async (updated) => {
      stage = 'environment-secret writeback';
      // Retry only GitHub persistence, never replay the OAuth refresh request.
      for (let attempt = 0; ; attempt++) {
        try {
          execFileSync(
            'gh',
            [
              'secret',
              'set',
              env.SIWC_SECRET_NAME,
              '--repo',
              env.GITHUB_REPOSITORY,
              '--env',
              env.SIWC_ENVIRONMENT,
            ],
            {
              input: JSON.stringify(updated),
              stdio: ['pipe', 'ignore', 'pipe'],
              timeout: 20_000,
            },
          );
          stage = 'access-only handoff';
          console.log(
            'SIWC replacement persisted to the owner environment secret',
          );
          return;
        } catch (error) {
          if (attempt === 2) throw error;
          await new Promise((resolve) =>
            setTimeout(resolve, 1000 * (attempt + 1)),
          );
        }
      }
    },
  });
  appendFileSync(env.GITHUB_OUTPUT, `ticket=${ticket}\n`);
  console.log(
    'SIWC access-only handoff ready; renewable credentials remain in the owner environment',
  );
} catch (error) {
  reportFailure('SIWC preparation', stage, error);
  process.exitCode = 1;
}
