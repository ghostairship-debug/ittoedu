// @vitest-environment node
import { expect, it } from 'vitest'
import { fileCapabilities, sourceFileKind } from '../../src/shared/workbench/sourceFileKind'

it.each(['settings.json', 'comments.JSONC', 'view.tsx', 'main.py', 'config.yaml', 'settings.toml', '.env', '.gitignore', 'README', 'Dockerfile', 'notes.custom'])('opens %s as source without interpreting or executing it', filename => {
  expect(fileCapabilities(filename)).toMatchObject({ openKind: 'document', sourceKind: 'text' })
  expect(sourceFileKind(filename)).toBe('text')
})

it.each(['C:\\workspace\\notes.md', '/workspace/notes.markdown'])('preserves the Markdown driver for %s', filename => {
  expect(fileCapabilities(filename)).toMatchObject({ openKind: 'document', sourceKind: 'markdown' })
  expect(sourceFileKind(filename)).toBe('markdown')
})

it.each(['image.png', 'document.pdf', 'book.docx', 'slides.pptm', 'sheet.xlsb', 'archive.zip', 'font.woff2', 'module.wasm', 'module.dll', 'database.sqlite3', 'cache.pyc'])('never offers %s to a source driver', filename => {
  expect(fileCapabilities(filename).sourceKind).toBeNull()
  expect(sourceFileKind.bind(null, filename)).toThrow('不能按 UTF-8 源文编辑')
})

it.each(['program.exe', 'setup.MSI', 'shortcut.lnk', 'site.url', 'program.jar'])('blocks default opening and external execution of %s', filename => {
  expect(fileCapabilities(filename)).toEqual({ openKind: 'blocked', sourceKind: null, externalOpenAllowed: false })
  expect(sourceFileKind.bind(null, filename)).toThrow('可执行文件')
})

it.each(['start.cmd', 'start.bat', 'start.ps1', 'script.js', 'script.py', 'script.sh', 'change.reg'])('edits %s as text but refuses OS execution associations', filename => {
  expect(fileCapabilities(filename)).toEqual({ openKind: 'document', sourceKind: 'text', externalOpenAllowed: false })
})

it('opens PPTX through the read-only presentation surface while preserving external opening', () => {
  expect(fileCapabilities('DECK.PPTX')).toEqual({ openKind: 'presentation', sourceKind: null, externalOpenAllowed: true })
  expect(sourceFileKind.bind(null, 'DECK.PPTX')).toThrow('不能按 UTF-8 源文编辑')
})

it('keeps SVG preview and source editing as two capabilities of the same file', () => {
  expect(fileCapabilities('diagram.svg')).toEqual({ openKind: 'media', sourceKind: 'text', externalOpenAllowed: true })
  expect(sourceFileKind('diagram.svg')).toBe('text')
})
