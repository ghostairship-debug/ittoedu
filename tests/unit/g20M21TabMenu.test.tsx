import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createRef } from 'react'
import { LessonWorkspaceShell, type LessonWorkspaceShellHandle } from '../../src/renderer/lessonWorkspace/LessonWorkspaceShell'
import type { RecoverableDocumentFilePort } from '../../src/renderer/documentFiles/documentFileSession'
import { REVEAL_IN_EXPLORER_EVENT, type RevealInExplorerDetail } from '../../src/renderer/workbench/revealInExplorer'
import type { LessonDesktopRequest } from '../../src/shared/lessonDesktopContract'
import { attachMarkdownRendererHost } from '../helpers/markdownRendererHost'

beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }) })
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })

function mount() {
  const disk = new Map([['/workspace/a.md', 'A source']])
  const port: RecoverableDocumentFilePort = {
    openDocument: async ref => {
      const filename = ref.kind === 'file' ? ref.path : `${ref.lessonDirectory}/${ref.relativePath}`
      const source = disk.get(filename)
      if (source === undefined) throw new Error('ENOENT')
      return { ref, source, version: { contentVersion: source, attachments: [] }, diagnostics: [] }
    },
    watchDocument: () => () => {}, saveDocument: vi.fn(),
  }
  attachMarkdownRendererHost(port)
  const operation = vi.fn(async (request: LessonDesktopRequest) => {
    switch (request.operation) {
      case 'recent-workspaces': return { recent: [] }
      case 'list-lessons': return { lessons: [] }
      case 'list-projects': return { projects: [] }
      case 'open-external': return { opened: true }
      default: throw new Error(`Unexpected ${request.operation}`)
    }
  })
  const handle = createRef<LessonWorkspaceShellHandle>()
  render(<LessonWorkspaceShell ref={handle} lessonOperation={operation} documentPort={port} projectPath={null}
    onOpenProject={async () => true} onNewProject={async () => true}>课程宿主</LessonWorkspaceShell>)
  return { operation, handle }
}

async function newDocument(name: string) {
  fireEvent.change(screen.getByLabelText('Markdown 文档名'), { target: { value: name } })
  fireEvent.click(screen.getByRole('button', { name: '创建文档' }))
  await screen.findByRole('tab', { name: new RegExp(`${name}\\.md`) })
}

function openTabs() {
  return within(screen.getByRole('tablist', { name: '打开的文件' })).getAllByRole('tab').map(tab => tab.textContent)
}

function tabMenu(name: RegExp) {
  fireEvent.contextMenu(within(screen.getByRole('tablist', { name: '打开的文件' })).getByRole('tab', { name }))
  return screen.getByRole('menu', { name: /标签菜单$/ })
}

it('M21 gives each file tab one right-click menu whose unavailable items say why', async () => {
  const { operation, handle } = mount()
  await newDocument('教学稿')
  let menu = tabMenu(/教学稿\.md/)
  const item = (label: string) => within(menu).getByRole('menuitem', { name: label })
  expect(within(menu).getAllByRole('menuitem').map(entry => entry.getAttribute('aria-label')))
    .toEqual(['关闭', '关闭其他', '关闭右侧', '全部关闭', '复制路径', '在资源管理器中显示', '用系统应用打开'])
  expect(item('关闭其他')).toHaveTextContent('没有其他标签')
  expect(item('关闭右侧')).toHaveTextContent('右侧没有标签')
  // An untitled document has no file yet.
  for (const label of ['复制路径', '在资源管理器中显示', '用系统应用打开']) {
    expect(item(label)).toHaveAttribute('aria-disabled', 'true')
    expect(item(label)).toHaveTextContent('尚未保存到文件')
  }
  fireEvent.keyDown(window, { key: 'Escape' })

  // A tab bound to a file can be found and opened from its menu.
  await handle.current!.openFile('/workspace/a.md')
  await waitFor(() => expect(openTabs()).toEqual(['教学稿.md', 'a.md']))
  const revealed = vi.fn()
  const listener = (event: Event) => revealed((event as CustomEvent<RevealInExplorerDetail>).detail)
  window.addEventListener(REVEAL_IN_EXPLORER_EVENT, listener)
  try {
    menu = tabMenu(/a\.md/)
    expect(item('关闭其他')).not.toHaveAttribute('aria-disabled')
    fireEvent.click(item('在资源管理器中显示'))
    expect(revealed).toHaveBeenCalledWith({ path: '/workspace/a.md', kind: 'file' })
  } finally { window.removeEventListener(REVEAL_IN_EXPLORER_EVENT, listener) }
  menu = tabMenu(/a\.md/)
  fireEvent.click(item('用系统应用打开'))
  await waitFor(() => expect(operation).toHaveBeenCalledWith({ operation: 'open-external', path: '/workspace/a.md' }))
})

it('M21 closes the tabs to the right and the other tabs from a tab menu', async () => {
  const snapshot = (documentId: string, path: string) => ({ documentId, epoch: 'e', revision: 1, dirty: false, saving: false, recoverable: false, undoDepth: 0, redoDepth: 0,
    binding: { kind: 'file' as const, path, version: null, bindingVersion: 1 },
    model: { kind: 'course-v9' as const, project: {} as never, resources: { assets: {}, components: {} } } })
  const close = vi.fn<(documentId: string) => Promise<boolean>>(async () => true)
  const port: RecoverableDocumentFilePort = { openDocument: async () => { throw new Error('ENOENT') }, watchDocument: () => () => {}, saveDocument: vi.fn() }
  render(<LessonWorkspaceShell lessonOperation={async () => ({ recent: [], lessons: [], projects: [] })} documentPort={port} projectPath={null}
    onOpenProject={async () => true} onNewProject={async () => true}
    courseDocuments={{ documents: [snapshot('one', 'D:/课/一.h5lesson'), snapshot('two', 'D:/课/二.h5lesson'), snapshot('three', 'D:/课/三.h5lesson')],
      activeDocumentId: 'one', activate: async () => undefined, close }}>课程宿主</LessonWorkspaceShell>)
  await waitFor(() => expect(openTabs()).toEqual(['一.h5lesson', '二.h5lesson', '三.h5lesson']))
  let menu = tabMenu(/二\.h5lesson/)
  fireEvent.click(within(menu).getByRole('menuitem', { name: '关闭右侧' }))
  await waitFor(() => expect(openTabs()).toEqual(['一.h5lesson', '二.h5lesson']))
  expect(close).toHaveBeenCalledWith('three')
  menu = tabMenu(/二\.h5lesson/)
  fireEvent.click(within(menu).getByRole('menuitem', { name: '关闭其他' }))
  await waitFor(() => expect(openTabs()).toEqual(['二.h5lesson']))
  expect(close.mock.calls.map(([id]) => id)).toEqual(['three', 'one'])
})
