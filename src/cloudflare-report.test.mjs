import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  realpath,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

test('publication resolves the exact native report assets for Pages and Workers', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'midscene-publication-'));
  try {
    const project = path.join(root, 'project');
    const report = path.join(project, 'midscene_run/report/run');
    const results = path.join(project, '.midscene/test-results/run');
    await mkdir(report, { recursive: true });
    await mkdir(results, { recursive: true });
    await writeFile(path.join(report, 'index.html'), 'native-report');
    await writeFile(path.join(report, 'screenshot.jpeg'), 'image');
    await writeFile(
      path.join(results, 'summary.json'),
      JSON.stringify({ report: '../../../midscene_run/report/run/index.html' }),
    );
    const output = path.join(root, 'output');
    await writeFile(output, '');
    execFileSync(
      process.execPath,
      [path.resolve('src/cloudflare-report.mjs')],
      {
        cwd: project,
        env: {
          ...process.env,
          RUNNER_TEMP: root,
          GITHUB_OUTPUT: output,
          CLOUDFLARE_WORKER_NAME: 'fixture-reports',
          MIDSCENE_ARTIFACT_ROOTS: JSON.stringify([
            path.join(project, 'midscene_run'),
            path.join(project, '.midscene'),
          ]),
        },
      },
    );
    const entries = Object.fromEntries(
      (await readFile(output, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => line.split('=')),
    );
    assert.equal(entries.assets, await realpath(report));
    const config = JSON.parse(
      await readFile(path.join(entries.directory, 'wrangler.json'), 'utf8'),
    );
    assert.equal(config.assets.directory, await realpath(report));
    assert.equal(
      await readFile(path.join(entries.assets, 'index.html'), 'utf8'),
      'native-report',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
