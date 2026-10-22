// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { ImageFileEditSession, editImageFile } from '../../src/main/workbench/mediaFiles/imageFileEditing'
import { MediaFilesService } from '../../src/main/workbench/mediaFiles/MediaFilesService'
import { MediaFileDraft } from '../../src/renderer/documentFiles/media/mediaFileDraft'
import type { MediaFileSnapshot } from '../../src/shared/workbench/mediaFiles'
import type { MediaFileOperation } from '../../src/shared/workbench/mediaFiles'

const measured = vi.hoisted(() => ({ pipelines: 0 }))
vi.mock('../../src/main/workbench/imageDecoder', async () => {
  const decoder = (await import('sharp')).default
  return { getImageDecoder: () => (...args: unknown[]) => { measured.pipelines++; return Reflect.apply(decoder, undefined, args) } }
})

async function source() {
  return sharp({ create: { width: 12, height: 8, channels: 4, background: '#c03060ff' } }).png().toBuffer()
}
const rotate: MediaFileOperation = { type: 'image.rotate', degrees: 90 }
const crop: MediaFileOperation = { type: 'image.crop', rectangle: { x: 0, y: 0, width: 0.5, height: 1 } }
async function pixels(bytes: Uint8Array) { return sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true }) }

describe('live image draft lossless-prefix reuse', () => {
  it('retains the relocated binding when an earlier preview completes without replaying its gesture', async () => {
    const binding = { path: 'D:/old/image.png', fileVersion: 'same-file', bindingVersion: 1 }
    const moved = { ...binding, path: 'D:/new/image.png', bindingVersion: 2 }
    const snapshot: MediaFileSnapshot = { binding, content: { kind: 'image', mimeType: 'image/png', bytes: new Uint8Array([1]),
      width: 12, height: 8, editable: true } }
    let complete!: (value: MediaFileSnapshot) => void
    const preview = vi.fn(() => new Promise<MediaFileSnapshot>(resolve => { complete = resolve }))
    const release = vi.fn()
    const draft = new MediaFileDraft(snapshot, { preview, release, save: async () => snapshot, reload: async () => snapshot })
    const pending = draft.apply(rotate)
    draft.rebind(moved)
    complete({ ...snapshot, content: { ...snapshot.content, bytes: new Uint8Array([2]) } })
    await pending
    expect(draft.read().preview.binding).toEqual(moved)
    expect(draft.read().base.binding).toEqual(moved)
    expect(draft.read().operations).toEqual([rotate])
    expect(draft.read().busy).toBeNull()
    expect(preview).toHaveBeenCalledTimes(1)
    expect(release).toHaveBeenCalledWith(binding)
    draft.dispose()
  })
  it('processes only an appended suffix and keeps the same pixels as the original full operation sequence', async () => {
    const bytes = await source(), editor = new ImageFileEditSession(bytes)
    await editor.prepare([rotate])
    const before = measured.pipelines
    const appended = await editor.prepare([rotate, crop])
    const incrementalWork = measured.pipelines - before
    const fullBefore = measured.pipelines
    const full = await editImageFile(bytes, [rotate, crop])
    const fullWork = measured.pipelines - fullBefore
    expect(incrementalWork).toBeLessThan(fullWork)
    expect(await pixels(appended.bytes)).toEqual(await pixels(full.bytes))
    const repeatedBefore = measured.pipelines
    await expect(editor.prepare([rotate, crop])).resolves.toBe(appended)
    expect(measured.pipelines).toBe(repeatedBefore)
    // Undo selects the original-prefix result, never an already lossy JPEG/WebP derivative.
    const undone = await editor.prepare([rotate])
    expect(await pixels(undone.bytes)).toEqual(await pixels((await editImageFile(bytes, [rotate])).bytes))
    editor.dispose()
    await expect(editor.prepare([rotate])).rejects.toThrow('图片编辑已结束')
  })

  it('still checks the file owner on every preview and releases derived work when the draft closes', async () => {
    const bytes = await source(), binding = { path: 'D:/image.png', fileVersion: 'version', bindingVersion: 1 }
    const read = vi.fn(async () => bytes)
    const service = new MediaFilesService({ read, replace: async () => binding })
    await service.preview(binding, [rotate])
    const cachedBefore = measured.pipelines
    await service.preview(binding, [rotate])
    expect(measured.pipelines).toBe(cachedBefore)
    expect(read).toHaveBeenCalledTimes(2)
    service.release(binding)
    await service.preview(binding, [rotate])
    expect(measured.pipelines).toBeGreaterThan(cachedBefore)
    expect(read).toHaveBeenCalledTimes(3)
    service.release(binding)
  })
})
