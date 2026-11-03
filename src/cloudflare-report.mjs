/** @file Prepare a Midscene report for Cloudflare Workers Preview. */
import {
  appendFile,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

const RESULTS_DIRECTORIES = [
  path.join('midscene_run', 'test-results'),
  path.join('.midscene', 'test-results'),
];
const REPORT_DIRECTORY = path.join('midscene_run', 'report');
const SUMMARY_FILENAME = 'summary.json';
const REPORT_ENTRY_FILENAME = 'index.html';
const WRANGLER_CONFIG_FILENAME = 'wrangler.json';
const COMPATIBILITY_DATE = '2026-10-14';

/**
 * Find and validate the  HTML report directory.
 * @param {string} projectDirectory - Midscene test project directory.
 * @returns {Promise<string>} Absolute report directory.
 */
async function resolveReportDirectory(projectDirectory) {
  const summaries = [];
  for (const resultsDirectory of RESULTS_DIRECTORIES) {
    const results = path.join(projectDirectory, resultsDirectory);
    const entries = await readdir(results, { withFileTypes: true }).catch(
      (error) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      },
    );
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const file = path.join(results, entry.name, SUMMARY_FILENAME);
      try {
        if ((await stat(file)).isFile()) summaries.push(file);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
  if (summaries.length !== 1) {
    throw new Error(
      'Expected one Midscene test result. Run midscene-test in working-directory with a clean output directory before publishing.',
    );
  }

  let report;
  let reportRoot;
  try {
    const summary = JSON.parse(await readFile(summaries[0], 'utf8'));
    if (typeof summary.report !== 'string' || !summary.report)
      throw new Error('Missing report');
    report = await realpath(
      path.resolve(path.dirname(summaries[0]), summary.report),
    );
    reportRoot = await realpath(path.join(projectDirectory, REPORT_DIRECTORY));
  } catch {
    throw new Error(
      'Midscene HTML report not found. Run midscene-test in working-directory before publishing.',
    );
  }
  const relative = path.relative(reportRoot, report);
  if (
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative) ||
    path.basename(report) !== REPORT_ENTRY_FILENAME ||
    !(await stat(report)).isFile()
  ) {
    throw new Error(
      'Midscene HTML report must be an index.html file under midscene_run/report.',
    );
  }
  const directory = path.dirname(report);
  const assets = await readdir(directory, {
    recursive: true,
    withFileTypes: true,
  });
  if (assets.some((entry) => !entry.isFile() && !entry.isDirectory())) {
    throw new Error(
      'The published report must contain only regular files and directories, without symbolic links.',
    );
  }
  return directory;
}

/** Write Wrangler configuration and expose its directory to the Action. */
async function prepare() {
  const assets = await resolveReportDirectory(process.cwd());
  const directory = await mkdtemp(
    path.join(process.env.RUNNER_TEMP, 'midscene-report.'),
  );
  await writeFile(
    path.join(directory, WRANGLER_CONFIG_FILENAME),
    JSON.stringify({
      name: process.env.CLOUDFLARE_WORKER_NAME,
      compatibility_date: COMPATIBILITY_DATE,
      preview_urls: true,
      assets: { directory: assets, not_found_handling: 'none' },
      previews: {},
    }),
  );
  await appendFile(process.env.GITHUB_OUTPUT, `directory=${directory}\n`);
}

try {
  await prepare();
} catch (error) {
  const message = error.message
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A');
  process.stderr.write(`::error::${message}\n`);
  process.exitCode = 1;
}
