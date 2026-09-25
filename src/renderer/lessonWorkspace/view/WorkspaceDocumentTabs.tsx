import { useState } from 'react'
import type { LessonWorkspaceViewProps } from './lessonWorkspaceViewTypes'
import type { WorkbenchLayoutController } from './useWorkbenchLayoutPrefs'
import type { LessonFileTab } from '../controller/useDocumentTabsController'
export function WorkspaceDocumentTabs({ props, layout, hidden = false }: { props: LessonWorkspaceViewProps; layout: WorkbenchLayoutController; hidden?: boolean }) {
 const { state, actions, tabs } = props;
 const [newTabMenuOpen, setNewTabMenuOpen] = useState(false);
 const [newDocName, setNewDocName] = useState('');
 const tabLabels = distinguishTabNames(tabs.tabs);
 const revealContent = () => { layout.setContentClosed(false); actions.setMobilePane('workbench') }
 const createMarkdown = async () => {
   await tabs.createMarkdown(newDocName.trim() || undefined)
   revealContent(); setNewDocName(''); setNewTabMenuOpen(false)
 }

 return (
      <div className="workspace-document-tabs" hidden={hidden}>
      <div role="tablist" aria-label="材料、教学文档与课件">
        {state.lesson && (
          <button
            type="button"
            role="tab"
            aria-selected={tabs.activeTab === "materials"}
            onClick={() => tabs.setActiveTab("materials")}
          >
            材料
          </button>
        )}
        {tabs.tabs.map((tab, index) => (
          <TabButton
            key={tab.id}
            tab={tab}
            label={tabLabels[index]!}
            active={tabs.activeTab === tab.id}
            onSelect={() => { tabs.setActiveTab(tab.id); revealContent() }}
            onClose={() => {
              void actions.run(async () => {
                await tabs.closeTab(tab);
              });
            }}
          />
        ))}
      </div>
        <details
          className="lesson-new-tab lesson-workspace-more"
          open={newTabMenuOpen}
          onToggle={(event) =>
            setNewTabMenuOpen(
              (event.currentTarget as HTMLDetailsElement).open,
            )
          }
        >
          <summary aria-label="新建标签页" title="新建文档或课件">
            ＋
          </summary>
          {newTabMenuOpen && (
            <div
              className="lesson-popover-backdrop"
              aria-hidden="true"
              onClick={() => setNewTabMenuOpen(false)}
            />
          )}
          <div className="lesson-new-tab-popover">
            <p className="lesson-eyebrow">新建</p>
            <label>
              Markdown 文档名
              <input
                value={newDocName}
                onChange={(event) => setNewDocName(event.target.value)}
                placeholder="未命名文档"
              />
            </label>
            <button
              type="button"
              disabled={state.busy}
              onClick={() => {
                void actions.run(createMarkdown);
              }}
            >
              创建文档
            </button>
            <button
              type="button"
              disabled={state.busy}
              onClick={() => {
                setNewTabMenuOpen(false);
                void actions.run(async () => { await actions.newCourse(); revealContent() });
              }}
            >
              新建课件
            </button>
          </div>
        </details>
      </div>
 );
}
function TabButton({
  tab,
  label,
  active,
  onSelect,
  onClose,
}: {
  tab: LessonFileTab;
  label: string;
  active: boolean;
  onSelect(): void;
  onClose(): void;
}) {
  return (
    <span className="lesson-workbench-tab">
      <button
        type="button"
        role="tab"
        title={tab.path || label}
        aria-selected={active}
        onClick={onSelect}
      >
        <span>{label}</span>
        {tab.dirty && <i aria-label="未保存" title="未保存" />}
      </button>
      <button
        type="button"
        className="lesson-icon-button"
        aria-label={`关闭 ${label}`}
        onClick={onClose}
      >
        ×
      </button>
    </span>
  );
}

/** Give colliding basenames the shortest directory suffix that identifies each tab. */
function distinguishTabNames(tabs: readonly LessonFileTab[]): string[] {
  const labels = tabs.map(tab => tab.name)
  const groups = new Map<string, number[]>()
  tabs.forEach((tab, index) => {
    const key = tab.name.toLocaleLowerCase()
    groups.set(key, [...(groups.get(key) ?? []), index])
  })
  for (const indexes of groups.values()) {
    if (indexes.length < 2) continue
    const directories = indexes.map(index => tabs[index]!.path.replace(/\\/g, '/').split('/').filter(Boolean).slice(0, -1))
    const maximum = Math.max(1, ...directories.map(parts => parts.length))
    let suffixes: string[] = []
    for (let depth = 1; depth <= maximum; depth++) {
      suffixes = directories.map(parts => parts.slice(-depth).join(' / ') || '未保存')
      if (new Set(suffixes.map(value => value.toLocaleLowerCase())).size === indexes.length) break
    }
    const totals = new Map<string, number>(), used = new Map<string, number>()
    suffixes.forEach(value => totals.set(value.toLocaleLowerCase(), (totals.get(value.toLocaleLowerCase()) ?? 0) + 1))
    indexes.forEach((index, offset) => {
      const suffix = suffixes[offset]!, key = suffix.toLocaleLowerCase()
      const ordinal = (used.get(key) ?? 0) + 1; used.set(key, ordinal)
      labels[index] = `${suffix}${(totals.get(key) ?? 0) > 1 ? ` (${ordinal})` : ''} / ${tabs[index]!.name}`
    })
  }
  return labels
}

