import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { binding, unseal } from './session.mjs';

let home;
try {
  const lease = unseal(
    process.env.SIWC_TICKET,
    process.env.SIWC_TRANSPORT_KEY,
    binding(process.env),
  );
  console.log(`::add-mask::${lease.access_token}`);
  const [command, ...args] = process.argv.slice(2);
  if (!command) throw new Error('Missing shard command');
  home = mkdtempSync(join(tmpdir(), 'midscene-siwc-shard-'));
  mkdirSync(join(home, '.midscene'), { mode: 0o700 });
  writeFileSync(
    join(home, '.midscene/siwc.json'),
    JSON.stringify({ credentials: lease }),
    { mode: 0o600 },
  );
  const env = {
    ...process.env,
    HOME: home,
    MIDSCENE_MODEL_AUTH_MODE: 'siwc',
    MIDSCENE_SIWC_ACCESS_TOKEN: lease.access_token,
    MIDSCENE_SIWC_EXPIRES_AT: String(lease.expires_at),
  };
  for (const key of [
    'SIWC_TICKET',
    'SIWC_TRANSPORT_KEY',
    'SIWC_CREDENTIALS',
    'SIWC_SECRET_WRITE_TOKEN',
    'GH_TOKEN',
    'MIDSCENE_MODEL_API_KEY',
  ])
    delete env[key];
  const child = spawn(command, args, { env, stdio: 'inherit' });
  const forward = (signal) => child.kill(signal);
  const onInt = () => forward('SIGINT');
  const onTerm = () => forward('SIGTERM');
  process.on('SIGINT', onInt);
  process.on('SIGTERM', onTerm);
  try {
    process.exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => resolve(code ?? 1));
    });
  } finally {
    process.removeListener('SIGINT', onInt);
    process.removeListener('SIGTERM', onTerm);
  }
} catch {
  console.error(
    'SIWC shard setup failed; access-only session missing, expired or invalid for this run',
  );
  process.exitCode = 1;
} finally {
  if (home) rmSync(home, { recursive: true, force: true });
}
