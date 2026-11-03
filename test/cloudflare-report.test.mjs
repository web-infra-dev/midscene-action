import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const script = fileURLToPath(
  new URL('../src/cloudflare-report.mjs', import.meta.url),
);
const resultsRoots = ['midscene_run', '.midscene'];

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'midscene-action-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = path.join(root, 'project with spaces');
  const report = path.join(
    project,
    'midscene_run',
    'report',
    'run-a',
    'index.html',
  );
  const runnerTemp = path.join(root, 'runner-temp');
  const output = path.join(root, 'github-output');
  await mkdir(path.dirname(report), { recursive: true });
  await mkdir(runnerTemp);
  await writeFile(report, '<html>Midscene report</html>');
  return { root, project, report, runnerTemp, output };
}

async function writeResult(
  f,
  resultsRoot,
  { id = 'run-a', report = f.report } = {},
) {
  const directory = path.join(f.project, resultsRoot, 'test-results', id);
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, 'summary.json'),
    JSON.stringify({ report: path.relative(directory, report) }),
  );
  return directory;
}

function publish(f) {
  return exec(process.execPath, [script], {
    cwd: f.project,
    timeout: 10_000,
    env: {
      ...process.env,
      RUNNER_TEMP: f.runnerTemp,
      GITHUB_OUTPUT: f.output,
      CLOUDFLARE_WORKER_NAME: 'test-reports',
    },
  });
}

for (const resultsRoot of resultsRoots) {
  test(`prepares a complete report directory from ${resultsRoot}/test-results`, async (t) => {
    const f = await fixture(t);
    await writeResult(f, resultsRoot);
    const data = path.join(path.dirname(f.report), 'data');
    await mkdir(data);
    await writeFile(path.join(data, 'group.json'), '{"steps":[]}');
    await publish(f);
    const output = await readFile(f.output, 'utf8');
    const directory = /^directory=(.+)$/m.exec(output)?.[1];
    assert.ok(directory);
    const config = JSON.parse(
      await readFile(path.join(directory, 'wrangler.json'), 'utf8'),
    );
    assert.equal(config.name, 'test-reports');
    assert.equal(
      config.assets.directory,
      await realpath(path.dirname(f.report)),
    );
    assert.equal(config.assets.not_found_handling, 'none');
    assert.equal(
      await readFile(
        path.join(config.assets.directory, 'data/group.json'),
        'utf8',
      ),
      '{"steps":[]}',
    );
  });

  test(`includes ${resultsRoot}/test-results in the actual Action summary step`, async (t) => {
    const f = await fixture(t);
    const result = await writeResult(f, resultsRoot);
    await writeFile(
      path.join(result, 'result.md'),
      'Passed: 1\n[Open the Midscene Test report ↗](old-url)\n',
    );
    const action = await readFile(
      new URL('../action.yml', import.meta.url),
      'utf8',
    );
    const run =
      / {4}- name: Write test results to Summary[\s\S]*? {6}run: \|\n([\s\S]*?)(?=\n {4}- name:)/.exec(
        action,
      )?.[1];
    assert.ok(run);
    const summary = path.join(f.root, 'github-summary');
    await exec(
      'bash',
      ['-e', '-o', 'pipefail', '-c', run.replace(/^ {8}/gm, '')],
      {
        env: {
          ...process.env,
          TEST_DIRECTORY: f.project,
          GITHUB_STEP_SUMMARY: summary,
          GITHUB_SERVER_URL: 'https://github.com',
          GITHUB_REPOSITORY: 'test/repo',
          GITHUB_RUN_ID: '123',
        },
      },
    );
    const content = await readFile(summary, 'utf8');
    assert.match(content, /Passed: 1/);
    assert.doesNotMatch(content, /old-url/);
    assert.match(
      content,
      /https:\/\/github.com\/test\/repo\/actions\/runs\/123#artifacts/,
    );
  });
}

test('rejects missing results', async (t) => {
  const f = await fixture(t);
  await assert.rejects(publish(f), {
    stderr: /Expected one Midscene test result/,
  });
});

for (const duplicateRoot of resultsRoots) {
  test(`rejects multiple runs when another result is under ${duplicateRoot}`, async (t) => {
    const f = await fixture(t);
    await writeResult(f, 'midscene_run');
    await writeResult(f, duplicateRoot, { id: 'run-b' });
    await assert.rejects(publish(f), {
      stderr: /Expected one Midscene test result/,
    });
  });
}

test('rejects a missing report entry', async (t) => {
  const f = await fixture(t);
  await writeResult(f, 'midscene_run');
  await rm(f.report);
  await assert.rejects(publish(f), {
    stderr: /Midscene HTML report not found/,
  });
});

test('rejects an entry outside the report root', async (t) => {
  const f = await fixture(t);
  const report = path.join(f.project, 'private', 'index.html');
  await mkdir(path.dirname(report));
  await writeFile(report, '<html>Private file</html>');
  await writeResult(f, 'midscene_run', { report });
  await assert.rejects(publish(f), {
    stderr: /must be an index.html file under midscene_run\/report/,
  });
});

test('rejects symbolic links in report assets', async (t) => {
  const f = await fixture(t);
  await writeResult(f, 'midscene_run');
  await symlink(f.output, path.join(path.dirname(f.report), 'outside-link'));
  await assert.rejects(publish(f), { stderr: /without symbolic links/ });
});
