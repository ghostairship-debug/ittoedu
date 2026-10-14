import { useLayoutEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { LessonWorkspaceViewProps } from './lessonWorkspaceViewTypes'
import type { WorkbenchLayoutController } from './useWorkbenchLayoutPrefs'
import type { LessonFileTab } from '../controller/useDocumentTabsController'
import { useContextMenu } from '../../editing/commands/CommandMenu'
import { documentTabCommands } from './documentTabCommands'
export function WorkspaceDocumentTabs({ props, layout, hidden = false }: { props: LessonWorkspaceViewProps; layout: WorkbenchLayoutController; hidden?: boolean }) {
 const { state, actions, tabs } = props;
 const tabList = useRef<HTMLDivElement>(null);
 useLayoutEffect(() => {
  const list = tabList.current, active = list?.querySelector<HTMLElement>('[aria-selected="true"]');
  if (!list || !active || hidden) return;
  const item = active.closest('.lesson-workbench-tab') ?? active;
  const bounds = item.getBoundingClientRect(), viewport = list.getBoundingClientRect();
  if (bounds.left < viewport.left) list.scrollLeft += bounds.left - viewport.left;
  else if (bounds.right > viewport.right) list.scrollLeft += bounds.right - viewport.right;
 }, [tabs.activeTab, tabs.tabs, hidden]);
 const [newTabMenuOpen, setNewTabMenuOpen] = useState(false);
 const [newDocName, setNewDocName] = useState('');
 const [renaming, setRenaming] = useState<LessonFileTab | null>(null), [renameName, setRenameName] = useState('');
 const renameTab = async () => {
   if (!renaming?.documentId) throw new Error('这个标签没有可重命名的文档')
   const api = props.documentPort.documents
   if (!api?.rename) throw new Error('重命名服务尚未连接，请重新打开应用')
   if (!await tabs.drainAll([renaming.documentId])) throw new Error('当前编辑尚未同步，请完成编辑后再重命名')
   const snapshot = await api.read(renaming.documentId)
   const saved = await api.rename(snapshot.documentId, snapshot.epoch, renameName.trim())
   tabs.updateDirty(renaming.path, saved.dirty); setRenaming(null); actions.refreshTree()
 }
 const tabLabels = distinguishTabNames(tabs.tabs);
 const revealContent = () => { layout.setContentClosed(false); actions.setMobilePane('workbench') }
 const createMarkdown = async () => {
   await tabs.createMarkdown(newDocName.trim() || undefined)
   revealContent(); setNewDocName(''); setNewTabMenuOpen(false)
 }
 const tabMenu = useContextMenu();
 // Closing stops at the first tab that asks the teacher to keep a draft.
 const closeTabs = (targets: readonly LessonFileTab[]) => {
   void actions.run(async () => { for (const target of targets) if (!(await tabs.closeTab(target))) return });
 };
 const openTabMenu = (at: { x: number; y: number }, tab: LessonFileTab, index: number) => {
   const all = [...tabs.tabs];
   tabMenu.open(at, `${tabLabels[index]} 标签菜单`, documentTabCommands({ index, count: all.length, saved: Boolean(tab.path) }, {
     close: () => closeTabs([tab]),
     rename: tab.documentId ? () => { setRenaming(tab); setRenameName(tab.name) } : undefined,
     closeOthers: () => closeTabs(all.filter(other => other.id !== tab.id)),
     closeRight: () => closeTabs(all.slice(index + 1)),
     closeAll: () => closeTabs(all),
     copyPath: () => { void navigator.clipboard.writeText(tab.path).catch(() => {}) },
     reveal: () => { void actions.run(async () => {
       if (tab.documentId) {
         if (!props.documentPort.documents?.reveal) throw new Error('文档服务尚未连接')
         await props.documentPort.documents.reveal(tab.documentId)
         return
       }
       const files = props.workspaceFiles, directory = state.workspace ?? tab.lesson?.identity.normalizedDirectory
       if (!files || !directory) throw new Error('工作空间文件服务尚未连接')
       const root = await files({ type: 'root', directory })
       const filename = tab.path.replace(/\\/g, '/'), rootPath = root.resolvedPath.replace(/\\/g, '/').replace(/\/$/, '')
       if (!filename.toLowerCase().startsWith(`${rootPath.toLowerCase()}/`)) throw new Error('该文件不在当前授权工作空间内')
       const parts = filename.slice(rootPath.length + 1).split('/'); let entryId = root.rootEntryId
       for (const name of parts) {
         let cursor: string | undefined, found: string | undefined
         do {
           const page = await files({ type: 'list', workspaceId: root.workspaceId, directoryEntryId: entryId, cursor })
           const entry = page.entries.find(item => item.status === 'accessible' && item.name === name)
           if (entry?.status === 'accessible') found = entry.entryId
           cursor = page.nextCursor
         } while (!found && cursor)
         if (!found) throw new Error('文件位置已改变，请刷新文件列表')
         entryId = found
       }
       await files({ type: 'reveal', operationId: crypto.randomUUID(), workspaceId: root.workspaceId, entryId })
     }) },
     openExternal: () => {
       void actions.run(async () => {
         const result = await props.operation({ operation: 'open-external', path: tab.path });
         if (result.opened === false) throw new Error(`无法用系统应用打开 ${tab.name}：${result.openError ?? '没有可用的关联程序'}`);
       });
     },
   }));
 };

 return (
      <div className="workspace-document-tabs" hidden={hidden}>
      <div ref={tabList} role="tablist" aria-label="打开的文件">
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
            onMenu={at => openTabMenu(at, tab, index)}
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
          <summary aria-label="新建标签页" title="新建文档或 果铃工程">
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
              文档名
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
              新建 MD 文档
            </button>
            <button type="button" disabled={state.busy} onClick={() => void actions.run(async () => {
              await tabs.createText(newDocName.trim() || undefined); revealContent(); setNewDocName(''); setNewTabMenuOpen(false)
            })}>新建 TXT 文档</button>
            <button
              type="button"
              disabled={state.busy}
              onClick={() => {
                setNewTabMenuOpen(false);
                void actions.run(async () => { await actions.newCourse(); revealContent() });
              }}
            >
              新建 果铃工程
            </button>
          </div>
        </details>
        {tabMenu.element}
        {renaming && <div className="lesson-modal-backdrop" role="presentation"><form className="lesson-modal" role="dialog" aria-modal="true" aria-label="重命名文档" onSubmit={event => { event.preventDefault(); void actions.run(renameTab) }}>
          <h3>重命名</h3><label>名称<input aria-label="文档名称" autoFocus value={renameName} onChange={event => setRenameName(event.target.value)} onFocus={event => { const suffix = event.target.value.lastIndexOf('.'); event.target.setSelectionRange(0, suffix > 0 ? suffix : event.target.value.length) }} /></label>
          <p>保留文件扩展名；作品内容和未保存的编辑保持不变。</p>
          <div className="lesson-modal-actions"><button type="button" onClick={() => setRenaming(null)}>取消</button><button type="submit" disabled={state.busy || !renameName.trim()}>保存名称</button></div>
        </form></div>}
      </div>
 );
}
function TabButton({
  tab,
  label,
  active,
  onSelect,
  onClose,
  onMenu,
}: {
  tab: LessonFileTab;
  label: string;
  active: boolean;
  onSelect(): void;
  onClose(): void;
  onMenu(at: { x: number; y: number }): void;
}) {
  return (
    <span className="lesson-workbench-tab" data-selected={active} onContextMenu={event => { event.preventDefault(); onMenu({ x: event.clientX, y: event.clientY }) }}>
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
        title={`关闭 ${label}`}
        onClick={event => { event.stopPropagation(); onClose() }}
      >
        <X size={14} aria-hidden="true" />
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

