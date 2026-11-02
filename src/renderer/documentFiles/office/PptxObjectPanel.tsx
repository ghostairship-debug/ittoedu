import { useEffect, useRef, useState } from 'react'
import type { OfficeContentInspection, PptxObjectEdit, PptxObjectInspection, PptxTextStyle } from '../../../shared/workbench/officeFiles'

// These are field drafts only. Accepted content, versions and undo belong to the main file owner.
type SlideIdentity = Pick<Extract<OfficeContentInspection, { format: 'pptx' }>['slides'][number], 'index' | 'part' | 'partVersion'>
interface Props {
  object: PptxObjectInspection; slide: SlideIdentity; disabled: boolean
  onApply(edits: PptxObjectEdit[]): Promise<void>
  onDirtyChange(dirty: boolean): void
}
type Scope = { paragraph?: number; run?: number }
const parseScope = (value: string): Scope => value === 'all' ? {} : value.startsWith('p:') ? { paragraph: Number(value.slice(2)) }
  : { paragraph: Number(value.split(':')[1]), run: Number(value.split(':')[2]) }
const toCm = (points: number | undefined) => points === undefined ? '' : String(Math.round(points * 2.54 / 72 * 1000) / 1000)
const fromCm = (value: string) => Number(value) * 72 / 2.54
function valueFor(object: PptxObjectInspection, scope: Scope) {
  const run = scope.paragraph !== undefined && scope.run !== undefined ? object.runs[scope.paragraph]?.[scope.run] : undefined
  const text = run?.text ?? (scope.paragraph === undefined ? object.text : object.paragraphs[scope.paragraph] ?? '')
  const style = run?.style ?? (scope.paragraph === undefined ? object.textStyle : object.runs[scope.paragraph]?.[0]?.style) ?? {}
  return {
    text, x: toCm(object.frame?.x), y: toCm(object.frame?.y), width: toCm(object.frame?.width), height: toCm(object.frame?.height), rotation: String(object.frame?.rotation ?? 0),
    bold: style.bold === undefined ? 'inherit' : String(style.bold), italic: style.italic === undefined ? 'inherit' : String(style.italic),
    underline: style.underline === undefined ? 'inherit' : String(style.underline), fontSize: style.fontSize === undefined ? '' : String(style.fontSize),
    fontFamily: style.fontFamily ?? '', color: style.color ?? '', fill: object.fill === null ? 'none' : object.fill ?? 'inherit', stroke: object.stroke === null ? 'none' : object.stroke ?? 'inherit',
    left: String(object.crop?.left ?? 0), top: String(object.crop?.top ?? 0), right: String(object.crop?.right ?? 0), bottom: String(object.crop?.bottom ?? 0),
    cells: object.cells?.map(row => [...row]) ?? [],
  }
}
type Draft = ReturnType<typeof valueFor>
const objectSignature = (object: PptxObjectInspection) => JSON.stringify(object)
const kinds = { shape: '文字 / 形状', picture: '图片', table: '表格', group: '组合', unsupported: '受限对象' }

export function PptxObjectPanel({ object, slide, disabled, onApply, onDirtyChange }: Props) {
  const [scope, setScope] = useState('all')
  const [baseline, setBaseline] = useState(() => valueFor(object, {}))
  const [draft, setDraft] = useState(() => valueFor(object, {}))
  const [error, setError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [reset, setReset] = useState(0)
  const forceReset = useRef(false)
  const baseVersion = useRef(slide.partVersion)
  const previousObject = useRef(objectSignature(object))
  const imageInput = useRef<HTMLInputElement>(null)
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline)
  const can = (operation: PptxObjectInspection['editable'][number]) => object.editable.includes(operation)
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false) }, [dirty, onDirtyChange])
  useEffect(() => {
    const signature = objectSignature(object)
    if (!dirty || forceReset.current) {
      const next = valueFor(object, parseScope(scope))
      setBaseline(next); setDraft(next); setStale(false)
      previousObject.current = signature; baseVersion.current = slide.partVersion; forceReset.current = false
    } else if (signature === previousObject.current) {
      // An AI edit to another object may advance the slide without invalidating this local field draft.
      baseVersion.current = slide.partVersion
    } else setStale(true)
  }, [object, slide.partVersion, scope, reset])
  const target = () => ({ slide: slide.index, part: slide.part, partVersion: baseVersion.current, shapeId: object.shapeId })
  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => { setDraft(previous => ({ ...previous, [key]: value })); setError(null) }
  const discard = () => { forceReset.current = true; setReset(value => value + 1); setError(null) }
  const changed = (key: keyof Draft) => JSON.stringify(draft[key]) !== JSON.stringify(baseline[key])
  const commit = async (edits: PptxObjectEdit[]) => {
    setError(null)
    try {
      if (stale) throw new Error('这个对象已经有新的修改。当前输入已保留，请先核对原件；不会自动覆盖。')
      await onApply(edits)
      forceReset.current = true; setReset(value => value + 1)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }
  const apply = async () => {
    const edits: PptxObjectEdit[] = [], scopeTarget = parseScope(scope)
    if (changed('text')) edits.push(scopeTarget.run !== undefined && scopeTarget.paragraph !== undefined
      ? { ...target(), type: 'runText', paragraph: scopeTarget.paragraph, run: scopeTarget.run, text: draft.text }
      : { ...target(), type: 'text', ...scopeTarget, text: draft.text })
    const geometry: Partial<Record<'x' | 'y' | 'width' | 'height' | 'rotation', number>> = {}
    for (const key of ['x', 'y', 'width', 'height', 'rotation'] as const) if (changed(key)) {
      if (!draft[key].trim() || !Number.isFinite(Number(draft[key]))) { setError('请填写有效的位置、尺寸或角度'); return }
      geometry[key] = key === 'rotation' ? Number(draft[key]) : fromCm(draft[key])
    }
    if (Object.keys(geometry).length) edits.push({ ...target(), type: 'transform', ...geometry })
    const style: Partial<PptxTextStyle> = {}
    for (const key of ['bold', 'italic', 'underline'] as const) if (changed(key) && draft[key] !== 'inherit') style[key] = draft[key] === 'true'
    if (changed('fontSize') && draft.fontSize) style.fontSize = Number(draft.fontSize)
    if (changed('fontFamily') && draft.fontFamily.trim()) style.fontFamily = draft.fontFamily.trim()
    if (changed('color') && draft.color) style.color = draft.color.replace(/^#/, '')
    if (Object.keys(style).length) edits.push({ ...target(), type: 'textStyle', ...scopeTarget, style })
    const shapeStyle: { fill?: string | null; stroke?: string | null } = {}
    for (const key of ['fill', 'stroke'] as const) if (changed(key) && draft[key] !== 'inherit') shapeStyle[key] = draft[key] === 'none' ? null : draft[key].replace(/^#/, '')
    if (Object.keys(shapeStyle).length) edits.push({ ...target(), type: 'shapeStyle', ...shapeStyle })
    if (['left', 'top', 'right', 'bottom'].some(key => changed(key as keyof Draft))) edits.push({ ...target(), type: 'imageCrop',
      left: Number(draft.left), top: Number(draft.top), right: Number(draft.right), bottom: Number(draft.bottom) })
    if (changed('cells')) for (let row = 0; row < draft.cells.length; row++) for (let column = 0; column < draft.cells[row].length; column++)
      if (draft.cells[row][column] !== baseline.cells[row]?.[column]) edits.push({ ...target(), type: 'tableCell', row, column, text: draft.cells[row][column] })
    if (edits.length) await commit(edits)
  }
  const replaceImage = async (file: File | undefined) => {
    if (!file) return
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('无法读取所选图片'))
        reader.readAsDataURL(file)
      })
      const match = /^data:(image\/(?:png|jpeg|gif));base64,(.+)$/s.exec(data)
      if (!match) throw new Error('请选择 PNG、JPEG 或 GIF 图片')
      await commit([{ ...target(), type: 'replaceImage', image: { contentType: match[1] as 'image/png' | 'image/jpeg' | 'image/gif', base64: match[2] } }])
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }
  const numeric = (key: 'x' | 'y' | 'width' | 'height' | 'rotation' | 'left' | 'top' | 'right' | 'bottom', label: string) => <label key={key}>{label}<input type="number" step="any" value={draft[key]} onChange={event => update(key, event.target.value)} /></label>
  return <aside className="pptx-object-panel" aria-label="演示文稿对象编辑">
    <header><strong>{object.name || kinds[object.kind]}</strong><span>{kinds[object.kind]}</span></header>
    {stale && <p role="alert">原件中的这个对象已更新。当前输入保留，应用前请核对。</p>}
    {error && <p role="alert">{error}</p>}
    <fieldset disabled={disabled}>
      {can('text') && <section>
        <label>文字范围<select aria-label="文字范围" value={scope} onChange={event => {
          if (dirty) { setError('请先应用或取消当前修改，再切换文字范围'); return }
          setScope(event.target.value)
        }}>
          <option value="all">整个文本对象</option>
          {object.paragraphs.map((_, paragraph) => <option key={`p:${paragraph}`} value={`p:${paragraph}`}>第 {paragraph + 1} 段</option>)}
          {object.runs.flatMap((runs, paragraph) => runs.map((_, run) => <option key={`r:${paragraph}:${run}`} value={`r:${paragraph}:${run}`}>第 {paragraph + 1} 段 · 第 {run + 1} 个文字片段</option>))}
        </select></label>
        <label>文字内容<textarea aria-label="对象文字" rows={4} value={draft.text} onChange={event => update('text', event.target.value)} /></label>
        <div className="pptx-object-panel__grid">
          <label>字号<input type="number" min="1" step="any" placeholder="沿用原样" value={draft.fontSize} onChange={event => update('fontSize', event.target.value)} /></label>
          <label>字体<input placeholder="沿用原样" value={draft.fontFamily} onChange={event => update('fontFamily', event.target.value)} /></label>
          {([['bold', '粗体'], ['italic', '斜体'], ['underline', '下划线']] as const).map(([key, label]) => <label key={key}>{label}<select value={draft[key]} onChange={event => update(key, event.target.value)}><option value="inherit">沿用原样</option><option value="true">开启</option><option value="false">关闭</option></select></label>)}
          <label>文字颜色<input type="color" value={`#${draft.color || '000000'}`} onChange={event => update('color', event.target.value.slice(1))} /></label>
        </div>
      </section>}
      {can('transform') && object.frame && <section><h4>位置与尺寸（厘米）</h4><div className="pptx-object-panel__grid">
        {numeric('x', '横向位置')}{numeric('y', '纵向位置')}{numeric('width', '宽度')}{numeric('height', '高度')}{numeric('rotation', '旋转角度')}
      </div></section>}
      {can('shapeStyle') && <section><h4>形状</h4><div className="pptx-object-panel__grid">
        <label>填充<input type="color" value={`#${/^[a-fA-F0-9]{6}$/.test(draft.fill) ? draft.fill : 'FFFFFF'}`} onChange={event => update('fill', event.target.value.slice(1))} /></label>
        <label>轮廓<input type="color" value={`#${/^[a-fA-F0-9]{6}$/.test(draft.stroke) ? draft.stroke : '000000'}`} onChange={event => update('stroke', event.target.value.slice(1))} /></label>
        <button type="button" onClick={() => update('fill', 'none')}>无填充</button><button type="button" onClick={() => update('stroke', 'none')}>无线条</button>
      </div></section>}
      {can('imageCrop') && <section><h4>图片裁切（%）</h4><div className="pptx-object-panel__grid">
        {numeric('left', '左侧')}{numeric('top', '上侧')}{numeric('right', '右侧')}{numeric('bottom', '下侧')}
      </div></section>}
      {can('tableCell') && <section><h4>表格内容</h4><div className="pptx-object-panel__table"><table><tbody>{draft.cells.map((row, rowIndex) => <tr key={rowIndex}>{row.map((text, column) => <td key={column}><textarea aria-label={`第 ${rowIndex + 1} 行第 ${column + 1} 列`} value={text} onChange={event => update('cells', draft.cells.map((values, index) => index === rowIndex ? values.map((value, cell) => cell === column ? event.target.value : value) : values))} /></td>)}</tr>)}</tbody></table></div></section>}
      <div className="pptx-object-panel__apply"><button type="button" disabled={!dirty || stale} onClick={() => void apply()}>应用修改</button><button type="button" disabled={!dirty && !stale} onClick={discard}>取消当前输入</button></div>
      {can('replaceImage') && <section><button type="button" disabled={dirty || stale} onClick={() => imageInput.current?.click()}>替换图片</button><input hidden ref={imageInput} type="file" accept="image/png,image/jpeg,image/gif" onChange={event => { void replaceImage(event.target.files?.[0]); event.target.value = '' }} /></section>}
      {can('layer') && <section><h4>对象层级</h4><div className="pptx-object-panel__layers">{([['front', '置于顶层'], ['forward', '上移一层'], ['backward', '下移一层'], ['back', '置于底层']] as const).map(([position, label]) => <button key={position} type="button" disabled={dirty || stale} onClick={() => void commit([{ ...target(), type: 'layer', position }])}>{label}</button>)}</div></section>}
    </fieldset>
    {dirty && <p role="status">当前输入尚未应用。</p>}
  </aside>
}
