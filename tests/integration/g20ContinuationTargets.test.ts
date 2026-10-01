// @vitest-environment node
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { afterEach, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { continueDocumentTargets } from '../../src/main/workbench/execution/continuationTargets'
import { listCourseProjectV9Fixtures } from '../fixtures/course-project-v9/sources'
import { createCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { findFlowBlockRecursive } from '../../src/core/tools/flowDocumentModel'
import type { ExecutionDocumentReference } from '../../src/shared/workbench/executionDesktop'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }) })
it('replays actual Flow splice provenance after restart, preserving unrelated paragraph changes and rejecting overlapping human changes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-flow-resume-')); roots.push(root)
  const source = listCourseProjectV9Fixtures().find(value => value.id === 'flow')!.data
  const file = path.join(root, 'flow.h5lesson'); await fs.writeFile(file, createCourseProjectArchive(source))
  const host = new DocumentHostService(path.join(root, 'journal')), opened = await host.open(file)
  const target = { kind: 'flow-range' as const, surfaceId: 'surface-flow', blockId: 'flow-paragraph', parentId: null,
    slot: { kind: 'field' as const, field: 'content' as const }, from: 2, to: 4 }
  const reference: ExecutionDocumentReference = { documentId: opened.documentId, epoch: opened.epoch, revision: opened.revision, writable: [target], selection: [target] }
  await host.tools.beginRun({ runId: 'own-run', actor: 'agent', documents: [{ documentId: opened.documentId, writable: [target] }] })
  const handle = await host.tools.issueTarget('own-run', opened.documentId, target)
  expect(await host.tools.execute('own-run', 'rewrite', { name: 'text.replace', input: { target: handle, content: '两段更长文字' } }))
    .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const restarted = new DocumentHostService(path.join(root, 'journal'))
  await restarted.internalAPI.restore(opened.documentId)
  const session = restarted.registry.get(opened.documentId)
  const mapped = await continueDocumentTargets(session, reference, new Set(['own-run']))
  expect(mapped.writable).toEqual([{ ...target, to: 8 }])
  const current = await session.drain()
  if (current.model.kind !== 'course-v9') throw new Error('course')
  const project = structuredClone(current.model.project), flow = project.surfaces.find(surface => surface.id === target.surfaceId)!
  if (flow.type !== 'flow') throw new Error('flow')
  const block = findFlowBlockRecursive(flow.blocks, target.blockId)!.block
  if (block.type !== 'paragraph') throw new Error('paragraph')
  block.content = { inlines: [{ type: 'text', text: '人工前缀这是两段更长文字可编辑正文。' }] }
  await session.execute({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision, operationId: randomUUID(), actor: 'human',
    mutation: { type: 'command', command: { type: 'course.replace', project } } })
  expect((await continueDocumentTargets(session, reference, new Set(['own-run']))).writable).toEqual([{ ...target, from: 6, to: 12 }])
  const next = await session.drain()
  project.revision = next.revision
  block.content = { inlines: [{ type: 'text', text: '人工前缀这是完全不同的文字可编辑正文。' }] }
  await session.execute({ documentId: next.documentId, epoch: next.epoch, baseRevision: next.revision, operationId: randomUUID(), actor: 'human',
    mutation: { type: 'command', command: { type: 'course.replace', project } } })
  await expect(continueDocumentTargets(session, reference, new Set(['own-run']))).rejects.toThrow()
})
