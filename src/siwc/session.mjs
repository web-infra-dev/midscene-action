import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const PREPARE_VALIDITY_MS = 30 * 60_000;
export const SHARD_VALIDITY_MS = 22 * 60_000;

export function binding(env) {
  const values = [
    env.GITHUB_REPOSITORY,
    env.GITHUB_RUN_ID,
    env.GITHUB_RUN_ATTEMPT,
  ];
  if (values.some((value) => typeof value !== 'string' || !value))
    throw new Error('Missing CI run identity');
  return JSON.stringify(values);
}

function keyBytes(key) {
  if (!/^[0-9a-f]{64}$/i.test(key || ''))
    throw new Error(
      'SIWC_TRANSPORT_KEY must be 32 random bytes encoded as hex',
    );
  return Buffer.from(key, 'hex');
}

export function accessLease(
  credentials,
  now = Date.now(),
  minimumMs = SHARD_VALIDITY_MS,
) {
  if (
    typeof credentials?.access_token !== 'string' ||
    !credentials.access_token.trim() ||
    !Number.isSafeInteger(credentials.expires_at) ||
    credentials.expires_at - now < minimumMs
  ) {
    throw new Error(
      'SIWC access token has insufficient lifetime for this shard; no shard may refresh it',
    );
  }
  // Deliberate allowlist: never distribute identity, refresh token, or client registration.
  return {
    access_token: credentials.access_token,
    expires_at: credentials.expires_at,
  };
}

export function seal(lease, key, context) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBytes(key), iv);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(lease)),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString(
    'base64url',
  );
}

export function unseal(ticket, key, context, now = Date.now()) {
  try {
    if (
      typeof ticket !== 'string' ||
      ticket.length > 32_000 ||
      !/^[\w-]+$/.test(ticket)
    )
      throw new Error();
    const bytes = Buffer.from(ticket, 'base64url');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      keyBytes(key),
      bytes.subarray(0, 12),
    );
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const lease = JSON.parse(
      Buffer.concat([
        decipher.update(bytes.subarray(28)),
        decipher.final(),
      ]).toString(),
    );
    if (Object.keys(lease).sort().join(',') !== 'access_token,expires_at')
      throw new Error();
    return accessLease(lease, now);
  } catch {
    throw new Error('Invalid or expired SIWC shard ticket for this CI run');
  }
}

/** Caller must hold the workflow's exclusive environment/concurrency slot. */
export async function prepare(
  record,
  { refresh, persist, key, context, now = Date.now, forceRefresh = false },
) {
  // Validate handoff configuration BEFORE any token rotation.
  keyBytes(key);
  if (!record?.credentials || !context)
    throw new Error('Invalid Midscene SIWC credential record');
  let saved = record;
  if (
    forceRefresh ||
    !Number.isSafeInteger(saved.credentials.expires_at) ||
    saved.credentials.expires_at - now() < PREPARE_VALIDITY_MS
  ) {
    const credentials = await refresh(saved.credentials);
    saved = {
      ...saved,
      updated_at: new Date(now()).toISOString(),
      credentials,
    };
    // Persist BEFORE publishing even if subsequent validation or handoff fails.
    // A persistence failure must never release consumers or retry the refresh.
    await persist(saved);
  }
  return seal(
    accessLease(saved.credentials, now(), PREPARE_VALIDITY_MS),
    key,
    context,
  );
}
