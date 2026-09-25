// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ExecutionAssistant } from '../../src/renderer/workbench/ExecutionAssistant'
import { WorkbenchSessionDock, WorkbenchSessionPortalProvider } from '../../src/renderer/workbench/WorkbenchSessionPortal'
import { emptyExecutionProjection } from '../../src/shared/workbench/executionEvents'
import type { ConversationRecord } from '../../src/shared/workbench/conversations'
import type { ExecutionDesktopAPI } from '../../src/shared/workbench/executionDesktop'
import { WorkspaceGrid } from '../../src/renderer/lessonWorkspace/view/WorkspaceGrid'
import { resolveWorkbenchWidths, useWorkbenchLayoutPrefs, type WorkbenchLayoutController } from '../../src/renderer/lessonWorkspace/view/useWorkbenchLayoutPrefs'
import type { ProEditorPanel } from '../../src/renderer/ui/proEditorRailController'

const record = (conversationId: string, title: string): ConversationRecord => ({
  conversationId, workspaceId: 'space', title, messages: [], attachmentIds: [],
  runIndex: { builtinRunIds: [], externalRunIds: [], externalPortIds: [] },
  inputDraft: '', inputAttachments: [], frozenContextRefs: [], revision: 0, createdAt: 1, updatedAt: 1,
})

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear() })

it('shows the one live assistant session list in the left dock with searchable per-item management', async () => {
  const conversations = new Map([['first', record('first', '甲备课')], ['second', record('second', '乙备课')]])
  const rename = vi.fn(async (input: { conversationId: string; title: string; expectedRevision: number }) => {
    const previous = conversations.get(input.conversationId)!
    expect(input.expectedRevision).toBe(previous.revision)
    const next = { ...previous, title: input.title, revision: previous.revision + 1 }
    conversations.set(input.conversationId, next)
    return next
  })
  const remove = vi.fn(async (input: { conversationId: string; expectedRevision: number }) => {
    expect(input.expectedRevision).toBe(conversations.get(input.conversationId)?.revision)
    conversations.delete(input.conversationId)
  })
  const api = {
    workspace: async () => ({ workspace: { workspaceId: 'space' }, conversations: [...conversations.values()] }),
    conversations: async () => [...conversations.values()],
    conversation: async (_space: string, id: string) => conversations.get(id) ?? null,
    createConversation: async () => { const value = record('third', '新会话'); conversations.set(value.conversationId, value); return value },
    renameConversation: rename, deleteConversation: remove,
    draft: async () => { throw new Error('No draft mutation expected') },
    submissions: async () => [], timeline: async (id: string) => emptyExecutionProjection(id),
    events: async () => ({ events: [], hasMore: false }), subscribe: () => () => {}, run: async () => null,
  } as unknown as ExecutionDesktopAPI

  render(<WorkbenchSessionPortalProvider>
    <div data-testid="left-rail"><WorkbenchSessionDock /></div>
    <div data-testid="right-assistant"><ExecutionAssistant root="C:/fixture" api={api} captureDocuments={async () => []} prepareSend={async () => true} /></div>
  </WorkbenchSessionPortalProvider>)
  const list = await screen.findByRole('complementary', { name: '会话列表' })
  await within(list).findByRole('button', { name: '甲备课' })
  expect(screen.getByTestId('left-rail')).toContainElement(list)
  expect(screen.getByTestId('right-assistant').querySelectorAll('.execution-assistant')).toHaveLength(1)
  expect(within(list).getByRole('button', { name: '甲备课' })).toHaveAttribute('aria-current', 'page')

  fireEvent.change(within(list).getByRole('textbox', { name: '搜索会话' }), { target: { value: '乙' } })
  expect(within(list).queryByRole('button', { name: '甲备课' })).toBeNull()
  expect(within(list).getByRole('button', { name: '乙备课' })).toBeInTheDocument()
  fireEvent.change(within(list).getByRole('textbox', { name: '搜索会话' }), { target: { value: '' } })

  fireEvent.click(within(list).getByRole('button', { name: '管理会话 乙备课' }))
  fireEvent.click(within(list).getByRole('menuitem', { name: '重命名' }))
  fireEvent.change(within(list).getByRole('textbox', { name: '重命名 乙备课' }), { target: { value: '乙修订' } })
  fireEvent.click(within(list).getByRole('button', { name: '保存' }))
  await waitFor(() => expect(rename).toHaveBeenCalledOnce())
  await within(list).findByRole('button', { name: '乙修订' })

  fireEvent.click(within(list).getByRole('button', { name: '管理会话 乙修订' }))
  fireEvent.click(within(list).getByRole('menuitem', { name: '删除会话' }))
  await waitFor(() => expect(remove).toHaveBeenCalledOnce())
  expect(within(list).queryByRole('button', { name: '乙修订' })).toBeNull()
  expect(within(list).getByRole('button', { name: '甲备课' })).toHaveAttribute('aria-current', 'page')
  expect(screen.getByTestId('right-assistant').querySelectorAll('.execution-assistant')).toHaveLength(1)
})

it('hides resource and session sections independently and keeps one assistant mounted through pro rail changes', () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  let layout!: WorkbenchLayoutController
  function Harness({ panel }: { panel: ProEditorPanel }) {
    layout = useWorkbenchLayoutPrefs()
    return <WorkspaceGrid layout={layout} editorFocus proPanel={panel} mobilePane="workbench" selectPane={() => {}}
      resources={<input aria-label="left rail state" defaultValue="retained" />}
      content={<div>document</div>} assistant={<input aria-label="AI composer state" defaultValue="unfinished prompt" />} />
  }
  const view = render(<Harness panel={null} />)
  const assistant = screen.getByLabelText('AI composer state')
  expect(view.container.querySelector('.workspace-grid')).toHaveAttribute('data-chat-closed', 'true')
  view.rerender(<Harness panel="ai" />)
  expect(view.container.querySelector('.workspace-grid')).toHaveAttribute('data-pro-panel', 'ai')
  view.rerender(<Harness panel="resources" />)
  view.rerender(<Harness panel="conversations" />)
  expect(screen.getByLabelText('AI composer state')).toBe(assistant)
  expect(assistant).toHaveValue('unfinished prompt')

  act(() => layout.setExplorerOpen(false))
  expect(resolveWorkbenchWidths(layout.prefs, 1600).nav).toBeGreaterThan(0)
  act(() => layout.setConversationsOpen(false))
  expect(resolveWorkbenchWidths(layout.prefs, 1600).nav).toBe(0)
  act(() => layout.setConversationsOpen(true))
  expect(resolveWorkbenchWidths(layout.prefs, 1600).nav).toBeGreaterThan(0)
})
