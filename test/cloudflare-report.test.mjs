import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
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
const actionDirectory = fileURLToPath(new URL('../', import.meta.url));
const artifactsScript = path.join(actionDirectory, 'src', 'artifacts.mjs');

async function fixture(t, runDirectory = 'midscene_run') {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'midscene-action-')),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = path.join(root, 'project with spaces');
  const report = path.resolve(
    project,
    runDirectory,
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
  const directory = path.resolve(f.project, resultsRoot, 'test-results', id);
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, 'summary.json'),
    JSON.stringify({ report: path.relative(directory, report) }),
  );
  return directory;
}

function environment(f, overrides = {}) {
  const env = { ...process.env };
  delete env.MIDSCENE_RUN_DIR;
  delete env.MIDSCENE_ARTIFACT_ROOTS;
  return {
    ...env,
    MIDSCENE_ARTIFACT_ROOTS: JSON.stringify([
      path.join(f.project, 'midscene_run'),
      path.join(f.project, '.midscene'),
    ]),
    RUNNER_TEMP: f.runnerTemp,
    GITHUB_OUTPUT: f.output,
    GITHUB_ACTION_PATH: actionDirectory,
    CLOUDFLARE_WORKER_NAME: 'test-reports',
    ...overrides,
  };
}

function publish(f, overrides = {}) {
  return exec(process.execPath, [script], {
    cwd: f.project,
    timeout: 10_000,
    env: environment(f, overrides),
  });
}

async function writeSummary(f, overrides = {}) {
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
      cwd: f.project,
      env: environment(f, {
        GITHUB_STEP_SUMMARY: summary,
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_REPOSITORY: 'test/repo',
        GITHUB_RUN_ID: '123',
        ...overrides,
      }),
    },
  );
  return readFile(summary, 'utf8');
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
    const content = await writeSummary(f);
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
    stderr: /must be an HTML file under the configured run directory's report/,
  });
});

test('rejects symbolic links in report assets', async (t) => {
  const f = await fixture(t);
  await writeResult(f, 'midscene_run');
  await symlink(f.output, path.join(path.dirname(f.report), 'outside-link'));
  await assert.rejects(publish(f), { stderr: /without symbolic links/ });
});

for (const name of ['run.html', 'index.html']) {
  test(`publishes only the selected self-contained ${name} as index.html`, async (t) => {
    const f = await fixture(t);
    const report = path.join(f.project, 'midscene_run', 'report', name);
    const content = '<html>Self-contained report</html>';
    await writeFile(report, content);
    await writeFile(
      path.join(path.dirname(report), 'private.txt'),
      'not part of the report',
    );
    await writeResult(f, 'midscene_run', { report });
    await publish(f);
    const directory = /^directory=(.+)$/m.exec(
      await readFile(f.output, 'utf8'),
    )?.[1];
    const config = JSON.parse(
      await readFile(path.join(directory, 'wrangler.json'), 'utf8'),
    );
    assert.ok(config.assets.directory.startsWith(f.runnerTemp + path.sep));
    assert.deepEqual(await readdir(config.assets.directory), ['index.html']);
    assert.equal(
      await readFile(path.join(config.assets.directory, 'index.html'), 'utf8'),
      content,
    );
    assert.equal(await readFile(report, 'utf8'), content);
  });
}

for (const absolute of [false, true]) {
  test(`uses ${absolute ? 'absolute' : 'relative'} MIDSCENE_RUN_DIR for uploads, Summary and publication`, async (t) => {
    const f = await fixture(t);
    const root = absolute
      ? path.join(f.root, 'outside project')
      : 'custom artifacts';
    f.report = path.resolve(f.project, root, 'report', 'run-a', 'index.html');
    await mkdir(path.dirname(f.report), { recursive: true });
    await writeFile(f.report, '<html>Custom-root report</html>');
    const result = await writeResult(f, root);
    await writeFile(path.join(result, 'result.md'), 'Passed: 1\n');
    await exec(process.execPath, [artifactsScript, 'paths'], {
      cwd: f.project,
      env: environment(f, {
        MIDSCENE_RUN_DIR: root,
      }),
    });
    const output = await readFile(f.output, 'utf8');
    const runDirectory = /^run-directory=(.+)$/m.exec(output)?.[1];
    const roots = /^artifact-roots=(.+)$/m.exec(output)?.[1];
    const paths =
      /artifact-paths<<MIDSCENE_ARTIFACT_PATHS\n([\s\S]*?)\nMIDSCENE_ARTIFACT_PATHS/m.exec(
        output,
      )?.[1];
    assert.equal(runDirectory, path.resolve(f.project, root));
    assert.equal(paths, runDirectory);
    assert.deepEqual(JSON.parse(roots), [runDirectory]);
    const resolved = { MIDSCENE_ARTIFACT_ROOTS: roots };
    assert.match(await writeSummary(f, resolved), /Passed: 1/);
    await publish(f, resolved);
    const directory = /^directory=(.+)$/m.exec(
      await readFile(f.output, 'utf8'),
    )?.[1];
    const config = JSON.parse(
      await readFile(path.join(directory, 'wrangler.json'), 'utf8'),
    );
    assert.equal(
      config.assets.directory,
      await realpath(path.dirname(f.report)),
    );
  });
}

for (const value of ['', './midscene_run']) {
  test(`keeps legacy results when MIDSCENE_RUN_DIR is "${value}"`, async (t) => {
    const f = await fixture(t);
    const result = await writeResult(f, '.midscene');
    await writeFile(path.join(result, 'result.md'), 'Passed: legacy\n');
    await exec(process.execPath, [artifactsScript, 'paths'], {
      cwd: f.project,
      env: environment(f, { MIDSCENE_RUN_DIR: value }),
    });
    const roots = /^artifact-roots=(.+)$/m.exec(
      await readFile(f.output, 'utf8'),
    )?.[1];
    assert.deepEqual(JSON.parse(roots), [
      path.join(f.project, 'midscene_run'),
      path.join(f.project, '.midscene'),
    ]);
    assert.match(
      await writeSummary(f, { MIDSCENE_ARTIFACT_ROOTS: roots }),
      /Passed: legacy/,
    );
    await publish(f, { MIDSCENE_ARTIFACT_ROOTS: roots });
  });
}

test('reports missing results instead of writing an empty success Summary', async (t) => {
  const f = await fixture(t);
  await assert.rejects(writeSummary(f), {
    stderr: /No Midscene Test result\.md found\.[\s\S]*MIDSCENE_RUN_DIR/,
  });
});
