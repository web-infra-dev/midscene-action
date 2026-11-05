// Print fixed labels only, never raw messages, bodies, paths or stacks.
const codes = new Set([
  'SIWC_INSUFFICIENT_VALIDITY',
  'ENOENT',
  'EACCES',
  'EPERM',
  'EEXIST',
  'ENOSPC',
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'MODULE_NOT_FOUND',
  'ERR_PACKAGE_PATH_NOT_EXPORTED',
]);

export function reportFailure(operation, stage, error) {
  let reason = 'UNCLASSIFIED';
  let status;
  for (
    let cause = error, depth = 0;
    cause && depth < 8;
    cause = cause.cause, depth++
  ) {
    if (codes.has(cause.code)) reason = cause.code;
    if (cause.name === 'SyntaxError') reason = 'INVALID_JSON';
    if (cause.name === 'TimeoutError' || cause.name === 'AbortError')
      reason = 'TIMEOUT';
    // Read only the SDK's status header, never its response body.
    if (cause.name === 'SiwcError' && typeof cause.message === 'string') {
      const match = cause.message.match(
        /(?:^|\n)HTTP status: ([1-5]\d{2})(?:\n|$)/,
      );
      if (match) status = match[1];
    }
    if (
      Number.isInteger(cause.status) &&
      cause.status >= 100 &&
      cause.status <= 599
    )
      status = String(cause.status);
  }
  const hint =
    stage === 'SDK SIWC entry'
      ? 'Install a Core build exporting @midscene/core/siwc and refreshSiwcCredentials; Core builds without this public entry are not supported.'
      : stage === 'credential file' && reason === 'EEXIST'
        ? 'An SIWC credential file already exists; use a clean runner HOME. The existing file was not changed.'
        : stage === 'ticket validation'
          ? 'Check repository/run identity and transport key. If validity is insufficient, rerun the entire workflow.'
          : stage === 'environment-secret writeback'
            ? 'Check Environment secret-write access. Do not retry OAuth using a stale record.'
            : 'Check the named stage and its configuration.';
  console.error(
    `${operation} failed during ${stage}; code=${reason}${status ? `; http=${status}` : ''}. ${hint}`,
  );
}
