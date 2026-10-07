import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import type { ComponentEdit, ComponentImplementation, ComponentInstance } from '../../shared/contracts/component-platform'
import type { DocumentResources } from '../../shared/workbench/document'
import type { CapturedCourseTarget, CourseV10DocumentBridge } from '../documents/CourseV10DocumentBridge'
import { getBuiltinComponentSource } from '../../core/components/source/builtinSources'
import { componentSourceAuthoringEdits, componentSourceOwnerIsShared, type ComponentSourceEditTarget } from '../../core/components/source/sourceAuthoringEdits'
import { notifyCourseDrafts, registerCourseDraftProvider, type AdvancedDraftIssue, type AdvancedDraftRecovery } from '../authoring/courseDraftLifecycle'

type SourceImplementation = Extract<ComponentImplementation, { kind: 'source' }>
type SourceFile = { bytes: Uint8Array; text: string | null }
type SourceValue = { language: 'javascript' | 'typescript'; entry: string; files: Record<string, SourceFile>; selected: string; workspace: boolean }
type SourceSession = { target: CapturedCourseTarget; instanceId: string; scope: ComponentSourceEditTarget;
  implementation?: SourceImplementation; ownerId: string; expectedFiles: Record<string, Uint8Array> | null }
type SourceDraft = { key: string; name: string; value: SourceValue; session: SourceSession | null;
  version: number; busy: boolean; composing: boolean; newPath: string; message: string | null; listeners: Set<() => void>; pending?: Promise<boolean>;
  recoveryBaseline?: SourceValue; blocked?: string }
// One local draft owner per bridge/author target. Panel unmount never applies or discards source.
const drafts = new WeakMap<CourseV10DocumentBridge, Map<string, SourceDraft>>()
const encode = (text: string) => new TextEncoder().encode(text)
function readFile(bytes: Uint8Array): SourceFile {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return { bytes, text: text.includes('\0') ? null : text }
  } catch { return { bytes, text: null } }
}
function editableSource(implementation: ComponentImplementation | undefined): SourceImplementation | undefined {
  return implementation?.kind === 'source' ? implementation : implementation?.kind === 'builtin' ? getBuiltinComponentSource(implementation.key) : undefined
}
function readSource(implementation: SourceImplementation | undefined, resources: DocumentResources): SourceValue {
  const language = implementation?.language ?? 'javascript'
  const entry = implementation?.workspace?.entry ?? `component.${language === 'typescript' ? 'ts' : 'js'}`
  const bytes = implementation?.workspace ? resources.components[implementation.workspace.ownerId] ?? {}
    : { [entry]: encode(implementation?.source ?? '') }
  return { language, entry, selected: Object.hasOwn(bytes, entry) ? entry : Object.keys(bytes)[0] ?? entry,
    workspace: Boolean(implementation?.workspace), files: Object.fromEntries(Object.entries(bytes).map(([name, value]) => [name, readFile(value)])) }
}
/** Capture bytes and author identity together; definition and instance edits use one canonical batch. */
export function captureComponentSourceSession(bridge: CourseV10DocumentBridge, documentId: string, instanceId: string,
  scope: 'instance' | 'definition' = 'instance', definitionId?: string): SourceSession {
  const target = bridge.captureTarget(documentId), instance = target.project.instances[instanceId]
  if (!instance) throw new Error('原源码对象已不存在，请重新选择对象。')
  if (instance.locked) throw new Error('原源码对象已锁定，请先解锁。')
  const definition = target.project.definitions[definitionId ?? instance.definitionId]
  if (!definition) throw new Error('原共享定义已不存在，请重新选择对象。')
  const effective = scope === 'definition' ? definition.implementation : instance.implementationOverride ?? definition.implementation
  const implementation = editableSource(effective), existingOwner = implementation?.workspace?.ownerId
  const reuse = existingOwner && !componentSourceOwnerIsShared(target.project, instanceId, existingOwner, scope === 'definition' ? definition.id : undefined)
  return { target, instanceId, scope: scope === 'definition' ? { kind: 'definition', definition } : { kind: 'instance', instanceId },
    implementation, ownerId: reuse ? existingOwner : crypto.randomUUID(),
    expectedFiles: reuse ? structuredClone(target.resources.components[existingOwner] ?? null) : null }
}
function sameFile(left: SourceFile | undefined, right: SourceFile | undefined): boolean {
  if (!left || !right) return left === right
  return left.bytes.length === right.bytes.length && left.bytes.every((byte, index) => byte === right.bytes[index])
}
function sourceValuesEqual(left: SourceValue, right: SourceValue): boolean {
  if (left.language !== right.language || left.entry !== right.entry || left.workspace !== right.workspace) return false
  const names = Object.keys(left.files)
  return names.length === Object.keys(right.files).length && names.every(name => sameFile(left.files[name], right.files[name]))
}
function sourceDraftDirty(draft: SourceDraft): boolean {
  return Boolean(draft.busy || draft.composing || draft.blocked || draft.session &&
    (!sourceValuesEqual(draft.value, readSource(draft.session.implementation, draft.session.target.resources)) || draft.newPath))
}
function publishSourceDraft(bridge: CourseV10DocumentBridge, draft: SourceDraft) {
  for (const notify of draft.listeners) notify()
  notifyCourseDrafts(bridge)
}
/** The source owner reports input that could not be prepared; the close owner can preserve it. */
export function componentSourceCloseIssue(bridge: CourseV10DocumentBridge, documentIds?: readonly string[]): {
  documentId: string; epoch: string; instanceId: string; message: string
} | undefined {
  for (const draft of drafts.get(bridge)?.values() ?? []) {
    const session = draft.session
    if (!session || documentIds && !documentIds.includes(session.target.documentId)) continue
    if (!sourceDraftDirty(draft)) continue
    const snapshot = bridge.read().documents.find(value => value.documentId === session.target.documentId && value.epoch === session.target.epoch)
    const documentName = snapshot ? snapshot.binding.kind === 'file'
      ? snapshot.binding.path.split(/[\\/]/).at(-1) : snapshot.binding.suggestedName : session.target.project.title
    const scope = session.scope.kind === 'definition' ? '共享定义源码' : '当前实例源码'
    const state = draft.busy ? '正在等待应用结果' : draft.composing ? '输入法组合尚未结束' : draft.message ?? '仍有待修输入'
    const message = `“${documentName} / ${draft.name}”的${scope}${state}；原输入与原目标已保留。`
    draft.message = message
    for (const notify of draft.listeners) notify()
    return { documentId: session.target.documentId, epoch: session.target.epoch, instanceId: session.instanceId, message }
  }
}
export function componentSourceSessionEdits(session: SourceSession, value: SourceValue, forceIndependent = false): ComponentEdit[] {
  if (!session.implementation) throw new Error('此实现尚未提供可编辑源码。')
  if (!forceIndependent && sourceValuesEqual(value, readSource(session.implementation, session.target.resources))) return []
  const entry = value.files[value.entry]
  if (!entry) throw new Error(`入口文件“${value.entry}”不存在，请新增该文件或选择已有入口。`)
  if (entry.text === null) throw new Error(`入口文件“${value.entry}”不是 UTF-8 文本，请选择源码文件。`)
  const { source: _source, workspace: _workspace, ...metadata } = session.implementation
  const implementation: SourceImplementation = { ...metadata, language: value.language, ...(value.workspace
    ? { workspace: { ownerId: session.ownerId, entry: value.entry } } : { source: entry.text }) }
  return componentSourceAuthoringEdits(session.scope, implementation, value.workspace ? { type: 'component.files.set',
    ownerId: session.ownerId, expectedFiles: session.expectedFiles,
    files: Object.fromEntries(Object.entries(value.files).map(([name, file]) => [name, file.bytes])) } : undefined)
}
export function independentComponentSourceEdits(bridge: CourseV10DocumentBridge, documentId: string, instanceId: string): { target: CapturedCourseTarget; edits: ComponentEdit[] } {
  const session = captureComponentSourceSession(bridge, documentId, instanceId)
  return { target: session.target, edits: componentSourceSessionEdits(session, readSource(session.implementation, session.target.resources), true) }
}
function freshDraft(key: string, name: string, value: SourceValue): SourceDraft {
  return { key, name, value, session: null, version: 0, busy: false, composing: false, newPath: '', message: null, listeners: new Set() }
}
function resetDraft(draft: SourceDraft, value: SourceValue, preserveSelection = true) {
  const selected = draft.value.selected
  draft.value = preserveSelection && Object.hasOwn(value.files, selected) ? { ...value, selected } : value
  draft.session = null; draft.newPath = ''; draft.message = null
  draft.recoveryBaseline = undefined; draft.blocked = undefined
}
function rebaseSourceDraft(value: SourceValue, baseline: SourceValue, fresh: SourceValue): SourceValue {
  const files = { ...fresh.files }
  for (const name of new Set([...Object.keys(baseline.files), ...Object.keys(value.files)])) {
    if (sameFile(value.files[name], baseline.files[name])) continue
    if (value.files[name]) files[name] = value.files[name]
    else delete files[name]
  }
  return { language: value.language === baseline.language ? fresh.language : value.language,
    entry: value.entry === baseline.entry ? fresh.entry : value.entry,
    workspace: value.workspace === baseline.workspace ? fresh.workspace : value.workspace,
    files, selected: Object.hasOwn(files, value.selected) ? value.selected : fresh.selected }
}

async function applySourceDraft(bridge: CourseV10DocumentBridge, draft: SourceDraft, restore = false): Promise<boolean> {
  if (draft.pending) return draft.pending
  const session = draft.session
  if (!session) return true
  const fail = (message: string) => { draft.message = message; publishSourceDraft(bridge, draft); return false }
  if (draft.blocked && !restore) return fail(draft.blocked)
  if (draft.composing) return fail('输入法组合尚未结束；原输入已保留。')
  if (!restore && draft.newPath) return fail('新增文件路径尚未完成；请新增文件或清空路径，原输入已保留。')
  const version = draft.version
  draft.busy = true
  const pending = (async () => {
    // Keep single-flight ownership even when validation or a no-op finishes synchronously.
    await Promise.resolve()
    try {
      const edits: ComponentEdit[] = restore ? [{ type: 'implementation.set', instanceId: session.instanceId, implementation: null }]
        : componentSourceSessionEdits(session, draft.value)
      const result = edits.length ? await bridge.editCaptured(bridge.capture(edits, session.target)) : null
      if (draft.session === session && draft.version === version) {
        const target = bridge.captureTarget(session.target.documentId)
        if (target.epoch !== session.target.epoch) return fail('原文档会话已改变；源码草稿已保留，请载入当前基线后继续。')
        const original = target.project.instances[session.instanceId]
        const effective = session.scope.kind === 'definition' ? target.project.definitions[session.scope.definition.id]?.implementation
          : original?.implementationOverride ?? target.project.definitions[original?.definitionId ?? '']?.implementation
        resetDraft(draft, readSource(editableSource(effective), target.resources))
      }
      draft.message = restore ? '已恢复默认实现。' : result?.status === 'applied' ? '实现已应用到课件。' : '源码未改变，无需应用。'
      return !sourceDraftDirty({ ...draft, busy: false })
    } catch (error) { return fail(`未应用：${error instanceof Error ? error.message : String(error)}；源码草稿已保留。`) }
    finally { draft.busy = false; draft.pending = undefined; publishSourceDraft(bridge, draft) }
  })()
  draft.pending = pending
  publishSourceDraft(bridge, draft)
  return pending
}
function sourceRecoveryValue(value: SourceValue) {
  return { ...value, files: Object.fromEntries(Object.entries(value.files).map(([name, file]) => [name, { text: file.text, bytes: Array.from(file.bytes) }])) }
}
function restoreSourceValue(value: ReturnType<typeof sourceRecoveryValue>): SourceValue {
  return { ...value, files: Object.fromEntries(Object.entries(value.files).map(([name, file]) => [name, { text: file.text, bytes: new Uint8Array(file.bytes) }])) }
}
function sourceLifecycle(bridge: CourseV10DocumentBridge, cache: Map<string, SourceDraft>) {
  registerCourseDraftProvider(bridge, 'source', {
    hasDirty: documentId => [...cache.values()].some(draft => (!documentId || draft.session?.target.documentId === documentId) && sourceDraftDirty(draft)),
    async prepare(documentId) {
      const issues: AdvancedDraftIssue[] = []
      for (const draft of cache.values()) if (draft.session?.target.documentId === documentId && sourceDraftDirty(draft)) {
        const session = draft.session
        if (!await applySourceDraft(bridge, draft)) issues.push({ documentId, epoch: session.target.epoch, message: draft.message ?? '源码草稿尚未应用。' })
      }
      return issues
    },
    preserve(documentId) {
      return [...cache.values()].filter(draft => draft.session?.target.documentId === documentId && sourceDraftDirty(draft)).map(draft => {
        const session = draft.session!
        return { kind: 'source', documentId, epoch: session.target.epoch, projectId: session.target.project.id,
          key: JSON.stringify([session.scope.kind, session.scope.kind === 'definition' ? session.scope.definition.id : session.instanceId]),
          payload: { instanceId: session.instanceId, scope: session.scope.kind, definitionId: session.scope.kind === 'definition' ? session.scope.definition.id : null,
            name: draft.name, value: sourceRecoveryValue(draft.value), baseline: sourceRecoveryValue(draft.recoveryBaseline ?? readSource(session.implementation, session.target.resources)),
            newPath: draft.newPath, message: draft.message, composing: draft.composing } } satisfies AdvancedDraftRecovery
      })
    },
    restore(documentId, record) {
      const saved = record.payload as unknown as { instanceId: string; scope: 'instance' | 'definition'; definitionId: string | null; name: string;
        value: ReturnType<typeof sourceRecoveryValue>; baseline: ReturnType<typeof sourceRecoveryValue>; newPath: string; message: string | null }
      const session = captureComponentSourceSession(bridge, documentId, saved.instanceId, saved.scope, saved.definitionId ?? undefined)
      const key = JSON.stringify([documentId, session.target.epoch, saved.scope, saved.scope === 'definition' ? saved.definitionId : saved.instanceId])
      if (cache.get(key)?.session) return
      const draft = freshDraft(key, saved.name, restoreSourceValue(saved.value))
      // Recovered text remains input until the user resumes editing or explicitly saves it.
      draft.session = session; draft.newPath = saved.newPath; draft.version++
      draft.message = sourceValuesEqual(restoreSourceValue(saved.baseline), readSource(session.implementation, session.target.resources))
        ? '已恢复源码原输入；尚未自动应用。' : '源码基线已改变；原输入已恢复，请载入当前基线后检查。'
      if (!sourceValuesEqual(restoreSourceValue(saved.baseline), readSource(session.implementation, session.target.resources))) {
        draft.recoveryBaseline = restoreSourceValue(saved.baseline)
        draft.blocked = draft.message
      }
      cache.set(key, draft)
    },
  })
}

/** Native textarea undo and IME stay local; natural input boundaries enter the existing History. */
export function ComponentSourceEditor({ instance, implementation, bridge, report, documentId, scope = 'instance' }: {
  instance?: ComponentInstance; implementation?: ComponentImplementation; bridge: CourseV10DocumentBridge; report(message: string): void;
  documentId?: string; scope?: 'instance' | 'definition'
}) {
  const view = useSyncExternalStore(bridge.subscribe, bridge.read), owner = documentId ?? view.activeDocumentId ?? ''
  const epoch = view.documents.find(snapshot => snapshot.documentId === owner)?.epoch
  const key = JSON.stringify([owner, epoch, scope, scope === 'definition' ? instance?.definitionId : instance?.id])
  const editable = useMemo(() => editableSource(implementation), [implementation])
  const resources = view.views.find(item => item.documentId === owner)?.model.resources ?? view.documents.find(item => item.documentId === owner)?.model.resources
  const initial = useMemo(() => readSource(editable, resources ?? { assets: {}, components: {} }), [editable, resources])
  const [, refresh] = useState(0)
  let cache = drafts.get(bridge)
  if (!cache) { cache = new Map(); drafts.set(bridge, cache); sourceLifecycle(bridge, cache) }
  const getDraft = () => {
    let draft = cache!.get(key)
    if (!draft) { draft = freshDraft(key, instance?.name ?? instance?.id ?? '', initial); cache!.set(key, draft) }
    return draft
  }
  const draftRef = useRef<SourceDraft>(getDraft())
  if (draftRef.current.key !== key && !draftRef.current.session && !draftRef.current.busy && !draftRef.current.composing) draftRef.current = getDraft()
  const draft = draftRef.current, value = draft.value
  const render = () => publishSourceDraft(bridge, draft)
  useEffect(() => {
    const notify = () => refresh(version => version + 1)
    draft.listeners.add(notify); return () => { draft.listeners.delete(notify) }
  }, [draft])
  const active = useRef({ key, initial }); active.current = { key, initial }
  useEffect(() => {
    if (draft.session || draft.busy || draft.composing || draft.key !== key) return
    resetDraft(draft, initial); render()
  }, [draft, key, initial])
  const capturedInstance = draft.session && view.views.find(item => item.documentId === draft.session!.target.documentId)?.model.project.instances[draft.session.instanceId]
  const locked = draft.session ? capturedInstance?.locked === true : instance?.locked === true
  const unavailable = !!instance && !editable, stale = !!draft.session && draft.key !== key
  const disabled = draft.busy || locked || unavailable && !draft.session
  const capture = () => {
    if (draft.session) return draft.session
    if (!instance) throw new Error('当前没有源码目标，请选择对象或创建运行时。')
    draft.session = captureComponentSourceSession(bridge, owner, instance.id, scope)
    draft.name = instance.name ?? instance.id
    return draft.session
  }
  const change = (next: SourceValue) => {
    if (disabled) return
    try { capture(); draft.version++; draft.value = next; draft.message = null; render() }
    catch (error) { draft.message = error instanceof Error ? error.message : String(error); render() }
  }
  const nativeHistory = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) event.stopPropagation()
  }
  const save = async (restore = false) => {
    if (disabled || draft.composing) return
    try { capture() } catch (error) { draft.message = String(error); render(); return }
    if (!await applySourceDraft(bridge, draft, restore) && draft.message) report(draft.message)
  }
  const loadBaseline = () => {
    if (!draft.session || disabled || draft.composing) return
    try {
      const previous = draft.session, next = captureComponentSourceSession(bridge, previous.target.documentId, previous.instanceId,
        previous.scope.kind, previous.scope.kind === 'definition' ? previous.scope.definition.id : undefined)
      draft.value = rebaseSourceDraft(draft.value, draft.recoveryBaseline ?? readSource(previous.implementation, previous.target.resources), readSource(next.implementation, next.target.resources))
      draft.session = next; draft.recoveryBaseline = undefined; draft.blocked = undefined; draft.version++; draft.message = '已载入当前基线并保留各文件草稿，请检查后重新应用。'; render()
    } catch (error) { draft.message = String(error); render() }
  }
  const addFile = () => {
    const path = draft.newPath.trim().replace(/\\/g, '/').replace(/^\.\//, '')
    if (!path || path.startsWith('/') || /^[a-z]:/i.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) {
      draft.message = '请输入组件内的相对文件路径，例如 scripts/helper.ts。'; render(); return
    }
    if (Object.hasOwn(value.files, path)) { draft.message = `文件“${path}”已经存在，请从文件列表选择。`; render(); return }
    change({ ...value, workspace: true, selected: path, files: { ...value.files, [path]: { text: '', bytes: encode('') } } }); draft.newPath = ''
  }
  if (!instance && !draft.session) return null
  const file = value.files[value.selected], names = Object.keys(value.files)
  return <details open onKeyDownCapture={nativeHistory} onBlurCapture={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null) && draft.session && sourceDraftDirty(draft)) void save()
  }}><summary>{scope === 'definition' ? '共享定义源码' : '组件实现源码'}</summary>
    {stale && <p role="status">草稿属于“{draft.name}”；应用只修改原文档与原{draft.session?.scope.kind === 'definition' ? '共享定义' : '对象'}。</p>}
    {locked && <p role="status">源码对象已锁定，当前为只读。</p>}
    {unavailable && !draft.session && <p role="status">此内置实现的完整源码尚未提供：{implementation?.kind === 'builtin' ? implementation.key : instance?.definitionId}。</p>}
    <label>语言<select value={value.language} disabled={disabled || draft.composing} onChange={event => {
      const language = event.target.value as SourceValue['language']
      if (value.workspace) change({ ...value, language })
      else { const entry = `component.${language === 'typescript' ? 'ts' : 'js'}`; change({ ...value, language, entry, selected: entry, files: { [entry]: value.files[value.entry] } }) }
    }}><option value="typescript">TypeScript</option><option value="javascript">JavaScript</option></select></label>
    {value.workspace && <div className="developer-source-files">
      <label>文件<select aria-label="组件源码文件" value={value.selected} disabled={draft.busy || draft.composing} onChange={event => { draft.value = { ...value, selected: event.target.value }; render() }}>
        {names.map(name => <option key={name} value={name}>{name}{name === value.entry ? '（入口）' : ''}{value.files[name].text === null ? '（二进制）' : ''}</option>)}
      </select></label>
      <label>入口<select aria-label="组件源码入口" value={value.entry} disabled={disabled || draft.composing} onChange={event => change({ ...value, entry: event.target.value })}>
        {!Object.hasOwn(value.files, value.entry) && <option value={value.entry}>{value.entry}（缺失）</option>}
        {names.filter(name => value.files[name].text !== null).map(name => <option key={name} value={name}>{name}</option>)}
      </select></label>
      <button disabled={disabled || draft.composing || !file} onClick={() => { const files = { ...value.files }; delete files[value.selected]; change({ ...value, files, selected: Object.keys(files)[0] ?? value.entry }) }}>删除当前文件</button>
    </div>}
    <div><label>新增文件路径<input aria-label="新增组件源码文件路径" value={draft.newPath} disabled={disabled || draft.composing} onChange={event => {
      try { capture(); draft.newPath = event.target.value; render() }
      catch (error) { draft.message = String(error); render() }
    }} /></label>
      <button disabled={disabled || draft.composing || !draft.newPath.trim()} onClick={addFile}>新增文件</button></div>
    {value.workspace && !Object.hasOwn(value.files, value.entry) && <p role="status">入口文件“{value.entry}”缺失。现有文件仍可编辑；请新增该文件或选择已有入口后应用。</p>}
    {file?.text === null && <p role="status">“{value.selected}”不是 UTF-8 文本，字节会随源码完整保留。请选择文本文件进行编辑。</p>}
    {names.filter(name => value.files[name].text !== null).map(name => <div key={`${draft.key}/${name}`} hidden={name !== value.selected}>
      <textarea aria-label={name === value.selected ? '组件实现源码' : undefined} value={value.files[name].text ?? ''} readOnly={disabled}
        onChange={event => change({ ...draft.value, files: { ...draft.value.files, [name]: { text: event.target.value, bytes: encode(event.target.value) } } })}
        onCompositionStart={() => { try { capture(); draft.composing = true; render() } catch (error) { draft.message = String(error); render() } }}
        onCompositionEnd={() => { setTimeout(() => { draft.composing = false; render(); void save() }, 0) }}
        spellCheck={false} wrap="off" className="developer-code-editor" style={{ width: '100%', minHeight: 240, fontFamily: 'monospace' }} />
    </div>)}
    {!file && <p>此组件还没有源码文件。</p>}
    <button disabled={disabled || draft.composing} onClick={() => void save()}>保存实现</button>
    {scope === 'instance' && <button disabled={disabled || draft.composing} onClick={() => void save(true)}>恢复默认实现</button>}
    {draft.session && <button disabled={disabled || draft.composing} onClick={loadBaseline}>载入当前基线并保留草稿</button>}
    <button disabled={draft.busy || draft.composing} onClick={() => {
      const initial = active.current.initial, selected = draft.value.selected
      const next = draft.key === key && Object.hasOwn(initial.files, selected) ? { ...initial, selected } : initial
      cache!.delete(draft.key); draftRef.current = freshDraft(key, instance?.name ?? instance?.id ?? '', next)
      cache!.set(key, draftRef.current); render()
    }}>放弃草稿</button>
    {draft.message && <p role="status">{draft.message}</p>}
  </details>
}
