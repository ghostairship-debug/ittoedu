// @vitest-environment node
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { expect, it } from 'vitest'
import { AttachmentService } from '../../src/main/workbench/attachments/AttachmentService'

it('returns only a bounded thumbnail while retaining the exact original and its model representation', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'guoling-thumbnail-'))
  try {
    const original = await sharp({ create: { width: 512, height: 256, channels: 4, background: '#c0306080' } }).png().toBuffer()
    const service = new AttachmentService({ directory })
    const snapshot = await service.receiveBytes({ name: 'original.png', bytes: original, source: { kind: 'file' } })
    const thumbnail = await service.readThumbnail(snapshot.id, 'original-image')
    const meta = await sharp(thumbnail.bytes).metadata()
    expect([meta.width, meta.height, thumbnail.mediaType]).toEqual([128, 64, 'image/png'])
    const current = await service.readSnapshot(snapshot.id)
    expect(current).toEqual(snapshot)
    const read = await service.readRepresentation(snapshot.id, 'original-image')
    expect(Buffer.from(read.bytes).equals(original)).toBe(true)
    expect(await readdir(path.join(directory, 'snapshots'))).toHaveLength(1)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
