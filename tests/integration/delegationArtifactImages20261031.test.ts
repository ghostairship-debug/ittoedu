// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, expect, it, vi } from 'vitest'
import { HostToolCoordinator, type HostToolServices } from '../../src/core/tools/HostToolServices'
import { delegationArtifactSource } from '../../src/core/tools/HostArtifactTools'
import type { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { DelegationJobService } from '../../src/main/workbench/delegation/DelegationJobService'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }) })

it('previews sealed delegate pixels through their owner, preserves original bytes and rejects an unrelated reader', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'delegate-image-owner-')); roots.push(root)
  const copyRootBase = path.join(root, 'copies'), copyRoot = path.join(copyRootBase, 'candidate')
  await fs.mkdir(copyRoot, { recursive: true })
  const png = await sharp({ create: { width: 64, height: 48, channels: 4, background: '#195d6a' } }).png().toBuffer()
  const name = 'assets/scene one.png', job = 'delegate-sealed-image'
  const owner = new DelegationJobService({ directory: path.join(root, 'jobs'), copyRootBase, runner: { run: async input => {
    await fs.mkdir(path.join(input.copyRoot, 'assets'))
    await fs.writeFile(path.join(input.copyRoot, name), png)
    await fs.writeFile(path.join(input.copyRoot, 'notes.txt'), 'An artifact, but not an image')
    return { taskId: input.taskId, status: 'verified', configuredModel: 'gpt-6-luna', configuredSpeed: 'priority',
      artifacts: [{ path: name, bytes: png.byteLength }, { path: 'notes.txt', bytes: 29 }],
      reason: 'In-process fixture; no model request', externalChangesPossible: false }
  } } })
  await owner.start({ runId: 'producer', jobId: job, taskId: 'task', goal: 'Create a sealed image', copyRoot,
    permission: 'workspace', expectedArtifacts: [name, 'notes.txt'] })
  expect(await owner.wait('producer', job, 5000)).toMatchObject({ status: 'ready' })
  const galleryPreview = vi.fn(async () => ({}))
  const status: NonNullable<HostToolServices['jobs']>['status'] = async ref => {
    const snapshot = await owner.status(ref.runId, ref.jobId)
    return { kind: 'delegation', jobId: ref.jobId, status: snapshot.status, terminal: snapshot.terminal, snapshot }
  }
  const host = new HostToolCoordinator({
    jobs: { status, wait: status, logs: async () => ({}), cancel: status },
    delegation: { availability: () => ({ ready: false, reason: 'No external model in test' }),
      startManaged: input => owner.startManaged(input), readArtifact: (...args) => owner.readArtifact(...args),
      cancel: (...args) => owner.cancel(...args), cancelRun: runId => owner.cancelRun(runId) },
    openImages: { search: async () => ({}), preview: galleryPreview,
      readPreview: () => { throw new Error('Must not route delegate references to the gallery') },
      fetch: async () => ({ status: 'failed', reason: 'Not invoked' }) },
  }, {} as DocumentRegistry, {} as never)
  for (const runId of ['producer', 'continued', 'stranger']) await host.beginRun({ runId, actor: 'agent', documents: [],
    fileAccess: { permission: 'workspace', workspaceRoot: root } })
  host.authorizeContinuationReads('continued', ['producer'])
  const source = delegationArtifactSource(job, name)
  expect(host.isImageSource(source)).toBe(true)
  const preview = await host.imagePreview('producer', { images: [source] })
  expect(preview).toMatchObject({ kind: 'read', data: { status: 'prepared', previews: [
    { resourceId: source, mimeType: 'image/png', byteLength: png.byteLength },
  ] } })
  const prepared = await host.prepareResultImages('producer', preview)
  expect(prepared[0]).toMatchObject({ source, mimeType: 'image/png' })
  expect(Buffer.from(prepared[0]!.bytes)).toEqual(png)
  const originalPreview = await host.imagePreview('producer', { images: [source], representation: 'original' })
  expect(originalPreview).toMatchObject({ images: [{ detail: 'high', resourceId: source }] })
  expect(Buffer.from((await host.prepareResultImages('producer', originalPreview))[0]!.bytes)).toEqual(png)
  expect(Buffer.from((await host.readImageReference('continued', source))!.bytes)).toEqual(png)
  const unavailable = await host.imagePreview('stranger', { images: [source] })
  expect(unavailable).toMatchObject({ kind: 'read', data: { status: 'failed', failures: [{ image: source }] } })
  await expect(host.readImageReference('stranger', source)).rejects.toThrow('当前运行')
  await expect(host.readImageReference('producer', delegationArtifactSource(job, 'notes.txt'))).rejects.toThrow('不是图片')
  expect(galleryPreview).not.toHaveBeenCalled()
  // Ordinary polling carries state and artifact references; the original diagnostic remains retrievable.
  const poll = await host.jobStatus('producer', { kind: 'delegation', jobId: job })
  expect(poll).toMatchObject({ kind: 'read', data: { status: 'ready' } })
  if (poll.kind !== 'read') throw new Error('Expected a read receipt')
  expect(poll.data).not.toHaveProperty('goal')
  expect(await host.jobStatus('producer', { kind: 'delegation', jobId: job, detail: 'diagnostic' }))
    .toMatchObject({ kind: 'read', data: { snapshot: { goal: 'Create a sealed image' }, detail: 'diagnostic' } })
})
