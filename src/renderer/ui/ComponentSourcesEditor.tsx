import { useEffect, useRef, useState } from 'react'
import { selectActiveCourseProjectDocument, useEditorStore } from '../store/editorStore'
import type { ComponentPackageSourceTarget } from '../components/commitComponentPackageAuthoring'
import { collectCourseComponentPackageReferences } from '../components/courseComponentPackageTransactions'

interface SourceDraft {
  target: ComponentPackageSourceTarget
  files: Record<string, Uint8Array>
  text: Record<string, string>
  file: string
}
// Transient editor drafts survive panel/file/instance switches, never enter a project or export.
const drafts = new Map<string, SourceDraft>()

export function ComponentSourcesEditor({ packageId }: { packageId: string }) {
  const project = useEditorStore(selectActiveCourseProjectDocument)
  const projectPath = useEditorStore(state => state.projectPath)
  const generation = useEditorStore(state => state.courseAuthoringSession?.token.generation ?? null)
  const data = useEditorStore(state => state.componentPackages[packageId])
  const capture = useEditorStore(state => state.captureComponentPackageSourceTarget)
  const apply = useEditorStore(state => state.updateComponentPackageSources)
  const key = JSON.stringify([project?.id, projectPath, packageId])
  const [, refresh] = useState(0)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const pending = useRef<AbortController | null>(null)
  useEffect(() => { setStatus(''); setBusy(false); return () => { pending.current?.abort(); pending.current = null } }, [key])
  if (!project || !data) return null
  const getDraft = () => {
    let draft = drafts.get(key)
    if (!draft) {
      draft = { target: capture(packageId), files: structuredClone(data.files), text: {}, file: data.manifest.entry }
      drafts.set(key, draft)
    }
    return draft
  }
  const draft = getDraft()
  const text = draft.text[draft.file] ?? new TextDecoder().decode(draft.files[draft.file])
  let entry = data.manifest.entry
  try { entry = JSON.parse(draft.text['manifest.json'] ?? new TextDecoder().decode(draft.files['manifest.json'])).entry ?? entry } catch { /* Keep both drafts while manifest is incomplete. */ }
  const stale = draft.target.documentRevision !== project.revision || draft.target.baseContentIdentity !== project.componentPackages[packageId]?.contentSha256
    || draft.target.sessionGeneration !== generation
  const count = collectCourseComponentPackageReferences(project, packageId).length
  const submit = async () => {
    const controller = new AbortController()
    pending.current = controller
    setBusy(true); setStatus('正在校验所有实例并生成后备图面…')
    try {
      const files = { ...draft.files }
      for (const [path, value] of Object.entries(draft.text)) files[path] = new TextEncoder().encode(value)
      const result = await apply(draft.target, files, controller.signal)
      drafts.delete(key)
      if (pending.current === controller) { setStatus(result === 'unchanged' ? '源码未改变，无需写入。' : '源码已应用，所有引用实例已同步。'); refresh(value => value + 1) }
    } catch (error) {
      if (pending.current === controller) setStatus(`${error instanceof Error ? error.message : String(error)}；草稿已保留。`)
    } finally {
      if (pending.current === controller) { pending.current = null; setBusy(false) }
    }
  }
  return <section className="developer-card component-source-editor">
    <p>共享工程包 · {count} 个实例 · {data.manifest.version}</p>
    <div className="developer-document-tabs" role="tablist" aria-label="组件文档">
      {[entry, 'manifest.json'].map(file => <button key={file} type="button" role="tab" aria-selected={draft.file === file}
        onClick={() => { draft.file = file; refresh(value => value + 1) }}>{file}</button>)}
    </div>
    <textarea aria-label={draft.file === 'manifest.json' ? '组件 Manifest' : '组件 Runtime'} spellCheck={false}
      className="developer-code-editor" value={text} disabled={busy}
      onChange={event => { draft.text[draft.file] = event.target.value; refresh(value => value + 1) }} />
    <div className="developer-card__actions">
      <button type="button" className="primary-button" disabled={busy || stale} onClick={() => { void submit() }}>校验并应用组件源码</button>
      {busy && <button type="button" onClick={() => pending.current?.abort()}>取消校验</button>}
      {stale && <button type="button" onClick={() => {
        if (draft.text['manifest.json']) {
          try { draft.text['manifest.json'] = JSON.stringify({ ...JSON.parse(draft.text['manifest.json']), id: data.manifest.id, version: data.manifest.version }, null, 2) }
          catch { setStatus('Manifest 草稿尚不是有效 JSON，请先修正再载入基线。'); return }
        }
        draft.target = capture(packageId)
        draft.files = structuredClone(data.files)
        setStatus('已载入当前基线并保留各文件草稿，请检查后重新应用。'); refresh(value => value + 1)
      }}>载入当前基线并保留草稿</button>}
    </div>
    <p role="status">{stale ? '工程已改变，原草稿未提交。请载入当前基线并检查草稿。' : status || 'ID 保持不变；应用时自动生成新版本，未改文件完整保留。'}</p>
  </section>
}
