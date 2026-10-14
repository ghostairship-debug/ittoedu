// @vitest-environment node
import path from 'node:path'
import type { BrowserWindow } from 'electron'
import { zipSync } from 'fflate'
import { beforeEach, expect, it, vi } from 'vitest'

const dialogs = vi.hoisted(() => ({ save: vi.fn() }))
vi.mock('electron', () => ({ dialog: { showSaveDialog: dialogs.save } }))
import { writeBinaryExportFile, writeHtmlFile, writeWebPackageFile } from '../../src/main/fileDialogs'

const parent = {} as BrowserWindow
beforeEach(() => { dialogs.save.mockReset().mockResolvedValue({ canceled: true }) })

it('suggests the GLX directory for HTML, ZIP, PDF and editable document exports', async () => {
  const projectPath = path.resolve('lesson-directory', '天下拼图.glx')
  await writeHtmlFile(parent, '天下拼图.html', '<html></html>', projectPath)
  await writeWebPackageFile(parent, '天下拼图.zip', zipSync({ 'index.html': new TextEncoder().encode('<html></html>') }), projectPath)
  for (const extension of ['pdf', 'pptx', 'docx'] as const)
    await writeBinaryExportFile(parent, `天下拼图.${extension}`, extension, new Uint8Array([1]), projectPath)
  expect(dialogs.save.mock.calls.map(call => call[1].defaultPath)).toEqual(
    ['html', 'zip', 'pdf', 'pptx', 'docx'].map(extension => path.join(path.dirname(projectPath), `天下拼图.${extension}`)),
  )
})

it('keeps the ordinary save-dialog default for an unbound document', async () => {
  await writeHtmlFile(parent, '未命名.html', '<html></html>')
  expect(dialogs.save).toHaveBeenCalledWith(parent, expect.objectContaining({ defaultPath: '未命名.html' }))
})
