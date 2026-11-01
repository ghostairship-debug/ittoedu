// @vitest-environment node
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { expect, it, vi } from 'vitest'
import { ExecutionModelImageProjection } from '../../src/main/workbench/execution/ExecutionModelImageProjection'
import type { ModelChatMessage } from '../../src/shared/workbench/modelProvider'

it('shrinks only the model working view with exact derived metadata and a read address for the retained original', async () => {
  const png = await sharp({ create: { width: 3072, height: 1536, channels: 4, background: '#fcfdf8' } })
    .composite([{ input: Buffer.from('<svg width="3072" height="1536"><path d="M0 0L3072 1536M0 1536L3072 0" stroke="#19433d" stroke-width="2"/></svg>') }])
    .png({ compressionLevel: 0 }).toBuffer()
  const originalUrl = `data:image/png;base64,${png.toString('base64')}`
  const capture = { role: 'user', content: [{ type: 'text', text: 'Captured source' },
    { type: 'image_url', image_url: { url: originalUrl } }] } as ModelChatMessage
  const originals: ModelChatMessage[] = [{ role: 'user', content: 'Create an editable result' }, capture]
  const before = JSON.stringify(originals), projection = new ExecutionModelImageProjection()
  const result = await projection.project(originals, { runId: 'fixture-run', originals })
  expect(result[0]).toBe(originals[0])
  expect(result[1]).not.toBe(capture)
  expect(JSON.stringify(originals)).toBe(before)
  const parts = result[1]!.content as Array<{ type: string; text?: string; image_url?: { url: string } }>
  const note = parts.find(part => part.text?.startsWith('模型观察图的表示信息'))!.text!
  const facts = JSON.parse(note.slice(note.indexOf('{')))
  const derivedUrl = parts.find(part => part.type === 'image_url')!.image_url!.url
  const derived = Buffer.from(derivedUrl.slice(derivedUrl.indexOf(',') + 1), 'base64')
  const metadata = await sharp(derived).metadata()
  expect(facts).toMatchObject({ width: metadata.width, height: metadata.height, mimeType: 'image/png', byteLength: derived.byteLength,
    original: { mimeType: 'image/png', width: 3072, height: 1536, byteLength: png.byteLength },
    originalRead: { sourceId: 'run:fixture-run:1', imageIndexes: [0] } })
  expect(facts.resourceId).toBe(`model-image:${createHash('sha256').update(derived).digest('hex')}`)
  expect(metadata.width).toBe(2048); expect(metadata.height).toBe(1024)
  expect(derived.byteLength).toBeLessThan(png.byteLength)
  expect(await projection.project(originals, { runId: 'fixture-run', originals })).toEqual(result)
  // A requested original round uses the captured bytes, not the cached derivative.
  const explicit = { ...capture, content: [{ type: 'image_url', image_url: { url: originalUrl, detail: 'high' } }] } as ModelChatMessage
  expect((await projection.project([explicit], { runId: 'fixture-run', originals }))[0]).toBe(explicit)
  expect((await projection.project([capture], { runId: 'fixture-run', originals, originalMessages: new Set([capture]) }))[0]).toBe(capture)
  expect(JSON.stringify(originals)).toBe(before)
})

it('retains an animated source instead of flattening its frame semantics', async () => {
  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')
  const message = { role: 'user', content: [{ type: 'image_url', image_url: { url: `data:image/gif;base64,${gif.toString('base64')}` } }] } as ModelChatMessage
  expect((await new ExecutionModelImageProjection().project([message], { runId: 'fixture', originals: [message] }))[0]).toBe(message)
})

it('keeps compact originals byte-for-byte when derived metadata would make the request larger', async () => {
  const bytes = await sharp({ create: { width: 32, height: 24, channels: 4, background: '#347d68' } }).png().toBuffer()
  const message = { role: 'user', content: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${bytes.toString('base64')}` } }] } as ModelChatMessage
  const before = JSON.stringify(message)
  const result = await new ExecutionModelImageProjection().project([message], { runId: 'fixture', originals: [message] })
  expect(result[0]).toBe(message)
  expect(JSON.stringify(result[0])).toBe(before)
})

it('compresses a large same-size carrier only when the entire represented request becomes smaller', async () => {
  const bytes = await sharp({ create: { width: 1024, height: 768, channels: 4, background: '#347d68' } })
    .png({ compressionLevel: 0 }).toBuffer()
  const message = { role: 'user', content: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${bytes.toString('base64')}` } }] } as ModelChatMessage
  const before = JSON.stringify(message)
  const result = await new ExecutionModelImageProjection().project([message], { runId: 'fixture', originals: [message] })
  expect(result[0]).not.toBe(message)
  expect(Buffer.byteLength(JSON.stringify(result[0]))).toBeLessThan(Buffer.byteLength(before))
  const parts = result[0]!.content as Array<{ type: string; image_url?: { url: string } }>
  const url = parts.find(part => part.type === 'image_url')!.image_url!.url
  const metadata = await sharp(Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')).metadata()
  expect(metadata).toMatchObject({ width: 1024, height: 768, format: 'png' })
  expect(JSON.stringify(message)).toBe(before)
})

it('retains original bytes after an optimization failure and does not swallow cancellation', async () => {
  const message = { role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } }] } as ModelChatMessage
  const originals = [message], failure = new Error('Fixture decoder unavailable'), onFailure = vi.fn()
  const prepare = vi.fn(async () => { throw failure })
  const projection = new ExecutionModelImageProjection({ prepare, onFailure })
  expect((await projection.project(originals, { runId: 'fixture', originals }))[0]).toBe(message)
  expect((await projection.project(originals, { runId: 'fixture', originals }))[0]).toBe(message)
  expect(onFailure).toHaveBeenCalledExactlyOnceWith(failure)
  expect(prepare).toHaveBeenCalledOnce()
  const controller = new AbortController(), cancelled = new ExecutionModelImageProjection({ prepare: async () => {
    controller.abort(new Error('Fixture stop')); throw new Error('Decoder interrupted')
  }, onFailure })
  await expect(cancelled.project(originals, { runId: 'fixture', originals, signal: controller.signal })).rejects.toThrow('Fixture stop')
  expect(onFailure).toHaveBeenCalledOnce()
})
