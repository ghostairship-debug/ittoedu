import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import type { ComponentEdit, ComponentImplementation, ComponentInstance } from '../../shared/contracts/component-platform'
import type { DocumentResources } from '../../shared/workbench/document'
import type { CapturedCourseTarget, CourseV10DocumentBridge } from '../documents/CourseV10DocumentBridge'
import { isCourseComponentInputFailure, settleCourseComponentInput, type CourseComponentInputFailure } from '../documents/CourseV10DocumentBridge'
import type { ComponentSourceEditTarget } from '../../core/components/source/sourceAuthoringEdits'
import { componentAuthorSourceDependencyPaths, componentAuthorSourceEdits, componentAuthorSourceModules, prepareComponentAuthorSource, resolveComponentAuthorSourceDependencyPaths, type ComponentAuthorSource } from '../../core/components/source/componentAuthorSource'
import { notifyCourseDrafts, registerCourseDraftProvider, type AdvancedDraftIssue, type AdvancedDraftRecovery } from '../authoring/courseDraftLifecycle'
import { hasBuiltinComponentSource, loadBuiltinComponentSource } from '../../core/components/source/builtinSources'

type SourceImplementation = Extract<ComponentImplementation, { kind: 'source' }>
type SourceFile = { bytes: Uint8Array; text: string | null }
type SourceValue = { language: 'javascript' | 'typescript'; entry: string; files: Record<string, SourceFile>; selected: string; workspace: boolean }
type SourceSession = { target: CapturedCourseTarget; instanceId: string; scope: ComponentSourceEditTarget;
  prepared?: ComponentAuthorSource; dependencyId?: string; dependencyPaths?: string[][]; implementation?: SourceImplementation; ownerId: string; expectedFiles: Record<string, Uint8Array> | null }
type SourceDraft = { key: string; name: string; value: SourceValue; session: SourceSession | null;
  dependencyId?: string; moduleReplacements?: Map<string, string>;
  version: number; busy: boolean; composing: boolean; newPath: string; message: string | null; listeners: Set<() => void>; pending?: Promise<boolean>;
  recoveryBaseline?: SourceValue; blocked?: string; resumeRequired?: boolean; active?: boolean; activeOwner?: { isCurrent(key: string): boolean }; failure?: CourseComponentInputFailure }
// One local draft owner per bridge/author target. Panel unmount never applies or discards source.
const drafts = new WeakMap<CourseV10DocumentBridge, Map<string, SourceDraft>>()
const encode = (text: string) => new TextEncoder().encode(text)
function readFile(bytes: Uint8Array): SourceFile {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return { bytes, text: text.includes('\0') ? null : text }
  } catch { return { bytes, text: null } }
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
  scope: 'instance' | 'definition' = 'instance', definitionId?: string, committed = false, dependencyId?: string): SourceSession {
  const target = bridge.captureTarget(documentId, committed), instance = target.project.instances[instanceId]
  if (scope === 'instance' && !instance) throw new Error('原源码对象已不存在，请重新选择对象。')
  if (scope === 'instance' && instance?.locked) throw new Error('原源码对象已锁定，请先解锁。')
  const definition = target.project.definitions[definitionId ?? instance?.definitionId ?? '']
  if (!definition) throw new Error('原共享定义已不存在，请重新选择对象。')
  const effective = scope === 'definition' ? definition.implementation : instance!.implementationOverride ?? definition.implementation
  const prepared = prepareComponentAuthorSource(target.project, effective)
  const implementation = prepared && (dependencyId
    ? componentAuthorSourceModules(target.project, target.resources, prepared).find(module => module.id === dependencyId)?.implementation
    : prepared.implementation)
  const existingOwner = implementation?.workspace?.ownerId
  // Dependency bytes retain their original CAS; the canonical source scope forks the owner at apply.
  const reuse = existingOwner
  return { target, instanceId, scope: scope === 'definition' ? { kind: 'definition', definition } : { kind: 'instance', instanceId },
    prepared, dependencyId, dependencyPaths: prepared && dependencyId
      ? componentAuthorSourceDependencyPaths(target.project, prepared, dependencyId, target.resources) : undefined,
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
  return Boolean(draft.busy || draft.composing || draft.blocked || draft.resumeRequired || draft.session &&
    (!sourceValuesEqual(draft.value, readSource(draft.session.implementation, draft.session.target.resources)) || draft.newPath))
}
function publishSourceDraft(bridge: CourseV10DocumentBridge, draft: SourceDraft) {
  for (const notify of draft.listeners) notify()
  notifyCourseDrafts(bridge)
}
function parkSourceDraft(bridge: CourseV10DocumentBridge, draft: SourceDraft, detached = false) {
  draft.active = false
  if (detached && draft.composing) { draft.resumeRequired = true; draft.composing = false }
  if (!draft.composing) draft.activeOwner = undefined
  publishSourceDraft(bridge, draft)
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
  if (!session.implementation || !session.prepared) throw new Error('此实现尚未提供可编辑源码，或原源码模块已不存在。')
  if (!forceIndependent && sourceValuesEqual(value, readSource(session.implementation, session.target.resources))) return []
  const entry = value.files[value.entry]
  if (!entry) throw new Error(`入口文件“${value.entry}”不存在，请新增该文件或选择已有入口。`)
  if (entry.text === null) throw new Error(`入口文件“${value.entry}”不是 UTF-8 文本，请选择源码文件。`)
  const { source: _source, workspace: _workspace, ...metadata } = session.implementation
  const implementation: SourceImplementation = { ...metadata, language: value.language, ...(value.workspace
    ? { workspace: { ownerId: session.ownerId, entry: value.entry } } : { source: entry.text }) }
  return componentAuthorSourceEdits(session.target.project, session.target.resources, session.scope, session.prepared, implementation, value.workspace ? { type: 'component.files.set',
    ownerId: session.ownerId, expectedFiles: session.expectedFiles,
    files: Object.fromEntries(Object.entries(value.files).map(([name, file]) => [name, file.bytes])) } : undefined, session.dependencyId)
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
  draft.recoveryBaseline = undefined; draft.blocked = undefined; draft.resumeRequired = undefined
  draft.active = false; draft.activeOwner = undefined; draft.failure = undefined
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

function consumeAppliedSourceDraft(bridge: CourseV10DocumentBridge, draft: SourceDraft, session: SourceSession, restore = false): boolean {
  let current = captureComponentSourceSession(bridge, session.target.documentId, session.instanceId,
    session.scope.kind, session.scope.kind === 'definition' ? session.scope.definition.id : undefined, true, restore ? undefined : session.dependencyId)
  if (!restore && session.dependencyId && session.dependencyPaths?.length) {
    const dependencyId = current.prepared && resolveComponentAuthorSourceDependencyPaths(current.target.project, current.prepared,
      session.dependencyPaths, current.target.resources)
    if (!dependencyId) return false
    if (dependencyId !== current.dependencyId) current = captureComponentSourceSession(bridge, session.target.documentId, session.instanceId,
      session.scope.kind, session.scope.kind === 'definition' ? session.scope.definition.id : undefined, true, dependencyId)
  }
  if (current.target.epoch !== session.target.epoch) return false
  const currentValue = readSource(current.implementation, current.target.resources)
  if (!restore && (!sourceValuesEqual(draft.value, currentValue) || draft.newPath)) return false
  resetDraft(draft, restore ? currentValue : draft.value)
  draft.dependencyId = current.dependencyId
  draft.message = restore ? '已恢复默认实现。' : '实现已应用到课件。'
  return true
}

async function applySourceDraft(bridge: CourseV10DocumentBridge, draft: SourceDraft, restore = false): Promise<boolean> {
  if (draft.pending) return draft.pending
  const initialSession = draft.session
  if (!initialSession) return true
  let session: SourceSession = initialSession
  const fail = (message: string) => { draft.message = message; if (!draft.composing) draft.active = false; publishSourceDraft(bridge, draft); return false }
  if (draft.blocked && !restore) return fail(draft.blocked)
  if (draft.resumeRequired && !restore) return fail('上次输入尚未结束；原输入已恢复，请继续编辑后保存。')
  if (draft.composing) return fail('输入法组合尚未结束；原输入已保留。')
  if (!restore && draft.newPath) return fail('新增文件路径尚未完成；请新增文件或清空路径，原输入已保留。')
  const version = draft.version
  draft.busy = true
  const pending = (async () => {
    // Keep single-flight ownership even when validation or a no-op finishes synchronously.
    await Promise.resolve()
    try {
      if (draft.failure) {
        const outcome = await draft.failure.resolveInput(restore ? 'cancel' : 'retry')
        if (outcome === 'pending') return fail('上次应用的结果尚待确认；源码原稿仍保留，可稍后重试。')
        draft.failure = undefined
        if (restore) {
          const current = captureComponentSourceSession(bridge, session.target.documentId, session.instanceId,
            session.scope.kind, session.scope.kind === 'definition' ? session.scope.definition.id : undefined, true)
          if (current.target.epoch !== session.target.epoch) return fail('原文档会话已改变；源码草稿仍保留。')
          session = current; draft.session = current
        } else if (outcome === 'applied') {
          if (consumeAppliedSourceDraft(bridge, draft, session)) return true
          draft.blocked = '上次修改已应用，当前源码又有变化；原输入已保留，请载入当前基线后核对。'
          return fail(draft.blocked)
        }
      }
      // Restoring a local override can expose its default builtin again. Prepare
      // that source before accepting the operation, rather than failing its UI rebaseline afterwards.
      if (restore) {
        const fallback = session.target.project.definitions[session.target.project.instances[session.instanceId]?.definitionId ?? '']?.implementation
        if (fallback?.kind === 'builtin') await loadBuiltinComponentSource(fallback.key)
      }
      const edits: ComponentEdit[] = restore ? [{ type: 'implementation.set', instanceId: session.instanceId, implementation: null }]
        : componentSourceSessionEdits(session, draft.value)
      const result = edits.length ? await bridge.editCaptured(bridge.capture(edits, session.target)) : null
      if (draft.session === session && draft.version === version) {
        const target = bridge.captureTarget(session.target.documentId)
        if (target.epoch !== session.target.epoch) return fail('原文档会话已改变；源码草稿已保留，请载入当前基线后继续。')
        const original = target.project.instances[session.instanceId]
        const effective = session.scope.kind === 'definition' ? target.project.definitions[session.scope.definition.id]?.implementation
          : original?.implementationOverride ?? target.project.definitions[original?.definitionId ?? '']?.implementation
        if (effective?.kind === 'builtin' && !hasBuiltinComponentSource(effective.key)) {
          // The operation is already durable. Source display readiness must not
          // turn its accepted input into a failure or submit it a second time.
          resetDraft(draft, draft.value)
          draft.dependencyId = undefined
          draft.message = restore ? '已恢复默认实现，正在加载当前源码。'
            : result?.status === 'applied' ? '修改已应用，正在加载当前源码。' : '源码未改变，正在加载当前显示。'
          return true
        }
        const prepared = prepareComponentAuthorSource(target.project, effective)
        const modules = prepared ? componentAuthorSourceModules(target.project, target.resources, prepared) : []
        draft.moduleReplacements = new Map(edits.flatMap(edit => edit.type === 'definition.set' && edit.sourceOriginId
          ? [[edit.sourceOriginId, edit.definition.id] as const] : []))
        const dependencyId = restore ? undefined : draft.moduleReplacements.get(session.dependencyId ?? '') ?? session.dependencyId
        const selected = modules.find(module => module.id === dependencyId) ?? modules[0]
        draft.dependencyId = selected?.id
        resetDraft(draft, readSource(selected?.implementation, target.resources))
      }
      draft.message = restore ? '已恢复默认实现。' : result?.status === 'applied' ? '实现已应用到课件。' : '源码未改变，无需应用。'
      return !sourceDraftDirty({ ...draft, busy: false })
    } catch (error) {
      if (isCourseComponentInputFailure(error)) {
        draft.failure = error
        try {
          if (await settleCourseComponentInput(error) === 'applied') {
            if (draft.session === session && draft.version === version && consumeAppliedSourceDraft(bridge, draft, session, restore)) return true
            return fail('上次修改已确认应用；待核对的源码输入仍保留，请载入当前基线后继续。')
          }
        } catch { /* The raw files and exact resolver remain owned by this draft. */ }
      }
      return fail(`未应用：${error instanceof Error ? error.message : String(error)}；源码草稿已保留。`)
    }
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
    async prepare(documentId, mode = 'apply') {
      const issues: AdvancedDraftIssue[] = []
      for (const draft of cache.values()) if (draft.session?.target.documentId === documentId && sourceDraftDirty(draft) && (draft.active || draft.pending || draft.composing)) {
        if (draft.active && draft.activeOwner && !draft.activeOwner.isCurrent(draft.key)) parkSourceDraft(bridge, draft)
        const session = draft.session
        if (draft.composing) issues.push({ documentId, epoch: session.target.epoch, message: '源码输入法组合尚未结束；原输入已保留。' })
        else if (!draft.active && !draft.pending) continue
        else if (!await applySourceDraft(bridge, draft)
          && (mode === 'apply' || draft.session !== session || !sourceDraftDirty(draft) || draft.composing || draft.pending))
          issues.push({ documentId, epoch: session.target.epoch, message: draft.message ?? '源码草稿尚未应用。' })
      }
      return issues
    },
    preserve(documentId) {
      return [...cache.values()].filter(draft => draft.session?.target.documentId === documentId && sourceDraftDirty(draft)).map(draft => {
        const session = draft.session!
        return { kind: 'source', documentId, epoch: session.target.epoch, projectId: session.target.project.id,
          key: JSON.stringify([session.scope.kind, session.scope.kind === 'definition' ? session.scope.definition.id : session.instanceId]),
          payload: { projectId: session.target.project.id, instanceId: session.instanceId, scope: session.scope.kind, definitionId: session.scope.kind === 'definition' ? session.scope.definition.id : null,
            dependencyId: session.dependencyId ?? null,
            dependencyPaths: session.dependencyPaths ?? null,
            name: draft.name, value: sourceRecoveryValue(draft.value), baseline: sourceRecoveryValue(draft.recoveryBaseline ?? readSource(session.implementation, session.target.resources)),
            newPath: draft.newPath, message: draft.message, composing: draft.composing || Boolean(draft.resumeRequired) } } satisfies AdvancedDraftRecovery
      })
    },
    restore(documentId, record) {
      const saved = record.payload as unknown as { projectId?: string; instanceId: string; scope: 'instance' | 'definition'; definitionId: string | null; dependencyId?: string | null; dependencyPaths?: string[][] | null; name: string;
        value: ReturnType<typeof sourceRecoveryValue>; baseline: ReturnType<typeof sourceRecoveryValue>; newPath: string; message: string | null; composing: boolean }
      let session = captureComponentSourceSession(bridge, documentId, saved.instanceId, saved.scope, saved.definitionId ?? undefined, false, saved.dependencyId ?? undefined)
      if (saved.projectId && saved.projectId !== session.target.project.id) throw new Error('源码恢复稿属于原工程，原输入已保留。')
      let missingDependency = false
      if (saved.dependencyId && saved.dependencyPaths?.length) {
        const dependencyId = session.prepared && resolveComponentAuthorSourceDependencyPaths(session.target.project, session.prepared, saved.dependencyPaths, session.target.resources)
        if (dependencyId) session = captureComponentSourceSession(bridge, documentId, saved.instanceId, saved.scope, saved.definitionId ?? undefined, false, dependencyId)
        else { missingDependency = true; session.dependencyPaths = saved.dependencyPaths }
      }
      const key = JSON.stringify([documentId, session.target.epoch, saved.scope, saved.scope === 'definition' ? saved.definitionId : saved.instanceId])
      const existing = cache.get(key)
      if (existing?.session || existing?.busy || existing?.composing) return
      // Preserve the object observed by mounted controls, including their subscriptions.
      const draft = existing ?? freshDraft(key, saved.name, restoreSourceValue(saved.value))
      const currentValue = readSource(session.implementation, session.target.resources)
      if (!missingDependency && !saved.newPath && sourceValuesEqual(restoreSourceValue(saved.value), currentValue)) {
        resetDraft(draft, currentValue, false); draft.name = saved.name
        cache.set(key, draft)
        for (const notify of draft.listeners) notify()
        return 'consumed' as const
      }
      resetDraft(draft, restoreSourceValue(saved.value), false); draft.name = saved.name
      // Recovered text remains input until the user resumes editing or explicitly saves it.
      draft.session = session; draft.dependencyId = session.dependencyId; draft.newPath = saved.newPath; draft.version++; draft.resumeRequired = saved.composing
      draft.message = sourceValuesEqual(restoreSourceValue(saved.baseline), readSource(session.implementation, session.target.resources))
        ? saved.composing ? '上次输入尚未结束；原输入已恢复，请继续编辑后保存。' : '已恢复源码原输入；尚未自动应用。'
        : '源码基线已改变；原输入已恢复，请载入当前基线后检查。'
      if (!sourceValuesEqual(restoreSourceValue(saved.baseline), readSource(session.implementation, session.target.resources))) {
        draft.recoveryBaseline = restoreSourceValue(saved.baseline)
        draft.blocked = draft.message
      }
      if (missingDependency) draft.blocked = draft.message = '原源码模块的引用已移除或拆分；原输入已保留，请恢复对应依赖后载入当前基线。'
      cache.set(key, draft)
      for (const notify of draft.listeners) notify()
    },
    release(documentId) {
      for (const [key, draft] of cache) if (draft.session?.target.documentId === documentId || JSON.parse(key)[0] === documentId) {
        draft.session = null; draft.composing = false; draft.busy = false; draft.blocked = undefined; draft.resumeRequired = undefined; draft.message = null
        cache.delete(key)
        for (const notify of draft.listeners) notify()
      }
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
  const currentModel = view.views.find(item => item.documentId === owner)?.model ?? view.documents.find(item => item.documentId === owner)?.model
  const model = currentModel?.kind === 'course-v10' ? currentModel : undefined
  const resources = model?.resources
  const builtinKey = implementation?.kind === 'builtin' ? implementation.key : null
  const [sourceLoad, setSourceLoad] = useState<{ key: string; status: 'loading' | 'ready' | 'unavailable' | 'failed'; message?: string } | null>(null)
  const [sourceRetry, retrySource] = useState(0)
  useEffect(() => {
    if (!builtinKey || hasBuiltinComponentSource(builtinKey)) return
    let active = true
    setSourceLoad({ key: builtinKey, status: 'loading' })
    void loadBuiltinComponentSource(builtinKey).then(source => {
      if (active) setSourceLoad({ key: builtinKey, status: source ? 'ready' : 'unavailable' })
    }, error => {
      if (active) setSourceLoad({ key: builtinKey, status: 'failed', message: error instanceof Error ? error.message : String(error) })
    })
    return () => { active = false }
  }, [builtinKey, sourceRetry])
  const builtinReady = !builtinKey || hasBuiltinComponentSource(builtinKey)
  const prepared = useMemo(() => model && builtinReady ? prepareComponentAuthorSource(model.project, implementation) : undefined,
    [model?.project, implementation, builtinReady, sourceLoad])
  const rootValue = useMemo(() => readSource(prepared?.implementation, resources ?? { assets: {}, components: {} }), [prepared, resources])
  const liveModules = useMemo(() => prepared && model
    ? componentAuthorSourceModules(model.project, model.resources, prepared) : [], [prepared, model?.project, resources])
  const [, refresh] = useState(0)
  let cache = drafts.get(bridge)
  if (!cache) { cache = new Map(); drafts.set(bridge, cache); sourceLifecycle(bridge, cache) }
  const getDraft = () => {
    let draft = cache!.get(key)
    if (!draft) { draft = freshDraft(key, instance?.name ?? instance?.id ?? '', rootValue); cache!.set(key, draft) }
    return draft
  }
  const draftRef = useRef<SourceDraft>(getDraft())
  const panel = useRef<HTMLDetailsElement>(null)
  const currentKey = useRef(key); currentKey.current = key
  const inputOwner = useRef({ isCurrent: (candidate: string) => currentKey.current === candidate && draftRef.current.key === candidate && Boolean(panel.current?.isConnected)
    && !panel.current?.closest('[hidden],[inert],details:not([open])') })
  if (draftRef.current.key !== key && !draftRef.current.composing) draftRef.current = getDraft()
  const draft = draftRef.current, value = draft.value
  const authorSource = draft.session?.prepared ?? prepared
  const moduleProject = draft.session?.target.project ?? model?.project
  const moduleResources = draft.session?.target.resources ?? resources
  const modules = useMemo(() => authorSource && moduleProject && moduleResources
    ? componentAuthorSourceModules(moduleProject, moduleResources, authorSource) : [], [authorSource, moduleProject, moduleResources])
  const selectedModule = (draft.key === key ? liveModules.find(module => module.id === draft.dependencyId) : undefined) ?? liveModules[0]
  const initial = useMemo(() => readSource(selectedModule?.implementation, resources ?? { assets: {}, components: {} }), [selectedModule?.implementation, resources])
  const render = () => publishSourceDraft(bridge, draft)
  useEffect(() => {
    const notify = () => refresh(version => version + 1)
    draft.listeners.add(notify)
    return () => {
      draft.listeners.delete(notify)
      if (draft.activeOwner !== inputOwner.current) return
      parkSourceDraft(bridge, draft, true)
    }
  }, [draft])
  useEffect(() => {
    // Subscribe the mounted control before the existing provider adopts pending
    // recovery input, including a source prepared while this panel was closed.
    if (builtinReady) sourceLifecycle(bridge, cache!)
  }, [bridge, cache, builtinKey, builtinReady])
  const active = useRef({ key, initial }); active.current = { key, initial }
  useEffect(() => {
    if (draft.session || draft.busy || draft.composing || draft.key !== key) return
    draft.dependencyId = selectedModule?.id
    resetDraft(draft, initial); render()
  }, [draft, key, initial])
  const capturedInstance = draft.session && view.views.find(item => item.documentId === draft.session!.target.documentId)?.model.project.instances[draft.session.instanceId]
  const locked = draft.session ? capturedInstance?.locked === true : instance?.locked === true
  const unavailable = !!instance && !prepared, stale = !!draft.session && draft.key !== key
  const disabled = draft.busy || locked || unavailable && !draft.session
  const capture = () => {
    draft.active = true; draft.activeOwner = inputOwner.current
    if (draft.session) return draft.session
    if (!instance) throw new Error('当前没有源码目标，请选择对象或创建运行时。')
    draft.session = captureComponentSourceSession(bridge, owner, instance.id, scope, undefined, false, draft.dependencyId)
    draft.name = instance.name ?? instance.id
    return draft.session
  }
  const change = (next: SourceValue) => {
    if (disabled) return
    try { capture(); draft.version++; draft.value = next; draft.resumeRequired = false; draft.message = null; render() }
    catch (error) { draft.message = error instanceof Error ? error.message : String(error); render() }
  }
  const nativeHistory = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) event.stopPropagation()
  }
  const save = async (restore = false, acceptRetained = false) => {
    if (disabled || draft.composing) return
    try { capture(); if (acceptRetained) draft.resumeRequired = false } catch (error) { draft.message = String(error); render(); return }
    if (!await applySourceDraft(bridge, draft, restore) && draft.message) report(draft.message)
  }
  const selectModule = async (dependencyId?: string) => {
    if (draft.busy || draft.composing || stale || !instance || dependencyId === draft.dependencyId) return
    if (draft.session && !await applySourceDraft(bridge, draft)) {
      if (draft.message) report(draft.message)
      return
    }
    try {
      const target = bridge.captureTarget(owner)
      if (target.epoch !== epoch) throw new Error('原文档会话已改变，请重新选择源码对象。')
      const original = target.project.instances[instance.id]
      const effective = scope === 'definition' ? target.project.definitions[instance.definitionId]?.implementation
        : original?.implementationOverride ?? target.project.definitions[original?.definitionId ?? '']?.implementation
      if (effective?.kind === 'builtin') await loadBuiltinComponentSource(effective.key)
      const prepared = prepareComponentAuthorSource(target.project, effective)
      const available = prepared ? componentAuthorSourceModules(target.project, target.resources, prepared) : []
      const nextId = draft.moduleReplacements?.get(dependencyId ?? '') ?? dependencyId
      const selected = available.find(module => module.id === nextId)
      draft.dependencyId = selected?.id
      resetDraft(draft, readSource((selected ?? available[0])?.implementation, target.resources), false)
      draft.moduleReplacements = undefined; draft.version++
      if (!selected && nextId) draft.message = '该模块已不在当前依赖中，已显示作者入口。'
    } catch (error) { draft.message = error instanceof Error ? error.message : String(error) }
    render()
  }
  const loadBaseline = async () => {
    if (!draft.session || disabled || draft.composing) return
    const ownerAtStart = inputOwner.current
    draft.activeOwner = ownerAtStart
    draft.busy = true; render()
    try {
      const previous = draft.session
      if (draft.failure) {
        const outcome = await draft.failure.resolveInput('cancel')
        if (outcome === 'pending') { draft.message = '上次应用的结果尚待确认；源码原稿仍保留。'; return }
        draft.failure = undefined
      }
      const definitionId = previous.scope.kind === 'definition' ? previous.scope.definition.id : undefined
      const current = bridge.read().documents.find(snapshot => snapshot.documentId === previous.target.documentId)?.model
      if (current?.kind === 'course-v10') {
        const instance = current.project.instances[previous.instanceId]
        const effective = previous.scope.kind === 'definition' ? current.project.definitions[definitionId ?? '']?.implementation
          : instance?.implementationOverride ?? current.project.definitions[instance?.definitionId ?? '']?.implementation
        if (effective?.kind === 'builtin') await loadBuiltinComponentSource(effective.key)
      }
      let next = captureComponentSourceSession(bridge, previous.target.documentId, previous.instanceId,
        previous.scope.kind, definitionId, true, previous.dependencyId)
      if (previous.dependencyId && previous.dependencyPaths?.length) {
        const dependencyId = next.prepared && resolveComponentAuthorSourceDependencyPaths(next.target.project, next.prepared, previous.dependencyPaths, next.target.resources)
        if (!dependencyId) throw new Error('原源码模块的引用已移除或拆分；原输入已保留，请恢复对应依赖后再载入。')
        if (dependencyId !== next.dependencyId) next = captureComponentSourceSession(bridge, previous.target.documentId, previous.instanceId,
          previous.scope.kind, definitionId, true, dependencyId)
      }
      if (previous.dependencyId && !next.implementation) throw new Error('原源码模块已不存在；原输入已保留，请恢复对应依赖后再载入。')
      draft.value = rebaseSourceDraft(draft.value, draft.recoveryBaseline ?? readSource(previous.implementation, previous.target.resources), readSource(next.implementation, next.target.resources))
      draft.session = next; draft.dependencyId = next.dependencyId; draft.recoveryBaseline = undefined; draft.blocked = undefined
      draft.active = draft.activeOwner === ownerAtStart && ownerAtStart.isCurrent(draft.key)
      if (!draft.active) draft.activeOwner = undefined
      draft.version++; draft.message = '已载入当前基线并保留各文件草稿，请检查后重新应用。'
    } catch (error) { draft.message = String(error) }
    finally { draft.busy = false; render() }
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
  return <details ref={panel} open onKeyDownCapture={nativeHistory} onBlurCapture={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null) && draft.session) void save()
  }}><summary>{scope === 'definition' ? '共享定义源码' : '组件实现源码'}</summary>
    {stale && <p role="status">草稿属于“{draft.name}”；应用只修改原文档与原{draft.session?.scope.kind === 'definition' ? '共享定义' : '对象'}。</p>}
    {locked && <p role="status">源码对象已锁定，当前为只读。</p>}
    {unavailable && !draft.session && (builtinKey && sourceLoad?.key === builtinKey && sourceLoad.status === 'failed'
      ? <p role="status">源码加载未完成：{sourceLoad.message}<button type="button" onClick={() => retrySource(value => value + 1)}>重试加载</button></p>
      : <p role="status">{builtinKey && (sourceLoad?.key !== builtinKey || sourceLoad.status !== 'unavailable') ? `正在加载 ${builtinKey} 的完整源码…` : `此内置实现的完整源码尚未提供：${builtinKey ?? instance?.definitionId}。`}</p>)}
    <label>源码模块<select aria-label="组件源码模块" value={draft.dependencyId ?? ''} disabled={draft.busy || draft.composing || stale || !modules.length}
      onChange={event => void selectModule(event.target.value || undefined)}>
      {modules.map(module => <option key={module.id ?? ''} value={module.id ?? ''}>{module.id ? `完整依赖：${module.title}（${module.id}）` : '作者入口'}</option>)}
      {draft.dependencyId && !modules.some(module => module.id === draft.dependencyId) && <option value={draft.dependencyId}>原依赖（当前已不可用）</option>}
    </select></label>
    <p>{(draft.session?.scope.kind ?? scope) === 'definition' ? '修改会影响所有使用此共享定义且未覆盖实现的对象。'
      : draft.dependencyId ? '依赖修改仅应用于当前对象，其他对象继续使用原实现。' : '修改仅应用于当前对象；可从“源码模块”查看并编辑完整依赖。'}</p>
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
    {names.filter(name => value.files[name].text !== null).map(name => <div key={`${draft.key}/${draft.dependencyId ?? ''}/${name}`} hidden={name !== value.selected}>
      <textarea aria-label={name === value.selected ? '组件实现源码' : undefined} value={value.files[name].text ?? ''} readOnly={disabled}
        onChange={event => change({ ...draft.value, files: { ...draft.value.files, [name]: { text: event.target.value, bytes: encode(event.target.value) } } })}
        onCompositionStart={() => { try { capture(); draft.composing = true; render() } catch (error) { draft.message = String(error); render() } }}
        onCompositionEnd={() => { setTimeout(() => {
          if (draftRef.current !== draft || draft.activeOwner !== inputOwner.current || !draft.listeners.size) return
          draft.composing = false; draft.resumeRequired = false
          if (!inputOwner.current.isCurrent(draft.key)) { parkSourceDraft(bridge, draft); return }
          render(); void save()
        }, 0) }}
        spellCheck={false} wrap="off" className="developer-code-editor" style={{ width: '100%', minHeight: 240, fontFamily: 'monospace' }} />
    </div>)}
    {!file && <p>此组件还没有源码文件。</p>}
    <button disabled={disabled || draft.composing} onClick={() => void save(false, true)}>保存实现</button>
    {scope === 'instance' && <button disabled={disabled || draft.composing} onClick={() => void save(true, true)}>恢复默认实现</button>}
    {draft.session && <button disabled={disabled || draft.composing} onClick={loadBaseline}>载入当前基线并保留草稿</button>}
    <button disabled={draft.busy || draft.composing} onClick={() => { void (async () => {
      const initialAtStart = active.current.initial, valueAtStart = draft.value, version = draft.version, pathAtStart = draft.newPath
      draft.busy = true; render()
      try {
        if (draft.failure) {
          const outcome = await draft.failure.resolveInput('cancel')
          if (outcome === 'pending') { draft.message = '上次应用的结果尚待确认；原稿仍保留，请稍后重试。'; return }
          draft.failure = undefined
        }
        if (draft.value !== valueAtStart || draft.version !== version || draft.newPath !== pathAtStart) {
          draft.message = '处理期间又有新输入；源码原稿仍保留。'; return
        }
        let initial = initialAtStart
        if (draft.session && draft.key === key) {
          const session = draft.session, fresh = captureComponentSourceSession(bridge, session.target.documentId, session.instanceId,
            session.scope.kind, session.scope.kind === 'definition' ? session.scope.definition.id : undefined, true, session.dependencyId)
          initial = readSource(fresh.implementation, fresh.target.resources)
        }
        const selected = draft.value.selected
        const next = draft.key === key && Object.hasOwn(initial.files, selected) ? { ...initial, selected } : initial
        const dependencyId = draft.key === key ? draft.dependencyId : undefined
        const replacement = { ...freshDraft(key, instance?.name ?? instance?.id ?? '', next), dependencyId }
        cache!.delete(draft.key); cache!.set(key, replacement)
        if (draftRef.current === draft) draftRef.current = replacement
      } catch (error) { draft.message = error instanceof Error ? error.message : String(error) }
      finally { draft.busy = false; render() }
    })() }}>放弃草稿</button>
    {draft.message && <p role="status">{draft.message}</p>}
  </details>
}
