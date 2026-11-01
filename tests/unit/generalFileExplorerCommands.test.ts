import { expect, it, vi } from 'vitest'
import { explorerContextCommands, type ExplorerCommandPorts } from '../../src/renderer/lessonWorkspace/view/explorerCommands'

function fixture() {
  const ports: ExplorerCommandPorts = { create: vi.fn(), importHtml: vi.fn(), openExternal: vi.fn(), rename: vi.fn(), copy: vi.fn(), cut: vi.fn(), paste: vi.fn(), copyTo: vi.fn(), moveTo: vi.fn(), trash: vi.fn(), copyPath: vi.fn(), reveal: vi.fn() }
  const state = { blocked: null, selected: 1, pptx: false, htmlImport: null, externalFile: true, clipboard: 0 } as const
  return { ports, state }
}

it('offers one system-default action for any selected file and keeps HTML import separate', () => {
  const { ports, state } = fixture()
  const commands = explorerContextCommands({ ...state, htmlImport: 'selected' }, ports)
  const external = commands.find(command => command.id === 'file.open-external')!
  expect(external.label).toBe('使用系统默认应用打开')
  expect(external.disabledReason).toBeNull()
  external.run()
  expect(ports.openExternal).toHaveBeenCalledOnce()
  expect(commands.filter(command => command.id.startsWith('file.open-'))).toHaveLength(1)
  expect(commands.find(command => command.id === 'file.import-html')).toBeDefined()
})

it('omits file-only opening for a directory and disables executable or multi-file selections', () => {
  const { ports, state } = fixture()
  expect(explorerContextCommands({ ...state, externalFile: false }, ports).some(command => command.id === 'file.open-external')).toBe(false)
  expect(explorerContextCommands({ ...state, externalBlocked: '不能运行此文件' }, ports).find(command => command.id === 'file.open-external')?.disabledReason).toBe('不能运行此文件')
  expect(explorerContextCommands({ ...state, selected: 2 }, ports).find(command => command.id === 'file.open-external')?.disabledReason).toBe('请只选择一项')
})
