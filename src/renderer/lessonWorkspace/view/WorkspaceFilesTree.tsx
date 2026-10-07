import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type DragEvent } from 'react'
import { ChevronDown, ChevronRight, File, FileCode2, FileText, Folder, FolderOpen, Plus, Presentation, RotateCw } from 'lucide-react'
import type { LessonDesktopRequest, LessonDesktopResult, LessonDirectoryEntry } from '../../../shared/lessonDesktopContract'
import { type RegisteredWorkspaceRoot, type WorkspaceFilesAPI, type WorkspaceFilesRequest, type WorkspaceListItem, type WorkspaceOperationResult } from '../../../shared/workbench/workspaceFiles'
import type { SaveDirectoryContext } from '../../../shared/workbench/desktop'
import './WorkspaceFilesTree.css'
import { computeDefaultName, normalizeNewFilename, getStemSelectionRange, uniqueFilename, type CreateFileType } from '../workspaceFilesNaming'
import { REVEAL_IN_EXPLORER_EVENT, takePendingReveal, type RevealInExplorerDetail } from '../../workbench/revealInExplorer'
import { SLIDE_CANVAS_PRESETS } from '../../../shared/slideCanvas'
import { snapshotWorkspaceDrop } from './workspaceDropFiles'
import { parseWorkspaceEntryDrag, WORKSPACE_ENTRIES_DRAG_TYPE, writeWorkspaceEntryDrag } from '../workspaceMediaDrag'
import { confirmPptxLosses } from '../../project/confirmPptxLosses'
import { createCourseFromPptx, pptxCourseArchive, pptxCourseStem } from '../../project/pptxCourseCreation'
import { CommandMenuItems, ContextMenu, moveMenuFocus } from '../../editing/commands/CommandMenu'
import { explorerContextCommands, explorerNewCommands, type ExplorerCommandPorts } from './explorerCommands'

type Entry = Extract<WorkspaceListItem, { status: 'accessible' }>
type Dialog = 'create-markdown' | 'create-course' | 'create-text' | 'create-html' | 'mkdir' | 'rename' | 'copy' | 'move' | 'trash'
type Row = { entry: Entry; parentId: string }
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
function icon(name: string) { return /\.(md|markdown)$/i.test(name) ? <FileText size={16} /> : /\.h5lesson$/i.test(name) ? <Presentation size={16} /> : /\.html?$/i.test(name) ? <FileCode2 size={16} /> : <File size={16} /> }
export function WorkspaceFilesTree({ directory, files, operation, refreshVersion = 0, onFile, onDirectory, onScope, onSaveDirectoryChange, onImportHtml, prepareCurrentCopy }: {
  directory: string; files: WorkspaceFilesAPI; operation?(request: LessonDesktopRequest): Promise<LessonDesktopResult>; refreshVersion?: number
  onFile(entry: LessonDirectoryEntry): void; onDirectory(path: string): void
  onScope?(path: string, kind: 'folder' | 'file', workspaceId?: string): void
  onSaveDirectoryChange?(directory: SaveDirectoryContext | null): void
  onImportHtml?(directory: SaveDirectoryContext, sourceEntryId?: string): void
  prepareCurrentCopy?(): Promise<boolean>
}) {
  const [root, setRoot] = useState<RegisteredWorkspaceRoot>()
  const [pages, setPages] = useState<Record<string, WorkspaceListItem[]>>({})
  const [expanded, setExpanded] = useState(new Set<string>()), [selection, setSelection] = useState(new Set<string>())
  const [anchor, setAnchor] = useState<string>(), [parentId, setParentId] = useState<string>()
  const [dialog, setDialog] = useState<Dialog>(), [name, setName] = useState('')
  // One Slide canvas size per course, chosen when the course is created (M19).
  const [canvasPreset, setCanvasPreset] = useState<string>(SLIDE_CANVAS_PRESETS[0]!.id)
  const [destination, setDestination] = useState<string>(), [destinations, setDestinations] = useState<{ id: string; name: string }[]>([])
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [notice, setNotice] = useState('')
  const [results, setResults] = useState<WorkspaceOperationResult>(), [retry, setRetry] = useState<WorkspaceFilesRequest>()
  const [clipboard, setClipboard] = useState<{ workspaceId: string; ids: string[]; type: 'copy' | 'move' }>()
  const [copyVersion, setCopyVersion] = useState<'disk' | 'current'>('disk')
  const [menu, setMenu] = useState<{ x: number; y: number; directoryEntryId: string; htmlImport: 'pick' | 'selected' | null; sourceEntryId?: string }>(), [dropTarget, setDropTarget] = useState<string>()
  const active = useRef<RegisteredWorkspaceRoot | undefined>(undefined), epoch = useRef(0), lock = useRef(false)
  const scopeTicket = useRef(0)
  const saveDirectoryListener = useRef(onSaveDirectoryChange); saveDirectoryListener.current = onSaveDirectoryChange
  const loadTickets = useRef(new Map<string, number>())
  const pagesRef = useRef(pages); pagesRef.current = pages
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const createMenu = useRef<HTMLDetailsElement>(null)
  // "从 PPT 新建 H5 演示" picks a file here and writes the new presentation into the folder chosen when it was asked for.
  const pptxInput = useRef<HTMLInputElement>(null), pptxTarget = useRef<string | undefined>(undefined)
  // The pane clips its content, so the create options open at a fixed window position.
  const [createAt, setCreateAt] = useState<{ left: number; top: number }>()
  const dialogRef = useRef<HTMLElement>(null), dialogReturnFocus = useRef<HTMLElement | null>(null)
  const rows: Row[] = []
  const flatten = (id: string) => { for (const entry of pages[id] ?? []) if (entry.status === 'accessible') { rows.push({ entry, parentId: id }); if (entry.kind === 'directory' && expanded.has(entry.entryId)) flatten(entry.entryId) } }
  if (root) flatten(root.rootEntryId)
  const selected = rows.filter(row => selection.has(row.entry.entryId)), single = selected.length === 1 ? selected[0].entry : undefined
  const targetDirectory = parentId ?? root?.rootEntryId
  const load = useCallback(async (id: string, current: RegisteredWorkspaceRoot, generation = epoch.current): Promise<WorkspaceListItem[]> => {
    const ticket = (loadTickets.current.get(id) ?? 0) + 1
    loadTickets.current.set(id, ticket)
    const entries: WorkspaceListItem[] = []; let cursor: string | undefined
    do { const page = await files({ type: 'list', workspaceId: current.workspaceId, directoryEntryId: id, limit: 200, ...(cursor ? { cursor } : {}) }); entries.push(...page.entries); cursor = page.nextCursor } while (cursor)
    if (generation !== epoch.current || ticket !== loadTickets.current.get(id)) return entries
    setPages(value => generation !== epoch.current || ticket !== loadTickets.current.get(id) || JSON.stringify(value[id]) === JSON.stringify(entries)
      ? value : { ...value, [id]: entries }); pagesRef.current = { ...pagesRef.current, [id]: entries }; return entries
  }, [files])
  useEffect(() => {
    const generation = ++epoch.current
    loadTickets.current.clear()
    active.current = undefined; saveDirectoryListener.current?.(null); setRoot(undefined); setPages({}); setExpanded(new Set()); setSelection(new Set()); setDialog(undefined); setClipboard(undefined); setError(''); setResults(undefined); setBusy(false)
    void files({ type: 'root', directory }).then(async current => {
      if (generation !== epoch.current) return
      active.current = current; setRoot(current); setParentId(current.rootEntryId)
      saveDirectoryListener.current?.({ workspaceId: current.workspaceId, directoryEntryId: current.rootEntryId })
      await load(current.rootEntryId, current, generation)
      try { await files({ type: 'watch', workspaceId: current.workspaceId }) } catch { if (generation === epoch.current) setNotice('自动监视不可用，可使用刷新恢复文件列表') }
    }).catch(reason => { if (generation === epoch.current) setError(message(reason)) })
    return () => { epoch.current++; active.current = undefined; saveDirectoryListener.current?.(null) }
  }, [directory, files, load])
  const refresh = useCallback(async () => {
    const current = active.current
    if (!current) return
    await load(current.rootEntryId, current)
    await Promise.all([...expanded].map(id => load(id, current).catch(() => { setExpanded(value => { const next = new Set(value); next.delete(id); return next }) })))
  }, [expanded, load])
  const refreshRef = useRef(refresh); refreshRef.current = refresh
  useEffect(() => { void refresh().catch(reason => setError(message(reason))) }, [refreshVersion, refresh])
  const subscribe = window.desktopAPI?.onWorkspaceFilesChanged ?? files.subscribe
  useEffect(() => subscribe?.(event => { if (event.workspaceId === active.current?.workspaceId) void refreshRef.current().catch(reason => setError(message(reason))) }), [subscribe])
  // Compatibility for read-only test/embedded ports without a push subscription; desktop uses the watcher.
  useEffect(() => { if (subscribe) return; const timer = setInterval(() => { void refreshRef.current().catch(() => {}) }, 2500); return () => clearInterval(timer) }, [subscribe])
  const close = () => { setDialog(undefined); setRetry(undefined); setMenu(undefined); setError('') }
  useLayoutEffect(() => {
    if (dialog) {
      const input = dialogRef.current?.querySelector<HTMLInputElement>('input[aria-label="文件名称"]')
      if (input) {
        input.focus()
        if (dialog !== 'rename') {
          const [start, end] = getStemSelectionRange(input.value)
          input.setSelectionRange(start, end)
        }
        return
      }
      dialogRef.current?.querySelector<HTMLElement>('input, select, button:not(:disabled)')?.focus()
      return
    }
    const previous = dialogReturnFocus.current
    dialogReturnFocus.current = null
    if (previous) requestAnimationFrame(() => {
      if (previous.isConnected) previous.focus()
      else buttons.current.get(anchor ?? '')?.focus()
    })
  }, [dialog, anchor])
  const open = async (entry: Entry) => {
    if (!root) return
    const resolved = await files({ type: 'resolve', workspaceId: root.workspaceId, entryId: entry.entryId })
    if (entry.kind === 'file') onFile({ name: entry.name, kind: 'file', path: resolved.resolvedPath })
    else { onDirectory(resolved.resolvedPath); setExpanded(value => new Set([...value, entry.entryId])); await load(entry.entryId, root) }
  }
  const choose = (row: Row, event?: Pick<MouseEvent, 'ctrlKey' | 'metaKey' | 'shiftKey'>) => {
    const directoryEntryId = row.entry.kind === 'directory' ? row.entry.entryId : row.parentId
    setMenu(undefined); setParentId(directoryEntryId)
    if (root) onSaveDirectoryChange?.({ workspaceId: root.workspaceId, directoryEntryId })
    if (event?.shiftKey && anchor) {
      const from = rows.findIndex(value => value.entry.entryId === anchor), to = rows.findIndex(value => value.entry.entryId === row.entry.entryId)
      setSelection(new Set(rows.slice(Math.max(0, Math.min(from, to)), Math.max(from, to) + 1).map(value => value.entry.entryId)))
    } else if (event?.ctrlKey || event?.metaKey) setSelection(value => { const next = new Set(value); if (next.has(row.entry.entryId)) next.delete(row.entry.entryId); else next.add(row.entry.entryId); return next })
    else setSelection(new Set([row.entry.entryId]))
    if (!event?.shiftKey) setAnchor(row.entry.entryId)
    if (root && onScope) {
      const ticket = ++scopeTicket.current, generation = epoch.current
      void files({ type: 'resolve', workspaceId: root.workspaceId, entryId: row.entry.entryId })
        .then(value => { if (ticket === scopeTicket.current && generation === epoch.current) onScope(value.resolvedPath, row.entry.kind === 'file' ? 'file' : 'folder', root.workspaceId) })
        .catch(reason => { if (ticket === scopeTicket.current && generation === epoch.current) setError(message(reason)) })
    }
  }
  const browse = async (id: string) => {
    if (!root) return
    setDestination(id); await load(id, root)
    const page: Entry[] = []; let cursor: string | undefined
    do { const next = await files({ type: 'list', workspaceId: root.workspaceId, directoryEntryId: id, cursor, limit: 200 }); page.push(...next.entries.filter((entry): entry is Entry => entry.status === 'accessible' && entry.kind === 'directory')); cursor = next.nextCursor } while (cursor)
    setDestinations(value => [...value, ...page.filter(entry => !value.some(item => item.id === entry.entryId)).map(entry => ({ id: entry.entryId, name: entry.name }))])
  }
  const revealItem = useCallback(async (detail: RevealInExplorerDetail) => {
    const ticket = ++scopeTicket.current
    const currentRoot = active.current
    if (!currentRoot) { setNotice('工作空间未就绪'); return }
    if (detail.workspaceId && detail.workspaceId !== currentRoot.workspaceId) { setNotice('目标文件位于其他工作空间'); return }
    let requestedPath = (detail.path ?? '').replace(/\\/g, '/').trim()
    if (/^(?:[A-Za-z]:\/|\/)/.test(requestedPath)) {
      const rootPath = currentRoot.resolvedPath.replace(/\\/g, '/').replace(/\/+$/, '')
      const compare = (value: string) => /^[A-Za-z]:\//.test(rootPath) || rootPath.startsWith('//') ? value.toLowerCase() : value
      if (compare(requestedPath.replace(/\/+$/, '')) === compare(rootPath)) requestedPath = ''
      else if (compare(requestedPath).startsWith(`${compare(rootPath)}/`)) requestedPath = requestedPath.slice(rootPath.length + 1)
      else {
        if (detail.open && detail.kind === 'file') {
          onFile({ name: requestedPath.split('/').pop() ?? requestedPath, kind: 'file', path: detail.path ?? requestedPath })
        } else setNotice('目标文件位于当前工作空间之外')
        return
      }
    }
    const cleanPath = requestedPath.replace(/^\/+|\/+$/g, '')
    if (!cleanPath) {
      onScope?.(currentRoot.resolvedPath, 'folder', currentRoot.workspaceId)
      setSelection(new Set()); setParentId(currentRoot.rootEntryId)
      onSaveDirectoryChange?.({ workspaceId: currentRoot.workspaceId, directoryEntryId: currentRoot.rootEntryId })
      setMenu(undefined)
      requestAnimationFrame(() => { document.querySelector<HTMLElement>('.workspace-tree-root')?.scrollIntoView?.({ block: 'nearest' }) })
      return
    }
    const segments = cleanPath.split('/'), generation = epoch.current
    let currentDirId = currentRoot.rootEntryId
    const ancestorIds: string[] = []
    let targetEntry: Entry | undefined

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i], isLast = i === segments.length - 1
      let entries = pagesRef.current[currentDirId]
      if (!entries || !entries.some(e => e.status === 'accessible' && e.name === segment)) {
        entries = await load(currentDirId, currentRoot, generation)
      }
      if (generation !== epoch.current || ticket !== scopeTicket.current) return
      const found = entries?.find((e): e is Entry => e.status === 'accessible' && e.name === segment)
      if (!found) { setNotice(`未在资源管理器中找到：${cleanPath}`); return }
      if (isLast) { targetEntry = found }
      else {
        if (found.kind !== 'directory') { setNotice(`路径包含非文件夹：${segment}`); return }
        ancestorIds.push(found.entryId); currentDirId = found.entryId
      }
    }
    if (!targetEntry || generation !== epoch.current || ticket !== scopeTicket.current) return
    if (ancestorIds.length > 0) setExpanded(prev => new Set([...prev, ...ancestorIds]))
    const directoryEntryId = targetEntry.kind === 'directory' ? targetEntry.entryId : currentDirId
    setParentId(directoryEntryId)
    onSaveDirectoryChange?.({ workspaceId: currentRoot.workspaceId, directoryEntryId })
    setSelection(new Set([targetEntry.entryId]))
    setAnchor(targetEntry.entryId)
    setMenu(undefined)
    try {
      const resolved = await files({ type: 'resolve', workspaceId: currentRoot.workspaceId, entryId: targetEntry.entryId })
      if (ticket === scopeTicket.current && generation === epoch.current) {
        onScope?.(resolved.resolvedPath, targetEntry.kind === 'file' ? 'file' : 'folder', currentRoot.workspaceId)
        if (detail.open && targetEntry.kind === 'file') onFile({ name: targetEntry.name, kind: 'file', path: resolved.resolvedPath })
      }
    } catch (reason) {
      if (ticket === scopeTicket.current && generation === epoch.current) setError(message(reason))
    }
    if (ticket !== scopeTicket.current || generation !== epoch.current) return
    const scrollTarget = () => {
      const element = buttons.current.get(targetEntry!.entryId) ?? document.querySelector<HTMLElement>(`[data-entry-id="${targetEntry!.entryId}"]`)
      element?.scrollIntoView?.({ block: 'nearest' })
    }
    scrollTarget()
    requestAnimationFrame(() => { if (ticket === scopeTicket.current && generation === epoch.current) scrollTarget() })
  }, [files, load, onScope, onSaveDirectoryChange, onFile])
  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<RevealInExplorerDetail>
      if (custom.detail) { takePendingReveal(); void revealItem(custom.detail) }
    }
    window.addEventListener(REVEAL_IN_EXPLORER_EVENT, handler)
    return () => window.removeEventListener(REVEAL_IN_EXPLORER_EVENT, handler)
  }, [revealItem])
  // A request made while the explorer was closed is revealed once the workspace root is ready.
  useEffect(() => {
    if (!root) return
    const pending = takePendingReveal()
    if (pending) void revealItem(pending)
  }, [root, revealItem])

  const begin = async (type: Dialog) => {
    if (type === 'trash') { if (root && selected.length) await run({ type: 'trash', operationId: crypto.randomUUID(), workspaceId: root.workspaceId, entryIds: selected.map(row => row.entry.entryId) }); return }
    dialogReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setMenu(undefined); setError(''); setResults(undefined); setRetry(undefined)
    if (type === 'rename') {
      setName(single?.name ?? '')
      setDialog(type)
    } else if (type === 'create-markdown' || type === 'create-course' || type === 'create-text' || type === 'create-html' || type === 'mkdir') {
      const targetDir = targetDirectory
      let entries = targetDir ? pagesRef.current[targetDir] : undefined
      if (!entries && targetDir && root) {
        entries = await load(targetDir, root)
      }
      setName(type === 'create-html' ? uniqueFilename('新建 HTML 文档', '.html', entries) : computeDefaultName(type, entries))
      if (type === 'create-course') setCanvasPreset(SLIDE_CANVAS_PRESETS[0]!.id)
      setDialog(type)
    } else {
      setName('')
      setDialog(type)
    }
    if ((type === 'copy' || type === 'move') && root) { setCopyVersion('disk'); setDestinations([{ id: root.rootEntryId, name: directory }]); await browse(root.rootEntryId) }
  }
  const run = async (request: WorkspaceFilesRequest) => {
    if (!root || lock.current) return
    const generation = epoch.current
    lock.current = true; setBusy(true); setError(''); setMenu(undefined); setRetry(undefined)
    try {
      if (request.type === 'copy' && request.sourceVersion === 'current') {
        if (!prepareCurrentCopy || !await prepareCurrentCopy()) throw new Error('当前输入尚未同步，请完成输入或处理冲突后再复制当前稿。')
        if (generation !== epoch.current) return
      }
      const result = await files(request) as WorkspaceOperationResult
      if (generation !== epoch.current) return
      setResults(result)
      const choices = result.items.filter(item => item.error?.code === 'resource-choice-required').map(item => item.sourceEntryId).filter((id): id is string => !!id)
      if (choices.length && (request.type === 'copy' || request.type === 'move')) { setRetry({ ...request, sourceEntryIds: choices }); setDialog(request.type) }
      if (result.status === 'success') setNotice('文件操作已完成')
      else setNotice(result.status === 'partial' ? '部分文件已完成，请查看逐项结果' : result.status === 'cancelled' ? '操作已取消，原文件保留' : '文件操作未完成')
      const successes = new Set(result.items.filter(item => item.status === 'success').map(item => item.sourceEntryId))
      if ((request.type === 'move' || request.type === 'trash') && successes.size) {
        // A watcher can populate the destination before refreshing the source.
        // Remove moved handles from cached pages before loading their new location.
        setPages(value => Object.fromEntries(Object.entries(value).map(([id, entries]) => [id,
          entries.filter(entry => entry.status !== 'accessible' || !successes.has(entry.entryId))])))
      }
      if (request.type === 'trash') setSelection(value => new Set([...value].filter(id => !successes.has(id))))
      if (request.type === 'move' || request.type === 'copy' || request.type === 'create-markdown' || request.type === 'create-course' || request.type === 'create-text' || request.type === 'mkdir' || request.type === 'import-files') {
        setExpanded(value => new Set([...value, request.targetDirectoryId])); await load(request.targetDirectoryId, root)
        if (request.type === 'move') { setParentId(request.targetDirectoryId); onSaveDirectoryChange?.({ workspaceId: root.workspaceId, directoryEntryId: request.targetDirectoryId }) }
      }
      if (request.type === 'move') setClipboard(value => value ? { ...value, ids: value.ids.filter(id => !successes.has(id)) } : value)
      try { await refresh() }
      finally {
        if (result.status === 'success') {
          setDialog(undefined)
          if (request.type === 'create-markdown' || request.type === 'create-course' || request.type === 'create-text') {
            const item = result.items.find(i => i.status === 'success' && i.targetPath)
            if (item?.targetPath) {
              const createdName = item.targetPath.split(/[/\\]/).pop() ?? request.name
              onFile({ name: createdName, kind: 'file', path: item.targetPath })
            }
          }
        }
      }
      return result
    } catch (reason) { if (generation === epoch.current) setError(message(reason)) }
    finally { lock.current = false; if (generation === epoch.current) setBusy(false) }
  }
  const common = () => ({ operationId: crypto.randomUUID(), workspaceId: root!.workspaceId })
  // A new H5 presentation made from a PPT, written into the folder like any new file and then opened (M21).
  const fromPptx = async (source: () => Promise<{ name: string; bytes: Uint8Array }>, directoryId: string) => {
    if (!root || lock.current) return
    const current = root, generation = epoch.current
    lock.current = true; setBusy(true); setError(''); setMenu(undefined); setResults(undefined)
    let made: { name: string; archive: Uint8Array<ArrayBuffer>; issues: number } | undefined
    try {
      const file = await source()
      const stem = pptxCourseStem(file.name)
      const course = await createCourseFromPptx(file.bytes, stem)
      if (!await confirmPptxLosses(file.name, course.issues) || generation !== epoch.current) return
      const entries = pagesRef.current[directoryId] ?? await load(directoryId, current)
      made = { name: uniqueFilename(stem, '.h5lesson', entries), archive: pptxCourseArchive(course), issues: course.issues.length }
    } catch (reason) { if (generation === epoch.current) setError(message(reason)) }
    finally { lock.current = false; if (generation === epoch.current) setBusy(false) }
    if (!made || generation !== epoch.current) return
    const result = await run({ type: 'create-course', ...common(), targetDirectoryId: directoryId, name: made.name, archive: made.archive })
    if (result?.status === 'success' && made.issues) setNotice(`已从 PPT 新建 H5 演示；${made.issues} 项内容未保留或已简化`)
  }
  const readChosenPptx = (file: File) => async () => {
    return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }
  }
  const submit = () => {
    if (!root || !dialog) return
    if (dialog === 'mkdir' || dialog.startsWith('create-')) {
      const filename = dialog === 'create-html' ? (/\.html?$/i.test(name.trim()) ? name.trim() : `${name.trim()}.html`) : normalizeNewFilename(dialog as CreateFileType, name)
      const preset = SLIDE_CANVAS_PRESETS.find(item => item.id === canvasPreset) ?? SLIDE_CANVAS_PRESETS[0]!
      if (dialog === 'create-course') void run({ type: 'create-course', ...common(), targetDirectoryId: targetDirectory!, name: filename, canvas: { width: preset.width, height: preset.height } })
      else void run({ type: dialog === 'create-html' ? 'create-text' : dialog as 'mkdir' | 'create-markdown' | 'create-text', ...common(), targetDirectoryId: targetDirectory!, name: filename })
    } else if (dialog === 'rename' && single) void run({ type: 'rename', ...common(), sourceEntryId: single.entryId, name: name.trim() })
    else if (dialog === 'copy' || dialog === 'move') void run({ type: dialog, ...common(), sourceEntryIds: selected.map(row => row.entry.entryId), targetDirectoryId: destination ?? root.rootEntryId, ...(dialog === 'copy' ? { sourceVersion: copyVersion } : {}) })
    else if (dialog === 'trash') void run({ type: 'trash', ...common(), entryIds: selected.map(row => row.entry.entryId) })
  }
  const copy = (type: 'copy' | 'move') => { if (!root || !selected.length) return; setClipboard({ workspaceId: root.workspaceId, ids: selected.map(row => row.entry.entryId), type }); setMenu(undefined); setNotice(type === 'copy' ? `已复制 ${selected.length} 项，请选择目标文件夹后粘贴` : `已剪切 ${selected.length} 项，粘贴成功前原件保持不变`) }
  const paste = () => { if (root && clipboard?.ids.length && clipboard.workspaceId === root.workspaceId && targetDirectory) void run({ type: clipboard.type, ...common(), sourceEntryIds: clipboard.ids, targetDirectoryId: targetDirectory }) }
  const copyPath = async () => { if (!root || !selected.length) return; const entries = await Promise.all(selected.map(row => files({ type: 'resolve', workspaceId: root.workspaceId, entryId: row.entry.entryId }))); await navigator.clipboard.writeText(entries.map(entry => entry.resolvedPath).join('\n')); setNotice('已复制文件路径'); setMenu(undefined) }
  const keyboard = (event: KeyboardEvent) => {
    if (busy || (event.target as HTMLElement).closest('input,textarea,select,[contenteditable=true]')) return
    const ctrl = event.ctrlKey || event.metaKey, key = event.key.toLowerCase()
    if (event.key === 'Escape') { setMenu(undefined); event.stopPropagation(); return }
    if (event.key === 'F2' && single) { event.preventDefault(); event.stopPropagation(); void begin('rename'); return }
    if (event.key === 'Delete' && selected.length) { event.preventDefault(); event.stopPropagation(); void begin('trash'); return }
    if (ctrl && ['c', 'x', 'v', 'a'].includes(key)) { event.preventDefault(); event.stopPropagation(); if (key === 'v') paste(); else if (key === 'a') setSelection(new Set(rows.map(row => row.entry.entryId))); else copy(key === 'x' ? 'move' : 'copy'); return }
    if (event.key === 'Enter' && single) { event.preventDefault(); event.stopPropagation(); void open(single).catch(reason => setError(message(reason))); return }
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && rows.length) {
      event.preventDefault(); event.stopPropagation(); const current = rows.findIndex(row => row.entry.entryId === document.activeElement?.getAttribute('data-entry-id'))
      const row = rows[Math.max(0, Math.min(rows.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)))]; choose(row, event); buttons.current.get(row.entry.entryId)?.focus()
    }
  }
  const drop = async (event: DragEvent, id: string) => {
    event.preventDefault(); event.stopPropagation(); setDropTarget(undefined)
    if (!root || busy) return
    try {
      const raw = event.dataTransfer.getData(WORKSPACE_ENTRIES_DRAG_TYPE)
      if (raw) {
        const data = parseWorkspaceEntryDrag(raw)!
        if (data.workspaceId !== root.workspaceId) throw new Error('请在同一工作空间内移动，跨空间可使用系统拖入复制')
        if (data.ids.includes(id)) throw new Error('不能移入自身文件夹')
        await run({ type: 'move', ...common(), sourceEntryIds: data.ids, targetDirectoryId: id })
      } else {
        const snapshot = await snapshotWorkspaceDrop(event.dataTransfer)
        if (!snapshot.files.length && !snapshot.directories.length) return
        await run({ type: 'import-files', ...common(), targetDirectoryId: id, ...snapshot })
      }
    } catch (reason) { setError(message(reason)) }
  }
  const droppable = (id: string) => ({ onDragOver: (event: DragEvent) => { if (event.dataTransfer.types.includes(WORKSPACE_ENTRIES_DRAG_TYPE) || event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = event.dataTransfer.types.includes(WORKSPACE_ENTRIES_DRAG_TYPE) ? 'move' : 'copy'; setDropTarget(id) } }, onDragLeave: (event: DragEvent) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropTarget(undefined) }, onDrop: (event: DragEvent) => { void drop(event, id) } })
  const closeCreateMenu = () => { if (createMenu.current) createMenu.current.open = false; setCreateAt(undefined) }
  useEffect(() => {
    if (!createAt) return
    const outside = (event: PointerEvent) => { if (!(event.target instanceof Node && createMenu.current?.contains(event.target))) closeCreateMenu() }
    document.addEventListener('pointerdown', outside, true)
    return () => document.removeEventListener('pointerdown', outside, true)
  }, [createAt])
  const action = (type: Dialog) => { closeCreateMenu(); void begin(type).catch(reason => setError(message(reason))) }
  const choosePptx = () => { closeCreateMenu(); setMenu(undefined); pptxTarget.current = targetDirectory; pptxInput.current?.click() }
  const pptxRow = selected.length === 1 && selected[0]!.entry.kind === 'file' && /\.pptx$/i.test(selected[0]!.entry.name) ? selected[0] : undefined
  const importPptx = (row: Row) => { if (root) void fromPptx(() => files({ type: 'read-pptx', workspaceId: root.workspaceId, entryId: row.entry.entryId }), row.parentId) }
  // One definition per operation (M21): the right-click menu and the 新建 menu show the same items.
  const blocked = !root ? '工作空间未就绪' : busy ? '正在处理文件…' : null
  const commandPorts: ExplorerCommandPorts = {
    create: type => action(type), newFromPptx: choosePptx, importPptx: () => { if (pptxRow) importPptx(pptxRow) },
    importHtml: () => { if (root && menu && onImportHtml) { onImportHtml({ workspaceId: root.workspaceId, directoryEntryId: menu.directoryEntryId }, menu.sourceEntryId); setMenu(undefined) } },
    openHtmlExternal: () => { if (root && menu?.sourceEntryId) { if (!operation) { setError('当前界面不能用浏览器打开文件'); return } void files({ type: 'resolve', workspaceId: root.workspaceId, entryId: menu.sourceEntryId }).then(value => operation({ operation: 'open-external', path: value.resolvedPath })).then(result => { if (result.opened === false) throw new Error(result.openError ?? '没有可用的关联程序') }).catch(reason => setError(message(reason))); setMenu(undefined) } },
    rename: () => action('rename'), copy: () => copy('copy'), cut: () => copy('move'), paste,
    copyTo: () => action('copy'), moveTo: () => action('move'), trash: () => action('trash'),
    copyPath: () => { void copyPath().catch(reason => setError(message(reason))) },
    reveal: () => { if (single && root) void run({ type: 'reveal', ...common(), entryId: single.entryId }) },
  }
  const renderEntries = (id: string): React.ReactNode => <ul role="group" className="lesson-directory-tree">{(pages[id] ?? []).map(entry => entry.status === 'blocked' ? <li className="workspace-tree-blocked" key={`blocked:${entry.name}`}><File size={16} aria-hidden="true" /><span title={`${entry.name}（无法访问）`}>{entry.name}（无法访问）</span></li> : <li role="treeitem" aria-selected={selection.has(entry.entryId)} aria-expanded={entry.kind === 'directory' ? expanded.has(entry.entryId) : undefined} key={entry.entryId} data-kind={entry.kind} data-open={expanded.has(entry.entryId)}>
    <div className="workspace-tree-row" data-drop={dropTarget === entry.entryId} {...(entry.kind === 'directory' ? droppable(entry.entryId) : {})}>
      {entry.kind === 'directory' && <button type="button" className="workspace-tree-toggle" aria-label={`${expanded.has(entry.entryId) ? '折叠' : '展开'} ${entry.name}`} onClick={() => { setExpanded(value => { const next = new Set(value); if (next.has(entry.entryId)) next.delete(entry.entryId); else next.add(entry.entryId); return next }) }}><ChevronRight size={14} /></button>}
      <button type="button" className="lesson-tree-row" data-entry-id={entry.entryId} aria-pressed={selection.has(entry.entryId)} ref={element => { if (element) buttons.current.set(entry.entryId, element); else buttons.current.delete(entry.entryId) }} draggable={!busy} onDragStart={event => { writeWorkspaceEntryDrag(event.dataTransfer, root!.workspaceId, selection.has(entry.entryId) ? selected.map(row => row.entry) : [entry]) }} onClick={event => choose({ entry, parentId: id }, event)} onDoubleClick={() => { void open(entry).catch(reason => setError(message(reason))) }} onContextMenu={event => { event.preventDefault(); if (!selection.has(entry.entryId)) choose({ entry, parentId: id }); setMenu({ x: event.clientX, y: event.clientY, directoryEntryId: entry.kind === 'directory' ? entry.entryId : id, htmlImport: entry.kind === 'directory' ? 'pick' : /\.html?$/i.test(entry.name) ? 'selected' : null, ...(entry.kind === 'file' && /\.html?$/i.test(entry.name) ? { sourceEntryId: entry.entryId } : {}) }) }}>
        {entry.kind === 'directory' ? expanded.has(entry.entryId) ? <FolderOpen size={16} /> : <Folder size={16} /> : icon(entry.name)}<span title={entry.name}>{entry.name}</span>
      </button>
    </div>{entry.kind === 'directory' && expanded.has(entry.entryId) && renderEntries(entry.entryId)}
  </li>)}</ul>
  return <div className="workspace-files-tree" aria-busy={busy}>
    <div role="toolbar" aria-label="文件管理" className="workspace-files-primary-actions">
      <details ref={createMenu} className="workspace-files-create-menu">
        <summary aria-label="新建文件或文件夹" title="新建文件或文件夹" onClick={event => {
          if (createMenu.current?.open) { setCreateAt(undefined); return }
          const rect = event.currentTarget.getBoundingClientRect()
          setCreateAt({ left: Math.max(0, Math.min(rect.left, window.innerWidth - 200)), top: rect.bottom + 4 })
        }}><Plus size={15} aria-hidden="true" /><span>新建</span><ChevronDown size={12} aria-hidden="true" /></summary>
        <div className="workspace-files-create-options command-menu" role="menu" aria-label="新建" style={createAt} onKeyDown={moveMenuFocus}>
          <CommandMenuItems items={explorerNewCommands(blocked, commandPorts)} onRun={item => item.run()} />
        </div>
      </details>
      <button type="button" title="刷新文件列表" disabled={busy || !root} onClick={() => { void refresh().catch(reason => setError(message(reason))) }}><RotateCw size={14} aria-hidden="true" /><span>刷新</span></button>
    </div>
    <input ref={pptxInput} type="file" accept=".pptx" hidden aria-label="选择要在此文件夹新建为 H5 演示的 PPT" onChange={event => {
      const file = event.target.files?.[0], target = pptxTarget.current
      event.target.value = ''
      if (file && target) void fromPptx(readChosenPptx(file), target)
    }} />
    {notice && <p role="status">{busy ? '正在处理文件…' : notice}</p>}{busy && !notice && <p role="status">正在处理文件…</p>}
    {error && <p role="alert">{error}</p>}
    {results && results.status !== 'success' && <ul className="workspace-file-results" aria-label="文件操作结果">{results.items.map((item, index) => <li key={index} data-status={item.status}>{item.sourcePath?.split(/[\\/]/).pop() ?? item.targetPath?.split(/[\\/]/).pop() ?? '文件'}：{item.status === 'success' ? '已完成' : item.error?.message ?? (item.status === 'cancelled' ? '已取消' : '未完成')}</li>)}</ul>}
    <div role="tree" aria-label="工作空间文件" aria-multiselectable="true" onKeyDown={keyboard} onContextMenu={event => { if (!root || (event.target instanceof Element && event.target.closest('.lesson-tree-row, .workspace-tree-root'))) return; event.preventDefault(); setSelection(new Set()); setParentId(root.rootEntryId); setMenu({ x: event.clientX, y: event.clientY, directoryEntryId: root.rootEntryId, htmlImport: 'pick' }) }}>
      {root && <><button type="button" className="workspace-tree-root" aria-label="工作空间根目录" aria-pressed={selection.size === 0 && targetDirectory === root.rootEntryId} title={root.resolvedPath} data-drop={dropTarget === root.rootEntryId} {...droppable(root.rootEntryId)} onClick={() => { ++scopeTicket.current; onScope?.(root.resolvedPath, 'folder', root.workspaceId); setSelection(new Set()); setParentId(root.rootEntryId); onSaveDirectoryChange?.({ workspaceId: root.workspaceId, directoryEntryId: root.rootEntryId }); setMenu(undefined) }} onContextMenu={event => { event.preventDefault(); setSelection(new Set()); setParentId(root.rootEntryId); setMenu({ x: event.clientX, y: event.clientY, directoryEntryId: root.rootEntryId, htmlImport: 'pick' }) }}><Folder size={16} aria-hidden="true" /><span>{root.resolvedPath.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) || root.resolvedPath}</span></button>{renderEntries(root.rootEntryId)}</>}
    </div>
    {menu && <ContextMenu at={menu} label="文件菜单" onClose={() => setMenu(undefined)}
      items={explorerContextCommands({ blocked, selected: selected.length, pptx: Boolean(pptxRow), htmlImport: onImportHtml ? menu.htmlImport : null, htmlFile: menu.htmlImport === 'selected', clipboard: clipboard?.ids.length ?? 0 }, commandPorts)} />}
    {dialog && <section ref={dialogRef} className="workspace-file-dialog" role="dialog" aria-modal="true" aria-label="文件操作" onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape' && !busy) { event.preventDefault(); close() } else if (event.key === 'Tab') { const controls = [...(dialogRef.current?.querySelectorAll<HTMLElement>('input:not(:disabled), select:not(:disabled), button:not(:disabled)') ?? [])]; const first = controls[0], last = controls.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() } } else if (event.key === 'Enter' && event.target instanceof HTMLInputElement && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229 && !busy && !retry && (dialog === 'rename' || dialog === 'mkdir' || dialog.startsWith('create-')) && name.trim()) { event.preventDefault(); submit() } }}>
      {dialog === 'create-course' && <label>画布尺寸<select aria-label="画布尺寸" value={canvasPreset} onChange={event => setCanvasPreset(event.target.value)}>
        {SLIDE_CANVAS_PRESETS.map(preset => <option key={preset.id} value={preset.id}>{preset.label}（{preset.width}×{preset.height}）</option>)}
      </select></label>}
      {(dialog === 'rename' || dialog === 'mkdir' || dialog.startsWith('create-')) && <label>名称<input autoFocus aria-label="文件名称" value={name} onChange={event => setName(event.target.value)} onFocus={event => { if (dialog !== 'rename') { const [start, end] = getStemSelectionRange(event.currentTarget.value); event.currentTarget.setSelectionRange(start, end) } }} /></label>}
      {(dialog === 'copy' || dialog === 'move') && <><label>目标文件夹<select aria-label="目标文件夹" value={destination} onChange={event => { void browse(event.target.value).catch(reason => setError(message(reason))) }}>{destinations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><p>选择文件夹后可继续进入其子目录。</p></>}
      {dialog === 'copy' && !retry && <label>复制内容<select aria-label="复制内容" value={copyVersion} onChange={event => setCopyVersion(event.target.value as 'disk' | 'current')}><option value="disk">磁盘版本</option><option value="current">当前稿（不保存源文件）</option></select></label>}
      {results?.items.some(item => item.error?.code === 'same-name-conflict') && single && (dialog === 'copy' || dialog === 'move') && <button type="button" disabled={busy} onClick={() => action('rename')}>先重命名当前文件</button>}
      {retry ? <><p>未完成的文档引用本地附件。连同资源复制到目标目录，源素材会保留。已完成项不会重复操作。</p><button type="button" disabled={busy} onClick={() => { if (retry.type === 'move' || retry.type === 'copy') void run({ ...retry, operationId: crypto.randomUUID(), resourcePolicy: 'copy' }) }}>连同资源继续</button></> : <button type="button" disabled={busy || ((dialog === 'rename' || dialog === 'mkdir' || dialog.startsWith('create-')) && !name.trim())} onClick={submit}>确认</button>}
      <button type="button" disabled={busy} onClick={close}>取消</button>
    </section>}
  </div>
}
