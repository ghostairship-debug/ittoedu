import { useContext, useEffect, useRef, useState } from 'react'
import { COMMON_COLOR_PRESETS, ProjectColorPaletteContext, type ColorPreset } from '../../ui/ColorInput'
import { readRecentColors, rememberRecentColor } from './recentColors'
import './colorSwatch.css'

export type ColorSwatchVariant = 'color' | 'highlight'

/** Light tones that keep black text readable; used by every highlight entry. */
export const HIGHLIGHT_PRESETS: readonly ColorPreset[] = [
  { name: '浅黄', value: '#fff3a3' },
  { name: '浅绿', value: '#d9f99d' },
  { name: '浅蓝', value: '#bfdbfe' },
  { name: '浅粉', value: '#fbcfe8' },
  { name: '浅橙', value: '#fed7aa' },
  { name: '浅紫', value: '#e9d5ff' },
]

const normalized = (value: string | null | undefined) => typeof value === 'string' ? value.toLowerCase() : null

export interface ColorSwatchPanelProps {
  label: string
  value?: string | null
  variant?: ColorSwatchVariant
  /** `null` only comes from the highlight variant's "无高亮". */
  onPick(color: string | null): void
}

/**
 * The one colour chooser shared by the object quick bar, the text editing toolbar and the document toolbar:
 * common colours, project colours and recent colours first; a continuous picker only behind "更多颜色".
 */
export function ColorSwatchPanel({ label, value, variant = 'color', onPick }: ColorSwatchPanelProps) {
  const projectColors = useContext(ProjectColorPaletteContext)
  const [recent, setRecent] = useState(() => readRecentColors(variant))
  const [custom, setCustom] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  const current = normalized(value)
  const pick = (color: string | null) => {
    if (color) setRecent(rememberRecentColor(variant, color))
    onPick(color)
  }
  const pickRef = useRef(pick); pickRef.current = pick
  // Commit when the system picker closes: its input events fire continuously while dragging.
  useEffect(() => {
    const input = picker.current
    if (!custom || !input) return
    const commit = () => pickRef.current(input.value)
    input.addEventListener('change', commit)
    return () => input.removeEventListener('change', commit)
  }, [custom])
  const swatch = (preset: ColorPreset, key: string) => <button key={key} type="button" className="color-swatch" role="radio"
    aria-checked={current === normalized(preset.value)} aria-label={preset.name} title={`${preset.name} ${preset.value}`}
    style={{ background: preset.value }} onMouseDown={event => event.preventDefault()} onClick={() => pick(preset.value)} />
  const base = variant === 'highlight' ? HIGHLIGHT_PRESETS : COMMON_COLOR_PRESETS
  const shownRecent = recent.filter(color => !base.some(preset => normalized(preset.value) === color))
  return <div className="color-swatch-panel" role="group" aria-label={label}>
    {variant === 'highlight' && <button type="button" className="color-swatch-panel__none" aria-pressed={current === null}
      onMouseDown={event => event.preventDefault()} onClick={() => pick(null)}>无高亮</button>}
    <div className="color-swatch-panel__grid" role="radiogroup" aria-label={variant === 'highlight' ? '高亮色' : '常用色'}>
      {base.map((preset, index) => swatch(preset, `base-${index}`))}
    </div>
    {projectColors.length > 0 && <>
      <span className="color-swatch-panel__caption">项目色</span>
      <div className="color-swatch-panel__grid" role="radiogroup" aria-label="项目色">{projectColors.map((preset, index) => swatch(preset, `project-${index}`))}</div>
    </>}
    {shownRecent.length > 0 && <>
      <span className="color-swatch-panel__caption">最近使用</span>
      <div className="color-swatch-panel__grid" role="radiogroup" aria-label="最近使用">{shownRecent.map(color => swatch({ name: color, value: color }, `recent-${color}`))}</div>
    </>}
    {custom
      ? <label className="color-swatch-panel__custom">自定义<input ref={picker} type="color" aria-label="自定义颜色" defaultValue={current ?? (variant === 'highlight' ? '#fff3a3' : '#1f2937')} /></label>
      : <button type="button" className="color-swatch-panel__more" onMouseDown={event => event.preventDefault()} onClick={() => setCustom(true)}>更多颜色…</button>}
  </div>
}
