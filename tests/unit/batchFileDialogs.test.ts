import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { BrowserWindow } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  showOpenDialog: vi.fn(),
}))

vi.mock('electron', () => ({
  dialog: { showOpenDialog: electron.showOpenDialog },
}))

import {
  selectAudioFiles,
  selectComponentFiles,
  selectImageFiles,
  selectVideoFiles,
} from '@/main/fileDialogs'

let temporaryDirectory = ''
const windowStub = {} as BrowserWindow

beforeEach(async () => {
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'courseware-batch-dialog-'))
  electron.showOpenDialog.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(temporaryDirectory, { recursive: true, force: true })
})

describe('batch file dialogs', () => {
  it('returns every valid image and an explainable rejection in one response', async () => {
    const validPath = path.join(temporaryDirectory, 'valid.png')
    const invalidPath = path.join(temporaryDirectory, 'broken.png')
    await fs.writeFile(validPath, Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]))
    await fs.writeFile(invalidPath, Uint8Array.from([1, 2, 3, 4]))
    electron.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: [validPath, invalidPath],
    })

    const result = await selectImageFiles(windowStub)

    expect(electron.showOpenDialog).toHaveBeenCalledWith(
      windowStub,
      expect.objectContaining({
        properties: expect.arrayContaining(['openFile', 'multiSelections']),
      }),
    )
    expect(result).toMatchObject({
      selectedCount: 2,
      acceptedByteLength: 8,
      accepted: [{ name: 'valid.png', mimeType: 'image/png' }],
      rejected: [{
        name: 'broken.png',
        code: 'IMAGE_CONTENT_INVALID',
        title: '图片导入失败',
      }],
    })
    expect(result!.accepted[0]!.sha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it('treats system-dialog cancellation as no batch and reads nothing', async () => {
    electron.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    await expect(selectImageFiles(windowStub)).resolves.toBeNull()
  })

  it('accepts a valid selected image without a fixed file-size quota', async () => {
    const oversizedPath = path.join(temporaryDirectory, 'oversized.png')
    await fs.writeFile(oversizedPath, Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]))
    const stats = await fs.stat(oversizedPath)
    vi.spyOn(fs, 'stat').mockResolvedValue(Object.assign(stats, { size: 100 * 1024 * 1024 + 1 }))
    electron.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: [oversizedPath],
    })

    const result = await selectImageFiles(windowStub)

    expect(result).toMatchObject({
      selectedCount: 1,
      acceptedByteLength: 8,
      accepted: [{ name: 'oversized.png', mimeType: 'image/png' }],
      rejected: [],
    })
  })

  it('imports all selected files beyond the former batch-count quota', async () => {
    const files = Array.from({ length: 125 }, (_, index) => path.join(temporaryDirectory, `image-${index}.png`))
    const image = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    await Promise.all(files.map(filename => fs.writeFile(filename, image)))
    electron.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: files })
    const result = await selectImageFiles(windowStub)
    expect(result?.accepted).toHaveLength(125)
    expect(result?.rejected).toEqual([])
    expect(result?.acceptedByteLength).toBe(125 * image.byteLength)
  })

  it('validates every component ZIP independently', async () => {
    const validPath = path.join(temporaryDirectory, 'valid.h5component')
    const invalidPath = path.join(temporaryDirectory, 'broken.h5component')
    await fs.writeFile(validPath, Uint8Array.from([0x50, 0x4b, 0x03, 0x04]))
    await fs.writeFile(invalidPath, Uint8Array.from([0, 0, 0, 0]))
    electron.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: [validPath, invalidPath],
    })

    const result = await selectComponentFiles(windowStub)
    expect(electron.showOpenDialog).toHaveBeenCalledWith(
      windowStub,
      expect.objectContaining({
        properties: expect.arrayContaining(['openFile', 'multiSelections']),
      }),
    )
    expect(result?.accepted).toHaveLength(1)
    expect(result?.rejected).toMatchObject([{
      name: 'broken.h5component',
      code: 'COMPONENT_ARCHIVE_INVALID',
    }])
  })

  it('uses plural dialogs and media magic validation for audio and video', async () => {
    const audioPath = path.join(temporaryDirectory, 'valid.mp3')
    const videoPath = path.join(temporaryDirectory, 'valid.mp4')
    await fs.writeFile(audioPath, Uint8Array.from([0x49, 0x44, 0x33]))
    await fs.writeFile(videoPath, Uint8Array.from([
      0, 0, 0, 12,
      0x66, 0x74, 0x79, 0x70,
      0x69, 0x73, 0x6f, 0x6d,
    ]))

    electron.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: [audioPath],
    })
    await expect(selectAudioFiles(windowStub)).resolves.toMatchObject({
      accepted: [{ name: 'valid.mp3', mimeType: 'audio/mpeg' }],
      rejected: [],
    })

    electron.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: [videoPath],
    })
    await expect(selectVideoFiles(windowStub)).resolves.toMatchObject({
      accepted: [{ name: 'valid.mp4', mimeType: 'video/mp4' }],
      rejected: [],
    })

    for (const call of electron.showOpenDialog.mock.calls) {
      expect(call[1]).toEqual(expect.objectContaining({
        properties: expect.arrayContaining(['openFile', 'multiSelections']),
      }))
    }
  })
})
