/** @file Prepare a Midscene report for Cloudflare Workers Preview. */
import {
  appendFile,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { artifactRoots, resultFiles } from './artifacts.mjs';

const SUMMARY_FILENAME = 'summary.json';
const REPORT_ENTRY_FILENAME = 'index.html';
const WRANGLER_CONFIG_FILENAME = 'wrangler.json';
const COMPATIBILITY_DATE = '2026-10-14';

/**
 * Find and validate the selected HTML report and any owned asset directory.
 * @param {string} projectDirectory - Midscene test project directory.
 * @returns {Promise<{report: string, directory?: string}>} Report entry and optional asset directory.
 */
async function resolveReportDirectory(projectDirectory) {
  const roots = artifactRoots(projectDirectory);
  const summaries = await resultFiles(roots, SUMMARY_FILENAME);
  if (summaries.length !== 1) {
    throw new Error(
      'Expected one Midscene test result. Run midscene-test in working-directory with a clean output directory before publishing.',
    );
  }

  let report;
  const reportRoots = [];
  try {
    const summary = JSON.parse(await readFile(summaries[0], 'utf8'));
    if (typeof summary.report !== 'string' || !summary.report)
      throw new Error('Missing report');
    report = await realpath(
      path.resolve(path.dirname(summaries[0]), summary.report),
    );
    for (const root of roots) {
      try {
        const reportRoot = await realpath(path.join(root, 'report'));
        if ((await stat(reportRoot)).isDirectory())
          reportRoots.push(reportRoot);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  } catch {
    throw new Error(
      'Midscene HTML report not found. Run midscene-test in working-directory before publishing.',
    );
  }
  const reportRoot = reportRoots.find((root) => {
    const relative = path.relative(root, report);
    return !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  });
  if (
    !reportRoot ||
    path.extname(report).toLowerCase() !== '.html' ||
    !(await stat(report)).isFile()
  ) {
    throw new Error(
      "Midscene HTML report must be an HTML file under the configured run directory's report/.",
    );
  }
  const directory = path.dirname(report);
  // Single HTML reports share report/ with unrelated runs. Publish only the
  // selected file; nested index.html reports own their complete asset directory.
  if (
    path.basename(report) !== REPORT_ENTRY_FILENAME ||
    directory === reportRoot
  )
    return { report };
  const assets = await readdir(directory, {
    recursive: true,
    withFileTypes: true,
  });
  if (assets.some((entry) => !entry.isFile() && !entry.isDirectory())) {
    throw new Error(
      'The published report must contain only regular files and directories, without symbolic links.',
    );
  }
  return { report, directory };
}

/** Write Wrangler configuration and expose its directory to the Action. */
async function prepare() {
  const source = await resolveReportDirectory(process.cwd());
  const directory = await mkdtemp(
    path.join(process.env.RUNNER_TEMP, 'midscene-report.'),
  );
  let assets = source.directory;
  if (!assets) {
    assets = path.join(directory, 'assets');
    await mkdir(assets);
    await copyFile(source.report, path.join(assets, REPORT_ENTRY_FILENAME));
  }
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
