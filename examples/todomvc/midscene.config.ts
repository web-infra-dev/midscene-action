import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { defineProjectSetup, defineTestProject } from '@midscene/test/config';
import { createMidsceneNodes } from '@midscene/test/midscene';
import { PlaywrightAgent } from '@midscene/web/playwright/agent';
import { chromium, type Page } from 'playwright';
import { createTodoNodes } from './nodes/todo.js';

const envFile = new URL('./.env', import.meta.url);
if (existsSync(envFile)) loadEnvFile(envFile);

interface Context {
  page: Page;
  agent: PlaywrightAgent;
}

const setup = defineProjectSetup<Context>({
  name: 'web',
  async setup({ onTeardown }) {
    const browser = await chromium.launch({
      headless: process.env.HEADLESS !== 'false',
    });
    onTeardown(() => browser.close());
    const page = await browser.newPage();
    await page.goto('https://todomvc.com/examples/react/dist/');
    const agent = new PlaywrightAgent(page);
    // Teardowns run in reverse order: destroy the Agent before the browser.
    onTeardown(() => agent.destroy());
    return { page, agent };
  },
});

export default defineTestProject<Context>({
  projects: [
    {
      name: 'deterministic',
      setup,
      files: { include: ['cases/todo.yaml'] },
      tags: { include: ['deterministic'] },
    },
    {
      name: 'ai',
      setup,
      files: { include: ['cases/todo.yaml'] },
      tags: { include: ['ai'] },
    },
  ],
  nodes: [
    ...createMidsceneNodes<Context>({
      agentClass: PlaywrightAgent,
      getAgent: ({ context }) => context.agent,
    }),
    ...createTodoNodes<Context>(),
  ],
  test: { testTimeout: 240_000 },
});
