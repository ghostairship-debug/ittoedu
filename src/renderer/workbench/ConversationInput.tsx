import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { FileText, Folder, Paperclip, SlidersHorizontal, Shield, Plus, Sparkles, ChevronLeft } from 'lucide-react'
import type { SkillCatalogEntry } from '../../shared/workbench/skillCatalogDesktop'
import type { AttachmentActions } from './attachments/AttachmentComposer'
import { composerTrigger, replaceComposerTrigger, type ComposerTrigger } from './composerTrigger'

interface Props {
  value: string; onChange(value: string): void; onBlur(): void; onFocus(): void
  inputRef: RefObject<HTMLTextAreaElement | null>; disabled: boolean; readOnly: boolean
  workspaceDirectory?: string; actions: AttachmentActions
  onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void
  onCompositionStart(): void; onCompositionEnd(): void
  onModel(): void; onPermission(): void; onNewConversation(): void; onReference(selection: boolean): void
}
interface WorkspaceEntry { entryId: string; name: string; kind: 'file' | 'directory' }
interface Directory { id: string; name: string }
interface Choice { id: string; label: string; detail?: string; group: string; icon: typeof FileText; select(): void }

/** Only transient candidate UI; draft, references and intake stay with their existing owners. */
export function ConversationInput(props: Props) {
  const [trigger, setTrigger] = useState<ComposerTrigger | null>(null)
  const [active, setActive] = useState(0), [loading, setLoading] = useState(false), [error, setError] = useState('')
  const [skills, setSkills] = useState<readonly SkillCatalogEntry[]>([]), [warnings, setWarnings] = useState<readonly string[]>([])
  const [workspaceId, setWorkspaceId] = useState(''), [directories, setDirectories] = useState<Directory[]>([]), [entries, setEntries] = useState<WorkspaceEntry[]>([])
  const [cursor, setCursor] = useState<string | undefined>()
  const [position, setPosition] = useState({ left: 8, bottom: 8, width: 320 })
  const popup = useRef<HTMLDivElement>(null), live = useRef(true), composing = useRef(false), generation = useRef(0)
  const menuId = useId()
  useEffect(() => { live.current = true; return () => { live.current = false; generation.current++ } }, [])
  const place = () => {
    const rect = props.inputRef.current?.getBoundingClientRect()
    if (rect) { const width = Math.min(360, rect.width, window.innerWidth - 16); setPosition({ width, left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), bottom: Math.max(8, window.innerHeight - rect.top + 6) }) }
  }
  const loadDirectory = async (id: string, trail: Directory[], selectedWorkspace = workspaceId, pageCursor?: string) => {
    const service = window.desktopAPI?.workspaceFiles
    if (!service) throw new Error('工作空间文件服务不可用')
    const token = ++generation.current; setLoading(true); setError('')
    try {
      const page = await service({ type: 'list', workspaceId: selectedWorkspace, directoryEntryId: id, limit: 200, cursor: pageCursor })
      if (!live.current || token !== generation.current) return
      const rows = page.entries.flatMap(entry => entry.status === 'accessible' ? [{ entryId: entry.entryId, name: entry.name, kind: entry.kind }] : [])
      setEntries(previous => pageCursor ? [...previous, ...rows] : rows); setDirectories(trail); setCursor(page.nextCursor); setWorkspaceId(selectedWorkspace)
    } catch (failure) { if (live.current && token === generation.current) setError(failure instanceof Error ? failure.message : '文件目录未能读取') }
    finally { if (live.current && token === generation.current) setLoading(false) }
  }
  const refresh = async (kind: '/' | '@') => {
    if (kind === '/') {
      const service = window.desktopAPI?.skillCatalog
      if (!service) { setError('Skill目录服务不可用；常用操作仍可使用。'); return }
      const token = ++generation.current; setLoading(true); setError('')
      try { const view = await service({ workspaceDirectory: props.workspaceDirectory }); if (live.current && token === generation.current) { setSkills(view.entries); setWarnings(view.warnings) } }
      catch (failure) { if (live.current && token === generation.current) setError(failure instanceof Error ? failure.message : 'Skill目录未能读取') }
      finally { if (live.current && token === generation.current) setLoading(false) }
    } else {
      if (!props.workspaceDirectory || !window.desktopAPI?.workspaceFiles) { setEntries([]); setError('请先打开工作空间；当前文档和选区仍可引用。'); return }
      const token = ++generation.current
      try { const root = await window.desktopAPI.workspaceFiles({ type: 'root', directory: props.workspaceDirectory }); if (live.current && token === generation.current) await loadDirectory(root.rootEntryId, [{ id: root.rootEntryId, name: '工作空间' }], root.workspaceId) }
      catch (failure) { if (live.current && token === generation.current) setError(failure instanceof Error ? failure.message : '工作空间未能读取') }
    }
  }
  useEffect(() => {
    if (!trigger) return
    place(); setActive(0); void refresh(trigger.kind)
    // A query filters already loaded metadata; it does not re-scan on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { generation.current++ }
  }, [trigger?.kind, props.workspaceDirectory])
  useEffect(() => { if (props.disabled || props.readOnly) setTrigger(null) }, [props.disabled, props.readOnly])
  useEffect(() => { const node = props.inputRef.current; if (node) { node.style.height = 'auto'; node.style.height = `${Math.min(180, Math.max(68, node.scrollHeight))}px` } }, [props.value, props.inputRef])
  useEffect(() => {
    if (!trigger) return
    const dismiss = (event: PointerEvent) => { if (!popup.current?.contains(event.target as Node) && event.target !== props.inputRef.current) setTrigger(null) }
    const close = () => setTrigger(null)
    document.addEventListener('pointerdown', dismiss); window.addEventListener('resize', close)
    return () => { document.removeEventListener('pointerdown', dismiss); window.removeEventListener('resize', close) }
  }, [Boolean(trigger), props.inputRef])
  const consume = (insertion = '', restoreFocus = true) => {
    if (!trigger) return
    const next = replaceComposerTrigger(props.value, trigger, insertion)
    props.onChange(next.text); setTrigger(null)
    if (restoreFocus) requestAnimationFrame(() => { props.inputRef.current?.focus(); props.inputRef.current?.setSelectionRange(next.caret, next.caret) })
  }
  const command = (id: string, label: string, icon: Choice['icon'], action: () => void): Choice => ({ id, label, icon, group: '常用操作', select: () => { if (id === 'attach' && !props.actions.canAdd) { setError('附件正在处理，请稍后再添加。'); return }; consume('', false); action() } })
  const choices: Choice[] = trigger?.kind === '/' ? [
    ...skills.map(skill => ({ id: skill.name, label: skill.name, detail: skill.description, group: 'Skill', icon: Sparkles, select: () => consume(`使用「${skill.name}」Skill：`) })),
    command('attach', '添加附件', Paperclip, props.actions.addFiles), command('model', '选择模型', SlidersHorizontal, props.onModel),
    command('permission', '权限设置', Shield, props.onPermission), command('conversation', '新建会话', Plus, props.onNewConversation),
  ] : trigger?.kind === '@' ? [
    ...entries.map(entry => ({ id: entry.entryId, label: entry.name, detail: directories.map(item => item.name).join('/'), group: '工作空间文件', icon: entry.kind === 'directory' ? Folder : FileText,
      select: () => { if (entry.kind === 'directory') { setActive(0); void loadDirectory(entry.entryId, [...directories, { id: entry.entryId, name: entry.name }]) } else if (props.actions.canReference) { consume(); props.actions.referenceEntries(workspaceId, [entry.entryId]) } else setError('附件正在处理，请稍后再引用文件。') } })),
    { id: 'document', label: '当前文档', group: '当前上下文', icon: FileText, select: () => { consume(); props.onReference(false) } },
    { id: 'selection', label: '当前选区', group: '当前上下文', icon: FileText, select: () => { consume(); props.onReference(true) } },
  ] : []
  const query = trigger?.query.toLocaleLowerCase() ?? ''
  const filtered = choices.filter(choice => `${choice.label} ${choice.detail ?? ''} ${choice.id}`.toLocaleLowerCase().includes(query))
  const selected = Math.min(active, Math.max(0, filtered.length - 1))
  useEffect(() => { popup.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' }) }, [selected, query])
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
    if (trigger && !event.shiftKey) {
      if (event.key === 'Escape') { event.preventDefault(); setTrigger(null); return }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActive(filtered.length ? (selected + (event.key === 'ArrowDown' ? 1 : -1) + filtered.length) % filtered.length : 0); return }
      if (event.key === 'Enter' || event.key === 'Tab') { if (event.key === 'Enter' || filtered[selected]) event.preventDefault(); filtered[selected]?.select(); return }
    }
    props.onKeyDown(event)
  }
  return <>
    <textarea ref={props.inputRef} aria-label="给果铃AI发消息" aria-describedby="assistant-composer-hint" aria-expanded={Boolean(trigger)} aria-controls={trigger ? menuId : undefined}
      aria-activedescendant={trigger && filtered[selected] ? `${menuId}-${selected}` : undefined} data-attachment-paste-target value={props.value} disabled={props.disabled} readOnly={props.readOnly}
      placeholder="描述你要讨论或完成的内容；/ 操作，@ 引用"
      onFocus={props.onFocus} onBlur={props.onBlur} onKeyDown={keyDown}
      onCompositionStart={() => { composing.current = true; setTrigger(null); props.onCompositionStart() }}
      onCompositionEnd={event => { composing.current = false; props.onCompositionEnd(); setTrigger(composerTrigger(event.currentTarget.value, event.currentTarget.selectionStart)) }}
      onChange={event => { props.onChange(event.target.value); if (!composing.current) { setActive(0); setTrigger(composerTrigger(event.target.value, event.target.selectionStart)) }; const node = event.currentTarget; node.style.height = 'auto'; node.style.height = `${Math.min(180, Math.max(68, node.scrollHeight))}px` }}
      onSelect={event => { if (trigger && !composing.current) setTrigger(composerTrigger(event.currentTarget.value, event.currentTarget.selectionStart)) }} />
    {trigger && createPortal(<div ref={popup} className="execution-assistant__command-menu" style={position}>
      <header><strong>{trigger.kind === '/' ? 'Skill与常用操作' : '引用工作空间内容'}</strong><button type="button" aria-label="关闭候选" onClick={() => { setTrigger(null); props.inputRef.current?.focus() }}>×</button></header>
      {trigger.kind === '@' && directories.length > 1 && <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => { const trail = directories.slice(0, -1); setActive(0); void loadDirectory(trail.at(-1)!.id, trail) }}><ChevronLeft size={14} />返回上一级 · {directories.at(-1)?.name}</button>}
      {loading && <p role="status">正在读取…</p>}
      {error && <p role="alert">{error}<button type="button" onMouseDown={event => event.preventDefault()} onClick={() => void refresh(trigger.kind)}>重试</button></p>}
      <div id={menuId} role="listbox" aria-label={trigger.kind === '/' ? 'Skill与常用操作候选' : '文件与当前上下文候选'}>
        {filtered.map((choice, index) => <div key={choice.id}>{index === 0 || choice.group !== filtered[index - 1].group ? <small className="execution-assistant__command-group">{choice.group}</small> : null}
          <button type="button" role="option" id={`${menuId}-${index}`} title={[choice.label, choice.detail].filter(Boolean).join(' · ')} aria-selected={index === selected} onMouseDown={event => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={choice.select}>
            <choice.icon size={16} /><span><strong>{choice.label}</strong>{choice.detail && <small>{choice.detail}</small>}</span>
          </button></div>)}
        {!loading && !filtered.length && <p>没有匹配项；可继续输入文字或按Esc关闭。</p>}
      </div>
      {trigger.kind === '@' && cursor && <button type="button" disabled={loading} onMouseDown={event => event.preventDefault()} onClick={() => void loadDirectory(directories.at(-1)!.id, directories, workspaceId, cursor)}>加载更多文件</button>}
      {warnings.length > 0 && trigger.kind === '/' && <details><summary>目录提示</summary>{warnings.map(warning => <p key={warning}>{warning}</p>)}</details>}
    </div>, document.body)}
  </>
}
