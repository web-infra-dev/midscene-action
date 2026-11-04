/** @file Resolve the artifact directories shared by execution and publication. */
import { appendFile, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function validatePath(value) {
  if (typeof value !== 'string' || !value.trim() || /[\r\n]/.test(value))
    throw new Error(
      'The Midscene run directory must be a non-empty, single-line path.',
    );
  return value;
}

export function resolveArtifactRoots(projectDirectory, environment) {
  const root = path.resolve(
    projectDirectory,
    validatePath(environment || 'midscene_run'),
  );
  return root === path.resolve(projectDirectory, 'midscene_run')
    ? [root, path.resolve(projectDirectory, '.midscene')]
    : [root];
}

export function artifactRoots() {
  const roots = JSON.parse(process.env.MIDSCENE_ARTIFACT_ROOTS || 'null');
  if (
    !Array.isArray(roots) ||
    !roots.length ||
    roots.some((root) => !path.isAbsolute(validatePath(root)))
  )
    throw new Error('Invalid resolved Midscene artifact directories.');
  return roots;
}

export async function resultFiles(roots, filename) {
  const files = [];
  for (const root of roots) {
    const results = path.join(root, 'test-results');
    const entries = await readdir(results, { withFileTypes: true }).catch(
      (error) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      },
    );
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const file = path.join(results, entry.name, filename);
      try {
        if ((await stat(file)).isFile()) files.push(file);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
  return [...new Set(files)].sort();
}

async function run() {
  const roots =
    process.argv[2] === 'paths'
      ? resolveArtifactRoots(process.cwd(), process.env.MIDSCENE_RUN_DIR)
      : artifactRoots();
  if (process.argv[2] === 'paths') {
    await appendFile(
      process.env.GITHUB_OUTPUT,
      [
        `run-directory=${roots[0]}`,
        `artifact-roots=${JSON.stringify(roots)}`,
        'artifact-paths<<MIDSCENE_ARTIFACT_PATHS',
        ...roots,
        'MIDSCENE_ARTIFACT_PATHS',
        '',
      ].join('\n'),
    );
    return;
  }
  if (process.argv[2] !== 'summary')
    throw new Error('Expected paths or summary.');
  const files = await resultFiles(roots, 'result.md');
  const results = await Promise.all(
    files.map(async (file) =>
      (await readFile(file, 'utf8'))
        .replace(/^## Midscene Test(?:\r?\n|$)/, '')
        .replace(
          /^!\[Midscene Test: .*\]\(https:\/\/badge\.midscenejs\.com\/e2e\?[^\r\n]*(?:\r?\n|$)/gm,
          '',
        )
        .replace(
          /^\[Open the Midscene Test report ↗\]\([^\r\n]*\)\r?\n?/gm,
          '',
        ),
    ),
  );
  const download = `[Download test artifacts](${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}#artifacts)`;
  await appendFile(
    process.env.GITHUB_STEP_SUMMARY,
    [...results, download, ''].join('\n\n'),
  );
  if (!files.length)
    throw new Error(
      'No Midscene Test result.md found. Check the test command and the MIDSCENE_RUN_DIR setting.',
    );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await run();
  } catch (error) {
    const message = error.message
      .replaceAll('%', '%25')
      .replaceAll('\r', '%0D')
      .replaceAll('\n', '%0A');
    process.stderr.write(`::error::${message}\n`);
    process.exitCode = 1;
  }
}
