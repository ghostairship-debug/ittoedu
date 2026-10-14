import { useEffect, useRef, useState } from 'react'
import type { NativeInputContent } from '../../../shared/contracts/native-v1/types'
import type { InteractionActionPayload } from '../../../shared/interactionTypes'
import type { InputRuleConfig, inspectInputRuleFamily } from '../../../core/tools/inputRuleFamily'
import type { PropertiesItemBase, PropertiesPatch } from './SlideNativePropertiesPanel'
import { BufferedInput, RangeField } from './PropertyControls'
import { NativeColorInput as ColorInput } from './NativeColorPreview'
import { normalizeShortAnswer } from '../../../shared/assessmentEvaluators'

export type SlideInputPropertiesView = PropertiesItemBase & NativeInputContent & { type: 'input' }
export interface SlideInputPropertiesCommands {
  inspection: ReturnType<typeof inspectInputRuleFamily>
  feedbackTargets: readonly { id: string; name: string }[]
  configure(request: { mode: 'apply' | 'rebuild'; config: InputRuleConfig } | { mode: 'unmanage' }): Promise<string | null> | string | null
}

export function SlideInputProperties({ node, commands, patch }: {
  node: SlideInputPropertiesView; commands: SlideInputPropertiesCommands; patch(patch: PropertiesPatch): void
}) {
  const initial = commands.inspection.config
  const feedbackId = (actions?: InteractionActionPayload[]) => actions?.find(action => action.type === 'node.enter')?.nodeId ?? ''
  const incoming = { answerType: node.answerType, answers: initial?.answerType === 'text' ? initial.answers.join('\n') : '答案',
    min: initial?.answerType === 'number' ? String(initial.min) : '1', max: initial?.answerType === 'number' ? String(initial.max) : '1',
    correctId: feedbackId(initial?.correct), errorId: feedbackId(initial?.error) }
  type Fields = typeof incoming
  const [draft, setDraft] = useState(incoming)
  const baseline = useRef(incoming), dirty = useRef(new Set<keyof Fields>())
  const versions = useRef<Partial<Record<keyof Fields, number>>>({})
  const baselineConfig = useRef(initial)
  useEffect(() => {
    setDraft(previous => {
      const next = { ...previous }
      for (const key of Object.keys(incoming) as (keyof Fields)[]) if (!dirty.current.has(key)) {
        Object.assign(next, { [key]: incoming[key] }); Object.assign(baseline.current, { [key]: incoming[key] })
      }
      return next
    })
    if (!dirty.current.size) baselineConfig.current = initial
  }, [JSON.stringify(incoming), initial])
  const change = <K extends keyof Fields,>(key: K, value: Fields[K]) => {
    dirty.current.add(key); versions.current[key] = (versions.current[key] ?? 0) + 1; setDraft(previous => ({ ...previous, [key]: value }))
  }
  const { answerType, answers, min, max, correctId, errorId } = draft
  const setAnswerType = (value: Fields['answerType']) => change('answerType', value)
  const setAnswers = (value: string) => change('answers', value)
  const setMin = (value: string) => change('min', value), setMax = (value: string) => change('max', value)
  const setCorrectId = (value: string) => change('correctId', value), setErrorId = (value: string) => change('errorId', value)
  const [error, setError] = useState<string | null>(null)
  const motion = (id: string, show: boolean): InteractionActionPayload => ({
    type: show ? 'node.enter' : 'node.exit', nodeId: id, effect: 'none', durationMs: 0, easing: 'linear',
  })
  const apply = async (mode: 'apply' | 'rebuild') => {
    if ([...dirty.current].some(key => baseline.current[key] !== incoming[key])
      || dirty.current.has('correctId') && JSON.stringify(baselineConfig.current?.correct) !== JSON.stringify(initial?.correct)
      || dirty.current.has('errorId') && JSON.stringify(baselineConfig.current?.error) !== JSON.stringify(initial?.error)) {
      setError('判题配置已在其他入口改变；输入已保留，请核对当前配置后重新编辑。'); return
    }
    if (answerType === 'number' && (!min.trim() || !max.trim())) { setError('请填写数值范围'); return }
    const feedback = {
      correct: initial && (!correctId || correctId === feedbackId(initial.correct)) ? initial.correct
        : [...(errorId ? [motion(errorId, false)] : []), ...(correctId ? [motion(correctId, true)] : [])],
      error: initial && (!errorId || errorId === feedbackId(initial.error)) ? initial.error
        : [...(correctId ? [motion(correctId, false)] : []), ...(errorId ? [motion(errorId, true)] : [])],
    }
    if (correctId && correctId === errorId) { setError('正确和错误反馈应选择不同元素'); return }
    const config: InputRuleConfig = answerType === 'text'
      ? { answerType, answers: answers.split('\n'), ...feedback }
      : { answerType, min: Number(min), max: Number(max), ...feedback }
    const submitted = [...dirty.current], submittedVersions = { ...versions.current }
    const accepted = { ...draft, ...(config.answerType === 'text' ? { answers: config.answers.map(normalizeShortAnswer).join('\n') }
      : { min: String(config.min), max: String(config.max) }) }
    try {
      const reason = await commands.configure({ mode, config }); setError(reason)
      if (!reason) {
        for (const key of submitted) {
          Object.assign(baseline.current, { [key]: accepted[key] })
          if (versions.current[key] === submittedVersions[key]) dirty.current.delete(key)
        }
        baselineConfig.current = config
        setDraft(previous => { const next = { ...previous }
          for (const key of submitted) if (!dirty.current.has(key)) Object.assign(next, { [key]: accepted[key] })
          return next })
      }
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
  }
  return <section className="property-section">
    <h3>填空题</h3>
    <BufferedInput label="输入提示" value={node.placeholder ?? ''} onCommit={value => patch({ placeholder: String(value) })} />
    {commands.inspection.conflict && <p role="status">判题规则已手改或已解除管理。可保留手改，或明确重建简洁判题规则；列表外规则会保留。</p>}
    <label className="property-row">答案类型<select aria-label="答案类型" value={answerType} onChange={event => setAnswerType(event.target.value as 'text' | 'number')}>
      <option value="text">文本</option><option value="number">数值范围</option>
    </select></label>
    {answerType === 'text' ? <label className="property-row">正确答案（每行一个，最多 15 个）
      <textarea className="form-input" aria-label="正确答案" value={answers} onChange={event => setAnswers(event.target.value)} />
    </label> : <div className="coordinate-grid">
      <label>答案下界<input aria-label="答案下界" className="form-input" value={min} onChange={event => setMin(event.target.value)} /></label>
      <label>答案上界<input aria-label="答案上界" className="form-input" value={max} onChange={event => setMax(event.target.value)} /></label>
    </div>}
    {([{ label: '正确反馈', value: correctId, set: setCorrectId }, { label: '错误反馈', value: errorId, set: setErrorId }]).map(field =>
      <label className="property-row" key={field.label}>{field.label}<select aria-label={field.label} value={field.value} onChange={event => field.set(event.target.value)}>
        <option value="">保留现有反馈动作</option>
        {commands.feedbackTargets.map(target => <option key={target.id} value={target.id}>{target.name}</option>)}
      </select></label>)}
    {error && <><p role="alert">{error}</p><button type="button" className="secondary-button" onClick={() => {
      dirty.current.clear(); baseline.current = { ...incoming }; baselineConfig.current = initial; setDraft(incoming); setError(null)
    }}>重新载入当前配置</button></>}
    {commands.inspection.conflict ? <div className="property-actions">
      <button type="button" className="secondary-button" onClick={async () => { try { setError(await commands.configure({ mode: 'unmanage' })) } catch (error) { setError(error instanceof Error ? error.message : String(error)) } }}>保留手改</button>
      <button type="button" className="secondary-button" onClick={() => apply('rebuild')}>按当前配置重建</button>
    </div> : <button type="button" className="primary-button" onClick={() => apply('apply')}>应用判题配置</button>}
    <p className="property-hint">文本忽略大小写、全半角和多余空白；数值上下界相同时为精确答案。正确/错误反馈文字可直接编辑画布上的对应文本。</p>
    <RangeField label="输入字号" value={node.style.fontSize} min={6} max={144} step={1} onChange={fontSize => patch({ style: { fontSize } })} />
    {(['textColor', 'fillColor', 'borderColor'] as const).map((key, index) => <ColorInput key={key}
      previewPatch={value => ({ style: { [key]: value } })}
      id={`input-${node.id}-${key}`} label={['输入文字颜色', '输入背景颜色', '输入边框颜色'][index]!} value={node.style[key]} onChange={value => patch({ style: { [key]: value } })}
    />)}
  </section>
}
