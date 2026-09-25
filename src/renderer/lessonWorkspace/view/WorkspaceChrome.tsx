import { useState } from 'react'
import { ArrowLeftRight, ChevronDown, PanelsTopLeft } from 'lucide-react'
import type { LessonWorkspaceViewProps } from './lessonWorkspaceViewTypes'
import type { WorkbenchLayoutController } from './useWorkbenchLayoutPrefs'
import { proEditorRailController, type ProEditorPanel } from '../../ui/proEditorRailController'
const basename = (path: string) => path.replace(/[\\/]$/, '').split(/[\\/]/).pop() || path;
const lower = (value: string) => value.replace(/\\/g, '/').toLowerCase();
const join = (directory: string, name: string) => `${directory.replace(/[\\/]$/, '')}/${name}`;
export function WorkspaceChrome({ props, layout, editorFocus = false, proPanel = null, exitEditor }: {
 props: LessonWorkspaceViewProps; layout: WorkbenchLayoutController; editorFocus?: boolean; proPanel?: ProEditorPanel; exitEditor(): void
}) {
 const { state, actions } = props;
 const [switcherMenuOpen, setSwitcherMenuOpen] = useState(false);
 const [layoutMenuOpen, setLayoutMenuOpen] = useState(false);
 const workspaceName = state.workspace ? basename(state.workspace) : '';
 const contentOpen = editorFocus || !layout.prefs.contentClosed;
 const explorerVisible = editorFocus ? proPanel === 'resources' : !layout.prefs.navCollapsed && layout.prefs.explorerOpen;
 const conversationsVisible = editorFocus ? proPanel === 'conversations' : !layout.prefs.navCollapsed && layout.prefs.conversationsOpen;
 const assistantVisible = editorFocus ? proPanel === 'ai' : !layout.prefs.chatClosed;
 const toggleExplorer = () => editorFocus ? proEditorRailController.toggle('resources') : layout.setExplorerOpen(!explorerVisible);
 const toggleConversations = () => editorFocus ? proEditorRailController.toggle('conversations') : layout.setConversationsOpen(!conversationsVisible);
 const toggleAssistant = () => editorFocus ? proEditorRailController.toggle('ai') : layout.toggleChatClosed();
 return <>
      <header className="lesson-workspace-toolbar">
        <details
          className="lesson-workspace-switcher lesson-workspace-more"
          open={switcherMenuOpen}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setSwitcherMenuOpen(false);
              (event.currentTarget.querySelector('summary') as HTMLElement | null)?.focus();
            }
          }}
          onToggle={(event) =>
            setSwitcherMenuOpen(
              (event.currentTarget as HTMLDetailsElement).open,
            )
          }
        >
          <summary
            aria-label="切换工作空间"
            title={state.workspace ?? "选择工作空间"}
          >
            <span className="lesson-workspace-brand" aria-hidden="true">
              果
            </span>
            <strong>
              {state.workspace ? workspaceName : "果铃工作台"}
            </strong>
            <span className="lesson-workspace-switch-tag" aria-hidden="true">
              <ArrowLeftRight size={12} />
              切换
            </span>
            <ChevronDown size={14} aria-hidden="true" />
          </summary>
          {switcherMenuOpen && (
            <div
              className="lesson-popover-backdrop"
              aria-hidden="true"
              onClick={() => setSwitcherMenuOpen(false)}
            />
          )}
          <div className="lesson-workspace-switcher-popover">
            <p className="lesson-eyebrow">工作空间</p>
            <div className="lesson-workspace-switcher-recent" role="group" aria-label="最近使用的工作空间">
            {state.recent.map((directory) => (
              <button
                type="button"
                key={directory}
                title={directory}
                aria-pressed={
                  state.workspace
                    ? lower(directory) === lower(state.workspace)
                    : undefined
                }
                onClick={() => {
                  setSwitcherMenuOpen(false);
                  if (
                    state.workspace &&
                    lower(directory) === lower(state.workspace)
                  )
                    return;
                  exitEditor();
                  void actions.run(() => actions.openWorkspace(directory));
                }}
              >
                <strong>{basename(directory)}</strong>
                <small>{directory}</small>
              </button>
            ))}
            </div>
            <div className="lesson-workspace-switcher-actions">
            <button
              type="button"
              onClick={() => {
                setSwitcherMenuOpen(false);
                exitEditor();
                void actions.run(() => actions.openWorkspace());
              }}
            >
              选择其他工作空间文件夹…
            </button>
            <button
              type="button"
              onClick={() => {
                setSwitcherMenuOpen(false);
                exitEditor();
                void actions.run(() => actions.openWorkspace(undefined, true));
              }}
            >
              新建工作空间
            </button>
            </div>
          </div>
        </details>
        <div className="lesson-workspace-toolbar-actions">
          <button type="button" aria-pressed={explorerVisible} onClick={() => { toggleExplorer(); actions.setMobilePane('navigation'); }}>资源管理器</button>
          <button type="button" aria-pressed={conversationsVisible} onClick={() => { toggleConversations(); actions.setMobilePane('navigation'); }}>会话列表</button>
          {!editorFocus && <button type="button" aria-pressed={contentOpen} onClick={() => { layout.toggleContentClosed(); actions.setMobilePane('workbench'); }}>内容</button>}
          <button type="button" aria-pressed={assistantVisible} onClick={() => { toggleAssistant(); actions.setMobilePane('chat'); }}>AI 助手</button>
          <details
            className="lesson-workspace-more lesson-layout-menu"
            open={layoutMenuOpen}
            onToggle={(event) =>
              setLayoutMenuOpen(
                (event.currentTarget as HTMLDetailsElement).open,
              )
            }
          >
            <summary aria-label="布局" title="按你的习惯安排工作区">
              <PanelsTopLeft size={14} aria-hidden="true" />
              布局
            </summary>
            {layoutMenuOpen && (
              <div
                className="lesson-popover-backdrop"
                aria-hidden="true"
                onClick={() => setLayoutMenuOpen(false)}
              />
            )}
            <div className="lesson-layout-popover">
              <button type="button" onClick={() => { toggleExplorer(); setLayoutMenuOpen(false) }}>
                {explorerVisible ? "收起" : "展开"}资源管理器
              </button>
              <button type="button" onClick={() => { toggleConversations(); setLayoutMenuOpen(false) }}>
                {conversationsVisible ? "收起" : "展开"}会话列表
              </button>
              <button type="button" onClick={() => { toggleAssistant(); setLayoutMenuOpen(false) }}>
                {assistantVisible ? "收起" : "展开"}AI 助手
              </button>
              {!editorFocus && <button
                type="button"
                onClick={() => { layout.toggleContentClosed(); setLayoutMenuOpen(false) }}
              >
                {contentOpen ? "收起" : "展开"}内容区
              </button>}
              <button type="button" onClick={() => { layout.resetLayout(); setLayoutMenuOpen(false) }}>
                恢复默认布局
              </button>
            </div>
          </details>
        </div>
      </header>
      {state.creating && (
        <div
          className="lesson-modal-backdrop"
          role="presentation"
          onClick={() => actions.setCreating(false)}
        >
          <form
            className="lesson-modal lesson-create-form"
            role="dialog"
            aria-modal="true"
            aria-label="新建课件"
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              void actions.run(actions.createLesson);
            }}
          >
            <h3>新建课件</h3>
            <label>
              课件名称
              <input
                value={state.name}
                onChange={(event) => actions.setName(event.target.value)}
                required
                autoFocus
              />
            </label>
            <p
              title={
                state.selectedDirectory
                  ? join(
                      state.selectedDirectory,
                      state.name.trim() || "课件名称",
                    )
                  : undefined
              }
            >
              将创建：
              {state.selectedDirectory &&
                join(state.selectedDirectory, state.name.trim() || "课件名称")}
            </p>
            <div className="lesson-modal-actions">
              <button
                type="submit"
                className="lesson-primary-action"
                disabled={state.busy || !state.name.trim()}
              >
                创建课件
              </button>
              <button
                type="button"
                onClick={() => actions.setCreating(false)}
              >
                取消
              </button>
            </div>
          </form>
        </div>
      )}
</>;
}
