import { spawn } from 'node:child_process';
import {
  mkdirSync,
  openSync,
  writeFileSync,
  closeSync,
  unlinkSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { binding, unseal } from './session.mjs';
import { reportFailure } from './diagnostics.mjs';

let ownedFile;
let stage = 'ticket validation';
try {
  const lease = unseal(
    process.env.SIWC_TICKET,
    process.env.SIWC_TRANSPORT_KEY,
    binding(process.env),
  );
  console.log(`::add-mask::${lease.access_token}`);
  stage = 'command configuration';
  const [command, ...args] = process.argv.slice(2);
  if (!command) throw new Error('Missing shard command');
  stage = 'credential file';
  const directory = join(homedir(), '.midscene');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = join(directory, 'siwc.json');
  // Exclusive creation rejects existing files/symlinks and shared-HOME races.
  const fd = openSync(file, 'wx', 0o600);
  ownedFile = file;
  try {
    writeFileSync(fd, JSON.stringify({ credentials: lease }));
  } finally {
    closeSync(fd);
  }
  const env = {
    ...process.env,
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
  stage = 'test command';
  const grouped = process.platform !== 'win32';
  const child = spawn(command, args, {
    env,
    stdio: 'inherit',
    detached: grouped,
  });
  const kill = (signal) => {
    try {
      if (grouped && child.pid) process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  };
  let timer;
  const forward = (signal) => {
    kill(signal);
    timer ??= setTimeout(() => kill('SIGKILL'), 5_000);
  };
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
    if (timer) clearTimeout(timer);
    // A shell may exit before its descendants. Stop those before cleanup too.
    kill('SIGKILL');
    process.removeListener('SIGINT', onInt);
    process.removeListener('SIGTERM', onTerm);
  }
} catch (error) {
  reportFailure('SIWC run', stage, error);
  process.exitCode = 1;
} finally {
  if (ownedFile) {
    try {
      unlinkSync(ownedFile);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        reportFailure('SIWC run', 'credential cleanup', error);
        process.exitCode = 1;
      }
    }
  }
}
