import { useEffect, useRef, useState } from 'react'
import { ArrowLeftRight, ChevronDown, PanelsTopLeft, Sparkles } from 'lucide-react'
import { NutChimeMark } from '../../ui/NutChimeMark'
import type { LessonWorkspaceViewProps } from './lessonWorkspaceViewTypes'
import type { WorkbenchLayoutController } from './useWorkbenchLayoutPrefs'
import { proEditorRailController, type ProEditorPanel } from '../../ui/proEditorRailController'
import { REVEAL_IN_EXPLORER_EVENT } from '../../workbench/revealInExplorer'
import { useDismissableDetails } from '../../ui/useDismissableDetails'
import '../../ui/workbenchChrome.css'
const basename = (path: string) => path.replace(/[\\/]$/, '').split(/[\\/]/).pop() || path;
const lower = (value: string) => value.replace(/\\/g, '/').toLowerCase();
const join = (directory: string, name: string) => `${directory.replace(/[\\/]$/, '')}/${name}`;
export function WorkspaceChrome({ props, layout, editorFocus = false, proPanel = null, exitEditor }: {
 props: LessonWorkspaceViewProps; layout: WorkbenchLayoutController; editorFocus?: boolean; proPanel?: ProEditorPanel; exitEditor(): void
}) {
 const { state, actions } = props;
 const [switcherMenuOpen, setSwitcherMenuOpen] = useState(false);
 const [layoutMenuOpen, setLayoutMenuOpen] = useState(false);
 const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 860px)').matches);
 useEffect(() => {
  const query = window.matchMedia('(max-width: 860px)');
  const update = () => setNarrow(query.matches);
  query.addEventListener('change', update); update();
  return () => query.removeEventListener('change', update);
 }, []);
 const switcherMenu = useRef<HTMLDetailsElement>(null), layoutMenu = useRef<HTMLDetailsElement>(null);
 useDismissableDetails(switcherMenu); useDismissableDetails(layoutMenu);
 const workspaceName = state.workspace ? basename(state.workspace) : '';
 const contentOpen = editorFocus || !layout.prefs.contentClosed;
 const explorerVisible = editorFocus ? proPanel === 'resources' : !layout.prefs.navCollapsed && layout.prefs.explorerOpen;
 const conversationsVisible = editorFocus ? proPanel === 'conversations' : !layout.prefs.navCollapsed && layout.prefs.conversationsOpen;
 const assistantVisible = editorFocus ? proPanel === 'ai' : !layout.prefs.chatClosed;
 const toggleExplorer = () => editorFocus ? proEditorRailController.toggle('resources') : layout.setExplorerOpen(!explorerVisible);
 const toggleConversations = () => editorFocus ? proEditorRailController.toggle('conversations') : layout.setConversationsOpen(!conversationsVisible);
 const toggleAssistant = () => editorFocus ? proEditorRailController.toggle('ai') : layout.toggleChatClosed();
 const selectRegion = (region: 'resources' | 'conversations' | 'workbench' | 'chat') => {
  if (narrow && !editorFocus) {
   if (region === 'resources') layout.setExplorerOpen(true);
   if (region === 'conversations') layout.setConversationsOpen(true);
   if (region === 'workbench') layout.setContentClosed(false);
   if (region === 'chat') layout.setChatClosed(false);
  } else {
   if (region === 'resources') toggleExplorer();
   if (region === 'conversations') toggleConversations();
   if (region === 'workbench') layout.toggleContentClosed();
   if (region === 'chat') toggleAssistant();
  }
  actions.setMobilePane(region === 'resources' || region === 'conversations' ? 'navigation' : region);
 };
 const { setExplorerOpen } = layout;
 useEffect(() => {
  // Locating a file shows the explorer first; the explorer reveals the file once it is mounted.
  const show = () => { if (editorFocus) proEditorRailController.open('resources'); else setExplorerOpen(true) };
  window.addEventListener(REVEAL_IN_EXPLORER_EVENT, show);
  return () => window.removeEventListener(REVEAL_IN_EXPLORER_EVENT, show);
 }, [editorFocus, setExplorerOpen]);
 return <>
      <header className="lesson-workspace-toolbar">
        <div className="toolbar__brand" aria-label="果铃">
          <span className="toolbar__brand-mark"><NutChimeMark size={25} /></span>
          <strong>果铃</strong><span className="toolbar__brand-divider" aria-hidden="true">｜</span>
        </div>
        <details
          ref={switcherMenu}
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
            <strong>
              {state.workspace ? workspaceName : "选择工作空间"}
            </strong>
            <span className="lesson-workspace-switch-tag" aria-hidden="true">
              <ArrowLeftRight size={12} />
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
          {props.toolbarExtras}
          {(narrow || editorFocus) && <button type="button" aria-pressed={explorerVisible && (!narrow || editorFocus || state.mobilePane === 'navigation')} onClick={() => selectRegion('resources')}>资源管理器</button>}
          {(narrow || editorFocus) && <button type="button" aria-pressed={conversationsVisible && (!narrow || editorFocus || state.mobilePane === 'navigation')} onClick={() => selectRegion('conversations')}>会话列表</button>}
          {!editorFocus && narrow && <button type="button" aria-pressed={contentOpen && state.mobilePane === 'workbench'} onClick={() => selectRegion('workbench')}>内容</button>}
          <button type="button" aria-label="果铃AI" title="果铃AI" aria-pressed={assistantVisible && (!narrow || editorFocus || state.mobilePane === 'chat')} onClick={() => selectRegion('chat')}><Sparkles size={18} /></button>
          <details
            ref={layoutMenu}
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
            </summary>
            {layoutMenuOpen && (
              <div
                className="lesson-popover-backdrop"
                aria-hidden="true"
                onClick={() => setLayoutMenuOpen(false)}
              />
            )}
            <div className="lesson-layout-popover">
              {!editorFocus && <div className="lesson-layout-presets" role="group" aria-label="常用布局">
                <button type="button" aria-pressed={!layout.prefs.navCollapsed && !layout.prefs.contentClosed && !layout.prefs.chatClosed && explorerVisible && conversationsVisible} onClick={() => { layout.applyPreset('standard'); setLayoutMenuOpen(false) }}><LayoutPresetPreview preset="standard" /><span>标准工作台</span></button>
                <button type="button" aria-pressed={layout.prefs.navCollapsed && !layout.prefs.contentClosed && layout.prefs.chatClosed} onClick={() => { layout.applyPreset('content'); setLayoutMenuOpen(false) }}><LayoutPresetPreview preset="content" /><span>专注内容</span></button>
                <button type="button" aria-pressed={layout.prefs.navCollapsed && !layout.prefs.contentClosed && !layout.prefs.chatClosed} onClick={() => { layout.applyPreset('content-ai'); setLayoutMenuOpen(false) }}><LayoutPresetPreview preset="content-ai" /><span>内容＋果铃AI</span></button>
              </div>}
              <button type="button" onClick={() => { toggleExplorer(); setLayoutMenuOpen(false) }}>
                {explorerVisible ? "收起" : "展开"}资源管理器
              </button>
              <button type="button" onClick={() => { toggleConversations(); setLayoutMenuOpen(false) }}>
                {conversationsVisible ? "收起" : "展开"}会话列表
              </button>
              <button type="button" onClick={() => { toggleAssistant(); setLayoutMenuOpen(false) }}>
                {assistantVisible ? "收起" : "展开"}果铃AI
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
            aria-label="新建 果铃工程"
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              void actions.run(actions.createLesson);
            }}
          >
            <h3>新建 果铃工程</h3>
            <label>
              名称
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
                      state.name.trim() || "名称",
                    )
                  : undefined
              }
            >
              将创建：
              {state.selectedDirectory &&
                join(state.selectedDirectory, state.name.trim() || "名称")}
            </p>
            <div className="lesson-modal-actions">
              <button
                type="submit"
                className="lesson-primary-action"
                disabled={state.busy || !state.name.trim()}
              >
                创建
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

/** Diagrams describe the existing presets; visibility remains owned by the layout controller. */
function LayoutPresetPreview({ preset }: { preset: 'standard' | 'content' | 'content-ai' }) {
  return <svg className="lesson-layout-preview" viewBox="0 0 64 42" aria-hidden="true" focusable="false">
    <rect x="1" y="1" width="62" height="40" rx="4" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path d="M2 8h60" fill="none" stroke="currentColor" opacity=".6" />
    <path d="M5 5h8m3 0h4" fill="none" stroke="currentColor" strokeLinecap="round" />
    {preset === 'standard' ? <>
      <rect x="3" y="10" width="13" height="29" rx="1" fill="currentColor" opacity=".16" />
      <path d="M3 24h13M18 9v31M47 9v31" fill="none" stroke="currentColor" opacity=".5" />
      <rect x="49" y="10" width="12" height="29" rx="1" fill="currentColor" opacity=".22" />
      <rect x="22" y="15" width="21" height="18" rx="1" fill="currentColor" opacity=".08" />
    </> : <>
      <rect x="6" y="12" width={preset === 'content' ? 52 : 36} height="25" rx="2" fill="currentColor" opacity=".08" />
      {preset === 'content-ai' && <><path d="M46 9v31" fill="none" stroke="currentColor" opacity=".5" /><rect x="48" y="10" width="13" height="29" rx="1" fill="currentColor" opacity=".22" /></>}
    </>}
  </svg>
}
