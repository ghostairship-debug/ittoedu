// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'

it('loads the emitted Electron task contracts and local-agent service in a fresh CommonJS process', async () => {
  const root = path.resolve(__dirname, '../..'), outputRoot = path.join(root, 'output')
  await fs.mkdir(outputRoot, { recursive: true })
  const output = await fs.mkdtemp(path.join(outputRoot, 'electron-contract-smoke-'))
  try {
    // Source tests use Vite's import hoisting. Execute the production compiler's
    // output as well, so a late import cannot pass tests and crash Electron.
    execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'),
      '-p', 'tsconfig.electron.json', '--outDir', output], { cwd: root, windowsHide: true, encoding: 'utf8' })
    const result = execFileSync(process.execPath, ['-e', `
      const path = require('node:path'), assert = require('node:assert/strict');
      const contract = require(path.join(process.argv[1], 'shared/localAgentTaskContract.js'));
      assert.ok(contract.aiTaskSchema && contract.localAgentRecordV2Schema && contract.localAgentEventV2Schema);
      assert.equal(contract.aiTaskConfigurationRunSchema.parse({ runId: require('node:crypto').randomUUID(),
        requested: { model: 'gpt-6-astra', effort: 'medium' },
        confirmed: { model: 'gpt-6-astra', resolvedModel: 'gpt-6-astra', effort: 'medium' } }).confirmed.effort, 'medium');
      assert.equal(typeof require(path.join(process.argv[1], 'main/localAgent/harness.js')).LocalAgentHarness, 'function');
      process.stdout.write('electron-contracts-loaded');
    `, output], { cwd: root, windowsHide: true, encoding: 'utf8' })
    expect(result).toBe('electron-contracts-loaded')
  } finally {
    if (path.dirname(path.resolve(output)) !== outputRoot) throw new Error('Unexpected smoke output directory')
    await fs.rm(output, { recursive: true, force: true })
  }
}, 30_000)
