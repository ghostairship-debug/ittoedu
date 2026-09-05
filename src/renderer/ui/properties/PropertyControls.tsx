import { Check, ChevronDown } from 'lucide-react'
import {
  createContext,
  Fragment,
  type ReactNode,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { BUNDLED_FONT_FAMILIES } from '../../../shared/fonts/bundledFontFamilies'

interface PropertyDraftBindingValue {
  readonly key: string
  readonly onStale: () => void
}

const PropertyDraftBindingContext = createContext<PropertyDraftBindingValue | null>(null)

export function usePropertyDraftBindingKey(): string {
  return useContext(PropertyDraftBindingContext)?.key ?? 'unbound'
}

/**
 * Binds buffered property drafts to the exact canonical authoring target that
 * produced them. Dirty inputs stay visible after navigation/revision changes,
 * but they cannot be retargeted to the newly rendered object.
 */
export function PropertyDraftBoundary({
  bindingKey,
  onStale,
  children,
}: {
  bindingKey: string
  onStale: () => void
  children: ReactNode
}) {
  return (
    <PropertyDraftBindingContext.Provider value={{ key: bindingKey, onStale }}>
      {children}
    </PropertyDraftBindingContext.Provider>
  )
}

interface BufferedInputProps {
  label: string
  value: string | number
  type?: 'text' | 'number'
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  title?: string
  placeholder?: string
  allowEmpty?: boolean
  onCommit(value: string): void
}

export function BufferedInput({
  label,
  value,
  type = 'text',
  min,
  max,
  step,
  disabled,
  title,
  placeholder,
  allowEmpty = false,
  onCommit,
}: BufferedInputProps) {
  const draftBinding = useContext(PropertyDraftBindingContext)
  const currentBindingKey = draftBinding?.key ?? 'unbound-property-draft'
  const currentValue = String(value)
  const [draft, setDraft] = useState(currentValue)
  const [, setSessionEpoch] = useState(0)
  type Phase = 'idle' | 'editing' | 'composing' | 'blur-pending'
  const currentRef = useRef({
    bindingKey: currentBindingKey,
    value: currentValue,
    onCommit,
    onStale: draftBinding?.onStale,
  })
  currentRef.current = {
    bindingKey: currentBindingKey,
    value: currentValue,
    onCommit,
    onStale: draftBinding?.onStale,
  }
  const sessionRef = useRef<{
    phase: Phase
    bindingKey: string
    baseline: string
    draft: string
    staleNotified: boolean
    onCommit: (value: string) => void
  }>({
    phase: 'idle',
    bindingKey: currentBindingKey,
    baseline: currentValue,
    draft: currentValue,
    staleNotified: false,
    onCommit,
  })
  const stale = sessionRef.current.phase !== 'idle'
    && sessionRef.current.bindingKey !== currentBindingKey

  useLayoutEffect(() => {
    const session = sessionRef.current
    const current = currentRef.current
    if (session.phase !== 'idle') {
      if (session.bindingKey === current.bindingKey) session.onCommit = current.onCommit
      return
    }
    session.bindingKey = current.bindingKey
    session.baseline = current.value
    session.draft = current.value
    session.staleNotified = false
    session.onCommit = current.onCommit
    if (draft !== current.value) setDraft(current.value)
  }, [currentBindingKey, currentValue, draft, onCommit])

  const sessionIsStale = () => sessionRef.current.phase !== 'idle'
    && sessionRef.current.bindingKey !== currentRef.current.bindingKey
  const rejectStale = () => {
    const session = sessionRef.current
    if (!sessionIsStale()) return false
    if (!session.staleNotified) {
      session.staleNotified = true
      currentRef.current.onStale?.()
    }
    return true
  }
  const rebaseCurrent = () => {
    const session = sessionRef.current
    const current = currentRef.current
    session.phase = 'idle'
    session.bindingKey = current.bindingKey
    session.baseline = current.value
    session.draft = current.value
    session.staleNotified = false
    session.onCommit = current.onCommit
    setDraft(current.value)
    setSessionEpoch((epoch) => epoch + 1)
  }
  const beginSession = () => {
    const session = sessionRef.current
    if (session.phase !== 'idle') return
    const current = currentRef.current
    session.phase = 'editing'
    session.bindingKey = current.bindingKey
    session.baseline = current.value
    session.draft = current.value
    session.staleNotified = false
    session.onCommit = current.onCommit
    setDraft(current.value)
  }
  const commit = (candidate = sessionRef.current.draft) => {
    if (rejectStale()) {
      rebaseCurrent()
      return
    }
    const session = sessionRef.current
    let next = candidate
    if (type === 'number') {
      const parsed = Number(candidate)
      if (!Number.isFinite(parsed)) {
        rebaseCurrent()
        return
      }
      const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, parsed))
      next = String(clamped)
    } else if (allowEmpty || candidate.trim()) {
      next = candidate.trim()
    } else {
      rebaseCurrent()
      return
    }
    const callback = session.onCommit
    const changed = next !== session.baseline
    session.phase = 'idle'
    session.baseline = next
    session.draft = next
    session.staleNotified = false
    setDraft(next)
    if (changed) callback(next)
  }
  return (
    <div className="form-field">
      <label>{label}</label>
      <input
        className="form-input"
        aria-label={label}
        type={type}
        value={draft}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-invalid={stale || undefined}
        title={stale ? '属性草稿对应的编辑目标已经改变，请按 Esc 放弃草稿后重试。' : title}
        placeholder={placeholder}
        onFocus={beginSession}
        onChange={(event) => {
          if (rejectStale()) return
          if (sessionRef.current.phase === 'idle') beginSession()
          const nextDraft = event.target.value
          const session = sessionRef.current
          session.draft = nextDraft
          setDraft(nextDraft)
        }}
        onCompositionStart={() => {
          if (rejectStale()) return
          if (sessionRef.current.phase === 'idle') beginSession()
          sessionRef.current.phase = 'composing'
        }}
        onCompositionEnd={(event) => {
          if (rejectStale()) {
            rebaseCurrent()
            return
          }
          const session = sessionRef.current
          const next = event.currentTarget.value
          const shouldCommit = session.phase === 'blur-pending'
          session.phase = 'editing'
          session.draft = next
          setDraft(next)
          if (shouldCommit) commit(next)
        }}
        onBlur={() => {
          const session = sessionRef.current
          if (session.phase === 'idle') return
          if (session.phase === 'composing') {
            session.phase = 'blur-pending'
            return
          }
          commit()
        }}
        onKeyDown={(event) => {
          const session = sessionRef.current
          if (
            session.phase === 'composing'
            || session.phase === 'blur-pending'
            || event.nativeEvent.isComposing
          ) return
          if (event.key === 'Enter') {
            commit()
            event.currentTarget.blur()
          }
          if (event.key === 'Escape') {
            if (rejectStale()) rebaseCurrent()
            else {
              session.phase = 'idle'
              session.draft = session.baseline
              session.staleNotified = false
              setDraft(session.baseline)
            }
            event.currentTarget.blur()
          }
        }}
      />
    </div>
  )
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  disabled = false,
  onChange,
}: {
  label: string
  value: T
  options: Array<{ value: T; label: string }>
  disabled?: boolean
  onChange(value: T): void
}) {
  return (
    <div className="form-field">
      <label>{label}</label>
      <select
        className="form-input"
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {options.map((option) => (
          <option value={option.value} key={option.value}>{option.label}</option>
        ))}
      </select>
    </div>
  )
}

export function RangeField({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = '',
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  suffix?: string
  onChange(value: number): void
}) {
  const draftBinding = useContext(PropertyDraftBindingContext)
  const currentBindingKey = draftBinding?.key ?? 'unbound-property-draft'
  const [draft, setDraft] = useState(value)
  const [, setSessionEpoch] = useState(0)
  const currentRef = useRef({
    bindingKey: currentBindingKey,
    value,
    onChange,
    onStale: draftBinding?.onStale,
  })
  currentRef.current = {
    bindingKey: currentBindingKey,
    value,
    onChange,
    onStale: draftBinding?.onStale,
  }
  const sessionRef = useRef({
    active: false,
    bindingKey: currentBindingKey,
    baseline: value,
    draft: value,
    staleNotified: false,
    onChange,
  })
  const stale = sessionRef.current.active
    && sessionRef.current.bindingKey !== currentBindingKey

  useLayoutEffect(() => {
    const session = sessionRef.current
    const current = currentRef.current
    if (session.active) {
      if (session.bindingKey === current.bindingKey) session.onChange = current.onChange
      return
    }
    session.bindingKey = current.bindingKey
    session.baseline = current.value
    session.draft = current.value
    session.staleNotified = false
    session.onChange = current.onChange
    if (draft !== current.value) setDraft(current.value)
  }, [currentBindingKey, draft, onChange, value])

  const sessionIsStale = () => sessionRef.current.active
    && sessionRef.current.bindingKey !== currentRef.current.bindingKey
  const rejectStale = () => {
    const session = sessionRef.current
    if (!sessionIsStale()) return false
    if (!session.staleNotified) {
      session.staleNotified = true
      currentRef.current.onStale?.()
    }
    return true
  }
  const rebaseCurrent = () => {
    const session = sessionRef.current
    const current = currentRef.current
    session.active = false
    session.bindingKey = current.bindingKey
    session.baseline = current.value
    session.draft = current.value
    session.staleNotified = false
    session.onChange = current.onChange
    setDraft(current.value)
    setSessionEpoch((epoch) => epoch + 1)
  }
  const beginSession = () => {
    const session = sessionRef.current
    if (session.active) return
    const current = currentRef.current
    session.active = true
    session.bindingKey = current.bindingKey
    session.baseline = current.value
    session.draft = current.value
    session.staleNotified = false
    session.onChange = current.onChange
    setDraft(current.value)
  }
  const updateDraft = (next: number) => {
    if (rejectStale()) return
    if (!sessionRef.current.active) beginSession()
    sessionRef.current.draft = next
    setDraft(next)
  }
  const commit = (next: number) => {
    const session = sessionRef.current
    if (!session.active) return
    if (rejectStale()) {
      rebaseCurrent()
      return
    }
    const clamped = Math.min(max, Math.max(min, next))
    const callback = session.onChange
    const changed = clamped !== session.baseline
    session.active = false
    session.baseline = clamped
    session.draft = clamped
    session.staleNotified = false
    setDraft(clamped)
    if (changed) callback(clamped)
  }
  return (
    <div className="form-field range-field">
      <label><span>{label}</span><span>{Number(draft.toFixed(2))}{suffix}</span></label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={draft}
        aria-label={label}
        aria-invalid={stale || undefined}
        title={stale ? '属性草稿对应的编辑目标已经改变，请结束当前操作后重试。' : undefined}
        onFocus={beginSession}
        onPointerDown={beginSession}
        onKeyDown={beginSession}
        onChange={(event) => updateDraft(Number(event.target.value))}
        onPointerUp={(event) => commit(Number(event.currentTarget.value))}
        onPointerCancel={(event) => commit(Number(event.currentTarget.value))}
        onKeyUp={(event) => commit(Number(event.currentTarget.value))}
        onBlur={(event) => commit(Number(event.currentTarget.value))}
      />
    </div>
  )
}

export function ToggleRow({ label, checked, disabled = false, onChange }: {
  label: string
  checked: boolean
  disabled?: boolean
  onChange(checked: boolean): void
}) {
  return (
    <div className="toggle-row">
      <span>{label}</span>
      <label className="toggle">
        <input
          type="checkbox"
          aria-label={label}
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="toggle-track" />
      </label>
    </div>
  )
}

export function TextContentTextarea({
  label,
  value,
  onBegin,
  onChange,
  onCommit,
  onCancel,
  onCompositionChange,
}: {
  label: string
  value: string
  onBegin(): boolean | void
  onChange(value: string): void
  onCommit(): void
  onCancel(): void
  onCompositionChange?(composing: boolean): void
}) {
  const draftBinding = useContext(PropertyDraftBindingContext)
  const currentBindingKey = draftBinding?.key ?? 'unbound-property-draft'
  const [draft, setDraft] = useState(value)
  const [, setSessionEpoch] = useState(0)
  type Phase = 'idle' | 'editing' | 'composing' | 'blur-pending'
  const currentRef = useRef({
    bindingKey: currentBindingKey,
    value,
    onBegin,
    onChange,
    onCommit,
    onCancel,
    onCompositionChange,
    onStale: draftBinding?.onStale,
  })
  currentRef.current = {
    bindingKey: currentBindingKey,
    value,
    onBegin,
    onChange,
    onCommit,
    onCancel,
    onCompositionChange,
    onStale: draftBinding?.onStale,
  }
  const sessionRef = useRef<{
    phase: Phase
    bindingKey: string
    baseline: string
    draft: string
    staleNotified: boolean
    onBegin: () => boolean | void
    onChange: (value: string) => void
    onCommit: () => void
    onCancel: () => void
    onCompositionChange?: (composing: boolean) => void
  }>({
    phase: 'idle',
    bindingKey: currentBindingKey,
    baseline: value,
    draft: value,
    staleNotified: false,
    onBegin,
    onChange,
    onCommit,
    onCancel,
    onCompositionChange,
  })
  const stale = sessionRef.current.phase !== 'idle'
    && sessionRef.current.bindingKey !== currentBindingKey

  const copyCurrentHandlers = () => {
    const session = sessionRef.current
    const current = currentRef.current
    session.onBegin = current.onBegin
    session.onChange = current.onChange
    session.onCommit = current.onCommit
    session.onCancel = current.onCancel
    session.onCompositionChange = current.onCompositionChange
  }

  useLayoutEffect(() => {
    const session = sessionRef.current
    const current = currentRef.current
    if (session.phase !== 'idle') {
      if (session.bindingKey === current.bindingKey) copyCurrentHandlers()
      return
    }
    session.bindingKey = current.bindingKey
    session.baseline = current.value
    session.draft = current.value
    session.staleNotified = false
    copyCurrentHandlers()
    if (draft !== current.value) setDraft(current.value)
  }, [currentBindingKey, onBegin, onCancel, onChange, onCommit, onCompositionChange, value])

  const sessionIsStale = () => {
    const session = sessionRef.current
    return session.phase !== 'idle'
      && session.bindingKey !== currentRef.current.bindingKey
  }

  const rejectStale = (): boolean => {
    const session = sessionRef.current
    if (!sessionIsStale()) return false
    if (!session.staleNotified) {
      session.staleNotified = true
      currentRef.current.onStale?.()
    }
    return true
  }

  const rebaseCurrent = () => {
    const session = sessionRef.current
    const current = currentRef.current
    session.phase = 'idle'
    session.bindingKey = current.bindingKey
    session.baseline = current.value
    session.draft = current.value
    session.staleNotified = false
    copyCurrentHandlers()
    setDraft(current.value)
    setSessionEpoch((epoch) => epoch + 1)
  }

  const beginSession = () => {
    const session = sessionRef.current
    if (session.phase !== 'idle') return
    const current = currentRef.current
    session.phase = 'editing'
    session.bindingKey = current.bindingKey
    session.baseline = current.value
    session.draft = current.value
    session.staleNotified = false
    copyCurrentHandlers()
    setDraft(current.value)
    const rebindAfterBegin = session.onBegin()
    if (rebindAfterBegin) {
      queueMicrotask(() => {
        const active = sessionRef.current
        if (active.phase !== 'editing') return
        const current = currentRef.current
        active.bindingKey = current.bindingKey
        active.baseline = current.value
        active.draft = current.value
        active.staleNotified = false
        copyCurrentHandlers()
        setDraft(current.value)
      })
    }
  }

  const finishCommit = () => {
    const session = sessionRef.current
    if (rejectStale()) {
      rebaseCurrent()
      return
    }
    const commit = session.onCommit
    session.phase = 'idle'
    session.baseline = session.draft
    session.staleNotified = false
    commit()
  }

  const finishComposition = (finalDraft: string) => {
    queueMicrotask(() => {
      const session = sessionRef.current
      if (session.phase === 'idle') return
      if (rejectStale()) {
        rebaseCurrent()
        return
      }
      const shouldCommit = session.phase === 'blur-pending'
      session.onCompositionChange?.(false)
      session.phase = 'editing'
      if (!shouldCommit) return
      // A composing owner may replace its exact edit lease while processing
      // `false`. Let the binding refresh before the terminal callback.
      queueMicrotask(() => {
        if (sessionRef.current.phase === 'idle') return
        sessionRef.current.draft = finalDraft
        finishCommit()
      })
    })
  }

  return (
    <div className="form-field">
      <label>{label}</label>
      <textarea
        className="form-textarea"
        aria-label={label}
        value={draft}
        aria-invalid={stale || undefined}
        title={stale ? '文字草稿对应的编辑目标已经改变，请按 Esc 放弃草稿后重试。' : undefined}
        onFocus={beginSession}
        onChange={(event) => {
          if (rejectStale()) return
          const next = event.target.value
          setDraft(next)
          const session = sessionRef.current
          session.draft = next
          if (session.phase !== 'composing' && session.phase !== 'blur-pending') {
            session.onChange(next)
          }
        }}
        onCompositionStart={() => {
          if (rejectStale()) return
          const session = sessionRef.current
          session.phase = 'composing'
          session.onCompositionChange?.(true)
        }}
        onCompositionEnd={(event) => {
          if (rejectStale()) {
            rebaseCurrent()
            return
          }
          const session = sessionRef.current
          const finalDraft = event.currentTarget.value
          session.draft = finalDraft
          setDraft(finalDraft)
          session.onChange(finalDraft)
          finishComposition(finalDraft)
        }}
        onBlur={() => {
          const session = sessionRef.current
          if (session.phase === 'idle') return
          if (session.phase === 'composing') {
            session.phase = 'blur-pending'
            return
          }
          finishCommit()
        }}
        onKeyDown={(event) => {
          const session = sessionRef.current
          if (
            session.phase === 'composing'
            || session.phase === 'blur-pending'
            || event.nativeEvent.isComposing
          ) return
          if (event.key === 'Escape') {
            event.preventDefault()
            if (rejectStale()) {
              rebaseCurrent()
            } else {
              const baseline = session.baseline
              const cancel = session.onCancel
              session.phase = 'idle'
              session.draft = baseline
              session.staleNotified = false
              setDraft(baseline)
              cancel()
            }
            event.currentTarget.blur()
          }
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault()
            finishCommit()
            event.currentTarget.blur()
          }
        }}
      />
    </div>
  )
}

/**
 * Two kinds of font, two different bills. `bundled` families ship inside the
 * app, so an export can embed them and the layout survives a machine change at
 * the cost of file size; `system` families are whatever the machine happens to
 * have, which keeps exports small and makes the layout machine-dependent.
 */
export type FontFamilySource = 'bundled' | 'system'

const BUNDLED_FONT_FAMILY_SET = new Set(BUNDLED_FONT_FAMILIES)

/**
 * Classify a family. Membership comes from the bundled font module — the single
 * truth about what we ship — so the picker can never promise an embed for a
 * family the export does not have bytes for.
 */
export function fontFamilySource(fontFamily: string): FontFamilySource {
  return BUNDLED_FONT_FAMILY_SET.has(fontFamily.trim()) ? 'bundled' : 'system'
}

/**
 * What each class costs, in the same terse voice as the availability tags. The
 * picker offers the choice, so it owes the teacher the trade-off that comes
 * with it.
 */
export const FONT_FAMILY_SOURCE_TAGS: Record<
  FontFamilySource,
  { readonly badge: string; readonly cost: string }
> = {
  bundled: {
    badge: '内置',
    cost: '内置字体：导出时嵌入，换机器排版不变，文件更大',
  },
  system: {
    badge: '系统',
    cost: '系统字体：导出不嵌入，文件小，没装该字体的机器上排版可能变样',
  },
}

const FONT_FAMILY_CATALOG = [
  { label: '微软雅黑', family: 'Microsoft YaHei' },
  { label: '微软雅黑 UI', family: 'Microsoft YaHei UI' },
  { label: '微软正黑体', family: 'Microsoft JhengHei' },
  { label: '等线', family: 'DengXian' },
  { label: '宋体', family: 'SimSun' },
  { label: '黑体', family: 'SimHei' },
  { label: '楷体', family: 'KaiTi' },
  { label: '仿宋', family: 'FangSong' },
  { label: '华文黑体', family: 'STHeiti' },
  { label: '华文宋体', family: 'STSong' },
  { label: '华文楷体', family: 'STKaiti' },
  { label: '华文仿宋', family: 'STFangsong' },
  { label: '苹方', family: 'PingFang SC' },
  { label: '冬青黑体', family: 'Hiragino Sans GB' },
  { label: '思源黑体', family: 'Source Han Sans SC' },
  { label: '思源宋体', family: 'Source Han Serif SC' },
  { label: 'Noto 无衬线中文', family: 'Noto Sans SC' },
  { label: 'Noto 衬线中文', family: 'Noto Serif SC' },
  { label: 'Noto CJK 黑体', family: 'Noto Sans CJK SC' },
  { label: 'Noto CJK 宋体', family: 'Noto Serif CJK SC' },
  { label: 'Inter', family: 'Inter' },
  { label: 'Arial', family: 'Arial' },
  { label: 'Helvetica', family: 'Helvetica' },
  { label: 'Verdana', family: 'Verdana' },
  { label: 'Tahoma', family: 'Tahoma' },
  { label: 'Trebuchet MS', family: 'Trebuchet MS' },
  { label: 'Georgia', family: 'Georgia' },
  { label: 'Times New Roman', family: 'Times New Roman' },
  { label: 'Courier New', family: 'Courier New' },
  { label: '无衬线通用字体', family: 'sans-serif' },
  { label: '衬线通用字体', family: 'serif' },
  { label: '等宽通用字体', family: 'monospace' },
] as const

/**
 * Stable partition: bundled first, each class keeping its authored order. Two
 * contiguous runs let the list state a class's cost once instead of repeating
 * it on every row.
 */
function orderFontOptionsBySource<Option extends { readonly family: string }>(
  options: readonly Option[],
): Option[] {
  return [
    ...options.filter((option) => fontFamilySource(option.family) === 'bundled'),
    ...options.filter((option) => fontFamilySource(option.family) !== 'bundled'),
  ]
}

/**
 * The bundled families lead the list: they are the only entries whose layout is
 * guaranteed on another machine. This changes no default, only what the teacher
 * sees first.
 */
export const FONT_FAMILY_OPTIONS: readonly {
  readonly label: string
  readonly family: string
}[] = orderFontOptionsBySource(FONT_FAMILY_CATALOG)

export const COMMON_FONT_FAMILIES = FONT_FAMILY_OPTIONS.map(
  (option) => option.family,
)

type FontAvailability = 'available' | 'unavailable' | 'unknown'

export function detectFontAvailability(fontFamily: string): FontAvailability {
  if (['sans-serif', 'serif', 'monospace'].includes(fontFamily)) {
    return 'available'
  }
  if (typeof document === 'undefined' || !document.fonts?.check) {
    return 'unknown'
  }
  const escapedFamily = fontFamily.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
  try {
    return document.fonts.check(
      `16px "${escapedFamily}"`,
      '中文字体预览 Aa 123',
    )
      ? 'available'
      : 'unavailable'
  } catch {
    return 'unknown'
  }
}

export function FontFamilyPicker({ value, placeholder, onCommit }: {
  value: string
  placeholder?: string
  onCommit(value: string): void
}) {
  const draftBinding = useContext(PropertyDraftBindingContext)
  const currentBindingKey = draftBinding?.key ?? 'unbound-property-draft'
  const [draft, setDraft] = useState(value)
  const [open, setOpen] = useState(false)
  const [queryDirty, setQueryDirty] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  type Phase = 'idle' | 'editing' | 'composing' | 'blur-pending'
  const inputRef = useRef<HTMLInputElement>(null)
  const currentRef = useRef({
    bindingKey: currentBindingKey,
    value,
    onCommit,
    onStale: draftBinding?.onStale,
  })
  currentRef.current = {
    bindingKey: currentBindingKey,
    value,
    onCommit,
    onStale: draftBinding?.onStale,
  }
  const sessionRef = useRef<{
    phase: Phase
    bindingKey: string
    baseline: string
    draft: string
    staleNotified: boolean
    onCommit: (value: string) => void
  }>({
    phase: 'idle',
    bindingKey: currentBindingKey,
    baseline: value,
    draft: value,
    staleNotified: false,
    onCommit,
  })
  const stale = sessionRef.current.phase !== 'idle'
    && sessionRef.current.bindingKey !== currentBindingKey

  useLayoutEffect(() => {
    const session = sessionRef.current
    const current = currentRef.current
    if (session.phase !== 'idle') {
      if (session.bindingKey === current.bindingKey) {
        session.onCommit = current.onCommit
      }
      return
    }
    session.bindingKey = current.bindingKey
    session.baseline = current.value
    session.draft = current.value
    session.staleNotified = false
    session.onCommit = current.onCommit
    if (draft !== current.value) setDraft(current.value)
  }, [currentBindingKey, onCommit, value])

  const sessionIsStale = () => {
    const session = sessionRef.current
    const current = currentRef.current
    return session.phase !== 'idle'
      && session.bindingKey !== current.bindingKey
  }

  const rejectStale = (): boolean => {
    const session = sessionRef.current
    if (!sessionIsStale()) return false
    if (!session.staleNotified) {
      session.staleNotified = true
      currentRef.current.onStale?.()
    }
    return true
  }

  const beginSession = () => {
    const session = sessionRef.current
    if (session.phase !== 'idle') return
    const current = currentRef.current
    session.phase = 'editing'
    session.bindingKey = current.bindingKey
    session.baseline = current.value
    session.draft = current.value
    session.staleNotified = false
    session.onCommit = current.onCommit
    setDraft(current.value)
  }

  const rebaseCurrent = (phase: Phase = 'idle') => {
    const session = sessionRef.current
    const current = currentRef.current
    session.phase = phase
    session.bindingKey = current.bindingKey
    session.baseline = current.value
    session.draft = current.value
    session.staleNotified = false
    session.onCommit = current.onCommit
    setDraft(current.value)
  }

  const currentOption = FONT_FAMILY_OPTIONS.find(
    (option) => option.family === value,
  )
  // The typed-in value is not a family we ship, so it joins the system run
  // rather than sitting above the grouped list unlabelled.
  const availableFonts = orderFontOptionsBySource(
    currentOption
      ? FONT_FAMILY_OPTIONS
      : [
          ...(value
            ? [{ label: '自定义字体', family: value } as const]
            : []),
          ...FONT_FAMILY_OPTIONS,
        ],
  )
  const normalizedQuery = draft.trim().toLocaleLowerCase()
  const visibleFonts = queryDirty && normalizedQuery
    ? availableFonts.filter((font) => (
      font.family.toLocaleLowerCase().includes(normalizedQuery) ||
      font.label.toLocaleLowerCase().includes(normalizedQuery)
    ))
    : availableFonts

  const commit = (candidate = sessionRef.current.draft, endSession = false) => {
    if (rejectStale()) {
      rebaseCurrent()
      return false
    }
    const next = candidate.trim()
    if (!next) {
      if (endSession) rebaseCurrent()
      else {
        const baseline = sessionRef.current.baseline
        sessionRef.current.draft = baseline
        setDraft(baseline)
      }
      return false
    }
    setDraft(next)
    const session = sessionRef.current
    session.draft = next
    const changed = next !== session.baseline
    if (changed) session.onCommit(next)
    session.baseline = next
    session.staleNotified = false
    if (endSession) session.phase = 'idle'
    return true
  }

  const openAllFonts = () => {
    const selectedIndex = availableFonts.findIndex(
      (font) => font.family === draft,
    )
    setQueryDirty(false)
    setActiveIndex(Math.max(0, selectedIndex))
    setOpen(true)
  }

  const selectFont = (font: string) => {
    if (rejectStale()) return
    sessionRef.current.draft = font
    setDraft(font)
    setOpen(false)
    setQueryDirty(false)
    commit(font, true)
    inputRef.current?.blur()
  }

  return (
    <div
      className="form-field font-family-field"
      onFocus={() => {
        beginSession()
      }}
      onBlur={(event) => {
        const nextTarget = event.relatedTarget
        if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
          return
        }
        setOpen(false)
        setQueryDirty(false)
        if (sessionRef.current.phase === 'idle') return
        if (sessionRef.current.phase === 'composing') {
          sessionRef.current.phase = 'blur-pending'
          return
        }
        commit(sessionRef.current.draft, true)
      }}
    >
      <label htmlFor="text-font-family">字体</label>
      <div className="font-family-combobox">
        <input
          ref={inputRef}
          id="text-font-family"
          className="form-input font-family-input"
          type="text"
          role="combobox"
          aria-label="字体"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls="courseware-font-families"
          aria-activedescendant={
            open && visibleFonts[activeIndex]
              ? `courseware-font-option-${activeIndex}`
              : undefined
          }
          value={draft}
          aria-invalid={stale || undefined}
          title={stale ? '字体草稿对应的编辑目标已经改变，请按 Esc 放弃草稿后重试。' : undefined}
          placeholder={placeholder}
          spellCheck={false}
          onFocus={() => {
            if (!open) openAllFonts()
          }}
          onClick={() => {
            if (!open) openAllFonts()
          }}
          onChange={(event) => {
            if (rejectStale()) return
            if (sessionRef.current.phase === 'idle') beginSession()
            const next = event.target.value
            sessionRef.current.draft = next
            setDraft(next)
            setQueryDirty(true)
            setActiveIndex(0)
            setOpen(true)
          }}
          onCompositionStart={() => {
            if (rejectStale()) return
            if (sessionRef.current.phase === 'idle') beginSession()
            sessionRef.current.phase = 'composing'
          }}
          onCompositionEnd={(event) => {
            if (rejectStale()) {
              rebaseCurrent()
              return
            }
            const session = sessionRef.current
            const next = event.currentTarget.value
            const shouldCommit = session.phase === 'blur-pending'
            session.phase = 'editing'
            session.draft = next
            setDraft(next)
            if (shouldCommit) commit(next, true)
          }}
          onKeyDown={(event) => {
            if (
              sessionRef.current.phase === 'composing'
              || sessionRef.current.phase === 'blur-pending'
              || event.nativeEvent.isComposing
            ) return
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              if (!open) {
                openAllFonts()
                return
              }
              const direction = event.key === 'ArrowDown' ? 1 : -1
              setActiveIndex((current) => {
                if (visibleFonts.length === 0) return 0
                return (current + direction + visibleFonts.length) % visibleFonts.length
              })
            } else if (event.key === 'Enter') {
              event.preventDefault()
              const activeFont = open ? visibleFonts[activeIndex] : undefined
              if (activeFont) selectFont(activeFont.family)
              else {
                commit(sessionRef.current.draft, true)
                setOpen(false)
                event.currentTarget.blur()
              }
            } else if (event.key === 'Escape') {
              event.preventDefault()
              if (rejectStale()) rebaseCurrent()
              else {
                const session = sessionRef.current
                session.draft = session.baseline
                session.staleNotified = false
                session.phase = 'idle'
                setDraft(session.baseline)
              }
              setOpen(false)
              setQueryDirty(false)
              event.currentTarget.blur()
            }
          }}
          style={{ fontFamily: draft || value }}
        />
        <button
          type="button"
          className="font-family-toggle"
          aria-label={open ? '收起字体列表' : '展开字体列表'}
          aria-controls="courseware-font-families"
          aria-expanded={open}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            if (open) setOpen(false)
            else openAllFonts()
            inputRef.current?.focus()
          }}
        >
          <ChevronDown size={14} aria-hidden="true" />
        </button>
        {open ? (
          <div
            id="courseware-font-families"
            className="font-family-listbox"
            role="listbox"
            aria-label="常用字体"
          >
            {visibleFonts.length > 0 ? visibleFonts.map((font, index) => {
              const availability = detectFontAvailability(font.family)
              const availabilityLabel = availability === 'available'
                ? '可用'
                : availability === 'unavailable'
                  ? '未安装'
                  : '未检测'
              const source = fontFamilySource(font.family)
              const sourceTag = FONT_FAMILY_SOURCE_TAGS[source]
              // The list is grouped by class, so the cost is stated once per
              // run of options instead of 33 times.
              const startsGroup = index === 0 ||
                fontFamilySource(visibleFonts[index - 1]!.family) !== source
              return (
              <Fragment key={font.family}>
              {startsGroup ? (
                <div
                  role="presentation"
                  data-testid={`font-family-group-${source}`}
                  style={{
                    padding: '6px 9px 3px',
                    color: 'var(--text-muted)',
                    fontSize: 9,
                    lineHeight: 1.45,
                  }}
                >
                  {sourceTag.cost}
                </div>
              ) : null}
              <button
                id={`courseware-font-option-${index}`}
                type="button"
                role="option"
                aria-selected={font.family === draft}
                aria-label={
                  `${font.label}，${font.family}，${sourceTag.badge}字体，${availabilityLabel}`
                }
                title={sourceTag.cost}
                data-font-source={source}
                className={
                  `font-family-option${index === activeIndex ? ' is-active' : ''}`
                }
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => selectFont(font.family)}
                onMouseEnter={() => setActiveIndex(index)}
                style={{ fontFamily: font.family }}
              >
                <span className="font-family-option__identity">
                  <strong>{font.label}</strong>
                  <small>{font.family}</small>
                </span>
                <span className="font-family-option__status">
                  {sourceTag.badge}
                </span>
                <span
                  className={`font-family-option__status font-family-option__status--${availability}`}
                >
                  {availabilityLabel}
                </span>
                {font.family === draft
                  ? <Check size={14} aria-hidden="true" />
                  : null}
              </button>
              </Fragment>
              )
            }) : (
              <div className="font-family-empty">
                按 Enter 使用“{draft.trim()}”
              </div>
            )}
          </div>
        ) : null}
      </div>
      <div
        className="font-family-preview"
        data-testid="font-family-preview"
        style={{ fontFamily: draft || value }}
      >
        中文字体预览 Aa 123
      </div>
      <small className="font-family-help">
        {'列表按“内置 / 系统”分组：内置字体导出时会嵌入，换机器排版不变、文件更大；' +
          '系统字体不嵌入，文件小，但没装该字体的机器上排版可能变样。' +
          '仍可输入自定义字体或回退字体串，未标“内置”的一律不嵌入。'}
      </small>
    </div>
  )
}
