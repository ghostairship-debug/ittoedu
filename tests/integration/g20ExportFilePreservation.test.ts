// @vitest-environment node
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { BrowserWindow } from 'electron'
import { expect, it, vi } from 'vitest'
const dialog = vi.hoisted(() => ({ showSaveDialog: vi.fn() }))
vi.mock('electron', () => ({ dialog }))
import { writeHtmlFile, writeBinaryExportFile, writeWebPackageFile } from '../../src/main/fileDialogs'
it('retains existing export files on native cancel or failed atomic replace, cleans temporary bytes and replaces only complete output', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-export-files-'))
  try {
    const filename = path.join(directory, 'original.html'); await fs.writeFile(filename, 'original complete content')
    dialog.showSaveDialog.mockResolvedValue({ canceled: true, filePath: filename })
    expect(await writeHtmlFile({} as BrowserWindow, 'name.html', 'new')).toBeNull()
    expect(await writeBinaryExportFile({} as BrowserWindow, 'name.pptx', 'pptx', new Uint8Array([1]))).toBeNull()
    expect(await writeWebPackageFile({} as BrowserWindow, 'name.zip', new Uint8Array([0x50, 0x4b, 3, 4]))).toBeNull()
    expect(await fs.readFile(filename, 'utf8')).toBe('original complete content')
    dialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: filename })
    const rename = vi.spyOn(fs, 'rename').mockRejectedValueOnce(Object.assign(new Error('fixture locked target'), { code: 'EBUSY' }))
    await expect(writeHtmlFile({} as BrowserWindow, 'name.html', 'new complete content')).rejects.toMatchObject({ code: 'HTML_EXPORT_FAILED' })
    rename.mockRestore()
    expect(await fs.readFile(filename, 'utf8')).toBe('original complete content'); expect(await fs.readdir(directory)).toEqual(['original.html'])
    await writeHtmlFile({} as BrowserWindow, 'name.html', 'new complete content')
    expect(await fs.readFile(filename, 'utf8')).toBe('new complete content'); expect(await fs.readdir(directory)).toEqual(['original.html'])
  } finally { vi.restoreAllMocks(); if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('invalid fixture'); await fs.rm(directory, { recursive: true, force: true }) }
})
