// @vitest-environment node
import { expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { DelegationJobService } from '../../src/main/workbench/delegation/DelegationJobService'

it.skipIf(process.env.GUOLING_REAL_CODEX_DELEGATION !== '1')('uses the authorized Luna Fast CLI in a real bounded copy and reads back its artifact', async () => {
  const root = resolve('output/g20/b23/live-delegation')
  const copyRootBase = join(root, 'copies'), copyRoot = join(copyRootBase, 'task-4')
  await fs.mkdir(copyRoot, { recursive: true })
  const outside = join(copyRootBase, 'outside-sentinel.txt')
  await fs.writeFile(outside, 'outside-unchanged', { flag: 'wx' })
  const service = new DelegationJobService({ directory: join(root, 'jobs'), copyRootBase })
  const request = { runId: 'm29-live-parent-1', jobId: 'm29-live-codex-4', taskId: 'm29-live-child-4',
    goal: 'Use the built-in apply_patch tool only to create answer.txt in this approved copy with exactly one line: M29 delegation verified. Do not use exec_command, shell, or another tool. The host will read the artifact back after your turn. Do not create or edit any other file.',
    copyRoot, permission: 'workspace' as const, expectedArtifacts: ['answer.txt'] }
  let snapshot = await service.start(request)
  for (let attempt = 0; attempt < 5 && !snapshot.terminal; attempt++)
    snapshot = await service.wait(request.runId, request.jobId, 30_000)
  const receipt = { status: snapshot.status, configuredModel: snapshot.configuredModel,
    configuredSpeed: snapshot.configuredSpeed, account: snapshot.account ?? 'unconfirmed',
    cliVersion: snapshot.cliVersion ?? 'unconfirmed', billedAmount: snapshot.billedAmount,
    reason: snapshot.reason, artifacts: snapshot.artifacts,
    outsideUnchanged: (await fs.readFile(outside, 'utf8')) === 'outside-unchanged',
    diagnostic: snapshot.status === 'ready' ? undefined : (await service.logs(request.runId, request.jobId)).entries
      .filter(entry => entry.kind === 'system').at(-1)?.message }
  console.log(JSON.stringify(receipt))
  expect(receipt.outsideUnchanged).toBe(true)
  expect(snapshot.status).toBe('ready')
  expect(Buffer.from((await service.readArtifact(request.runId, request.jobId, 'answer.txt')).bytes).toString('utf8').trim())
    .toBe('M29 delegation verified')
}, 150_000)
