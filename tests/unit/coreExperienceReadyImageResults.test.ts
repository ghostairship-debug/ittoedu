// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ImageResultsDesktopService, type ImageResultsDesktopOptions } from '../../src/main/workbench/images/ImageResultsDesktopService'
import { documentDigest } from '../../src/core/documents/documentDigest'
import type { ImageJobSnapshot } from '../../src/shared/workbench/images'

it('shows an existing ready workspace image from its owning built-in conversation without a document or another generation', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'core-ready-image-'))
  const root = path.join(directory, 'workspace'), bytes = new Uint8Array([10, 20, 30])
  const owner = { workspaceId: 'space', conversationId: 'conversation', runId: 'original-run', jobId: 'ready-job' }
  const job = { version: 1, jobId: owner.jobId, runId: owner.runId,
    documentId: `workspace:${documentDigest({ root })}`, status: 'ready', stopped: false,
    resources: [{ resourceId: 'image-resource', mimeType: 'image/png', width: 10, height: 20, byteLength: bytes.length }],
  } as ImageJobSnapshot
  const generation = vi.fn(() => { throw new Error('Ready image must not regenerate') })
  const options = { directory,
    images: { subscribe: () => () => {}, subscribeSettled: () => () => {}, read: async () => structuredClone(job),
      readResource: async () => ({ bytes, mimeType: 'image/png' }), list: async () => [structuredClone(job)], run: generation },
    documents: { registry: { get() { throw new Error('A workspace result has no course document') } } },
    execution: { conversations: {
      readConversation: async ({ conversationId }: { conversationId: string }) => ({ runIndex: { builtinRunIds: conversationId === 'conversation' ? ['original-run'] : [], externalRunIds: [] } }),
      listWorkspaces: async () => [{ workspaceId: 'space' }],
      listConversations: async () => [{ conversationId: 'conversation', runIndex: { builtinRunIds: ['original-run'], externalRunIds: [] } }],
    }, runs: { read: async () => ({ input: { conversationId: 'conversation', workspaceRoot: root, documents: [] } }) },
    appendExternalEvent: async () => {} },
  } as unknown as ImageResultsDesktopOptions
  const service = new ImageResultsDesktopService(options)
  try {
    expect(await service.list(owner)).toMatchObject([{ source: 'builtin', job: { status: 'ready' } }])
    expect(await service.preview({ ...owner, resourceId: 'image-resource' })).toEqual({ bytes, mimeType: 'image/png', width: 10, height: 20 })
    await expect(service.read({ ...owner, conversationId: 'another' })).rejects.toThrow('不属于')
    job.documentId = `workspace:${documentDigest({ root: path.join(root, 'another') })}`
    await expect(service.read(owner)).rejects.toThrow('不属于')
    expect(generation).not.toHaveBeenCalled()
  } finally {
    await service.flush(); service.dispose()
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected fixture directory')
    await fs.rm(directory, { recursive: true, force: true })
  }
})
