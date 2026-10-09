// @vitest-environment node
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { afterEach, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { continueDocumentTargets } from '../../src/main/workbench/execution/continuationTargets'
import { createCurrentSelectionFixture } from '../helpers/g20CurrentSelectionFixture'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { createTextComponentData } from '../../src/components/text'
import type { JsonValue } from '../../src/shared/contracts/component-platform/project'
import type { ExecutionDocumentReference } from '../../src/shared/workbench/executionDesktop'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }) })
it('continues current Flow ranges through own ACK and disjoint edits, retaining durable provenance while requiring a fresh grant after restart', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-flow-resume-')); roots.push(root)
  const source = createCurrentSelectionFixture().model
  const file = path.join(root, 'flow.glx'); await fs.writeFile(file, new CourseV10Driver().serialize(source))
  const host = new DocumentHostService(path.join(root, 'journal')), opened = await host.open(file)
  const target = { kind: 'course-instance' as const, surfaceId: 'flow', instanceId: 'flow-paragraph', stateId: null, dataPath: ['content'], from: 2, to: 4 }
  const reference: ExecutionDocumentReference = { documentId: opened.documentId, epoch: opened.epoch, revision: opened.revision, writable: [target], selection: [target] }
  await host.tools.beginRun({ runId: 'own-run', actor: 'agent', documents: [{ documentId: opened.documentId, writable: [target] }] })
  const handle = await host.tools.issueTarget('own-run', opened.documentId, target)
  expect(await host.tools.execute('own-run', 'rewrite', { name: 'text.replace', input: { target: handle, content: '两段更长文字' } }))
    .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const session = host.registry.get(opened.documentId)
  const mapped = await continueDocumentTargets(session, reference, new Set(['own-run']))
  expect(mapped.writable).toEqual([{ ...target, to: 8 }])
  const current = await session.drain()
  if (current.model.kind !== 'course-v10') throw new Error('Expected current course')
  const content = (value: string) => JSON.parse(JSON.stringify(createTextComponentData(value))) as JsonValue
  expect(await session.execute({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision, operationId: randomUUID(), actor: 'human',
    mutation: { type: 'command', command: captureComponentOperation(current.model.project, [{ type: 'data.set', instanceId: target.instanceId, path: [],
      value: content('人工前缀这是两段更长文字可编辑正文。') }]) } })).toMatchObject({ status: 'applied' })
  expect((await continueDocumentTargets(session, reference, new Set(['own-run']))).writable).toEqual([{ ...target, from: 6, to: 12 }])
  const next = await session.drain()
  if (next.model.kind !== 'course-v10') throw new Error('Expected current course')
  expect(await session.execute({ documentId: next.documentId, epoch: next.epoch, baseRevision: next.revision, operationId: randomUUID(), actor: 'human',
    mutation: { type: 'command', command: captureComponentOperation(next.model.project, [{ type: 'data.set', instanceId: target.instanceId, path: [],
      value: content('人工前缀这是完全不同的文字可编辑正文。') }]) } })).toMatchObject({ status: 'applied' })
  const beforeConflict = session.read()
  await expect(continueDocumentTargets(session, reference, new Set(['own-run']))).rejects.toThrow()
  expect(session.read()).toEqual(beforeConflict)
  const restarted = new DocumentHostService(path.join(root, 'journal'))
  await restarted.internalAPI.restore(opened.documentId)
  const recovered = restarted.registry.get(opened.documentId), cold = recovered.read()
  expect(cold.epoch).not.toBe(reference.epoch)
  expect(cold.model).toEqual(beforeConflict.model)
  const provenance = recovered.committedChangesSince(reference.revision)
  expect(provenance[0]).toMatchObject({ actor: 'agent', runId: 'own-run', before: { kind: 'course-v10' }, after: { kind: 'course-v10' } })
  await expect(continueDocumentTargets(recovered, reference, new Set(['own-run']))).rejects.toThrow('原文档会话已改变')
  expect(recovered.read()).toEqual(cold)
  const freshTarget = { kind: 'course-instance' as const, surfaceId: 'flow', instanceId: 'flow-paragraph', stateId: null, dataPath: ['content'] }
  await restarted.tools.beginRun({ runId: 'fresh', actor: 'agent', documents: [{ documentId: cold.documentId, writable: [freshTarget] }] })
  const freshHandle = await restarted.tools.issueTarget('fresh', cold.documentId, freshTarget)
  expect(await restarted.tools.execute('fresh', 'new-observation', { name: 'text.replace', input: { target: freshHandle, content: '明确新授权' } }))
    .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(recovered.read().undoDepth).toBe(cold.undoDepth + 1)
})
