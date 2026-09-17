import { useEffect, useRef, useState } from 'react'
import type { LessonMaterialRead, LessonMaterialRecord, MaterialExtraction } from '../../shared/materialExtraction'
import type { LessonMaterialSelectResult } from '../../shared/lessonMaterialDesktop'
import { extractMaterial } from '../project/materialExtraction'

export interface LessonMaterialBrowserProps {
  /** Change this whenever the active lesson identity changes. */
  targetKey: string
  selections?: { id: string; fragmentIds: string[] }[]
  onSelect?(record: LessonMaterialRecord, fragmentIds: string[]): void
  selectSource(): Promise<LessonMaterialSelectResult>
  list(): Promise<LessonMaterialRecord[]>
  importMaterial(input: { title: string; original: Uint8Array; extraction: MaterialExtraction }): Promise<LessonMaterialRecord>
  read(input: { id: string; extractionVersion: string; fragmentIds: string[] }): Promise<LessonMaterialRead>
}
function Images({ assets }: { assets: LessonMaterialRead['assets'] }) {
  const [urls, setUrls] = useState<{ id: string; url: string }[]>([])
  useEffect(() => {
    const next = assets.map(asset => ({ id: asset.id, url: URL.createObjectURL(new Blob([asset.bytes.slice().buffer as ArrayBuffer], { type: asset.mime })) }))
    setUrls(next)
    return () => { for (const item of next) URL.revokeObjectURL(item.url) }
  }, [assets])
  return <>{urls.map(item => <figure key={item.id}><img src={item.url} alt="材料原图或页面图像" style={{ maxWidth: '100%', height: 'auto' }} /><figcaption>{item.id}</figcaption></figure>)}</>
}
export function LessonMaterialBrowser(props: LessonMaterialBrowserProps) {
  const [records, setRecords] = useState<LessonMaterialRecord[]>([])
  const [selected, setSelected] = useState<LessonMaterialRead | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const generation = useRef(0)
  const api = useRef(props); api.current = props
  useEffect(() => {
    const token = ++generation.current
    setRecords([]); setSelected(null); setError(''); setBusy(false)
    void api.current.list().then(next => { if (token === generation.current) setRecords(next) }).catch(reason => { if (token === generation.current) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { generation.current++ }
  }, [props.targetKey])
  async function run(action: () => Promise<void>) {
    const token = generation.current
    setBusy(true); setError('')
    try { await action() }
    catch (reason) { if (token === generation.current) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { if (token === generation.current) setBusy(false) }
  }
  return <section aria-label="课例材料" style={{ padding: 16, overflow: 'auto', height: '100%' }}>
    <h2>课例材料</h2>
    <p>添加教材、教案或课件，查看提取的正文、图示与出处。材料独立保存在当前课例。</p>
    <button type="button" disabled={busy} onClick={() => {
        const token = generation.current
        const currentApi = api.current
        void run(async () => {
          const result = await currentApi.selectSource()
          if (token !== generation.current) return
          const failures = [...result.failures]
          for (const source of result.sources) {
            try {
              const original = source.bytes
              const extraction = await extractMaterial(original, source.title)
              if (token !== generation.current) return
              await currentApi.importMaterial({ title: source.title, original, extraction })
            } catch (reason) { failures.push({ title: source.title, message: reason instanceof Error ? reason.message : String(reason) }) }
          }
          if (failures.length && token === generation.current) setError(failures.map(failure => `${failure.title}：${failure.message}`).join('；'))
          const next = await currentApi.list()
          if (token === generation.current) setRecords(next)
        })
      }}>添加材料（PDF / DOCX / PPTX / TXT / MD / CSV，可多选）</button>
    {busy && <p role="status">正在读取材料…</p>}
    {error && <p role="alert">{error}</p>}
    {!records.length && !busy && <p>当前课例尚未添加材料。</p>}
    {records.map(record => {
      const selectedFragments = props.selections?.find(item => item.id === record.id)?.fragmentIds ?? []
      const allSelected = record.fragments.length > 0 && record.fragments.every(fragment => selectedFragments.includes(fragment.id))
      return <article key={record.id}>
      <h3>{record.title}</h3>
      {props.onSelect && <label><input type="checkbox" checked={allSelected} ref={node => { if (node) node.indeterminate = selectedFragments.length > 0 && !allSelected }} onChange={event => props.onSelect?.(record, event.target.checked ? record.fragments.map(fragment => fragment.id) : [])} />用于本课例创作（整份材料）</label>}
      <p>{record.fragments.length} 个可查看片段 · {record.assets.length} 份图像</p>
      {record.gaps.length > 0 && <details><summary>有 {record.gaps.length} 项内容需要复核</summary><ul>{record.gaps.map((gap, index) => <li key={index}>{gap.locator.page ? `第 ${gap.locator.page} 页：` : ''}{gap.reason}</li>)}</ul></details>}
      <ul>{record.fragments.map((fragment, index) => <li key={fragment.id}>
        {props.onSelect && <label><input type="checkbox" checked={selectedFragments.includes(fragment.id)} onChange={event => props.onSelect?.(record, event.target.checked ? [...selectedFragments, fragment.id] : selectedFragments.filter(id => id !== fragment.id))} />采用片段 {index + 1}</label>}
        <button type="button" disabled={busy} onClick={() => {
          const token = generation.current
          const currentApi = api.current
          void run(async () => {
            const next = await currentApi.read({ id: record.id, extractionVersion: record.extractionVersion, fragmentIds: [fragment.id] })
            if (token === generation.current) setSelected(next)
          })
        }}>{fragment.locator.page ? `第 ${fragment.locator.page} 页 · ` : ''}{({ text: '正文', table: '表格', formula: '公式原式', image: '图像' })[fragment.kind]}{fragment.text ? `：${fragment.text.slice(0, 60)}` : ''}</button>
      </li>)}</ul>
    </article>})}
    {selected && <article aria-label="材料片段内容"><h3>片段内容与出处</h3>{selected.fragments.map(fragment => <section key={fragment.id}><p>{fragment.locator.part}{fragment.locator.page ? ` · 第 ${fragment.locator.page} 页` : ''}{fragment.locator.paragraph ? ` · 片段 ${fragment.locator.paragraph}` : ''}</p>{fragment.text && <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{fragment.text}</pre>}</section>)}<Images assets={selected.assets} /></article>}
  </section>
}
