import assert from 'node:assert/strict';
import { defineNode, z } from '@midscene/test';
import { defineTestProject } from '@midscene/test/config';

const expectSum = defineNode({
  name: 'expectSum',
  description: 'Check the sum of two numbers.',
  inputSchema: z.object({
    left: z.number(),
    right: z.number(),
    expected: z.number(),
  }),
  async execute({ input }) {
    assert.equal(input.left + input.right, input.expected);
  },
});

export default defineTestProject({
  output: { reportFormat: 'html-and-external-assets' },
  nodes: [expectSum],
});
