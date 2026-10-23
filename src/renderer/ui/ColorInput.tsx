import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { propertyDraftSuspended, usePropertyDraftBindingKey, usePropertyDraftFlush, type PropertyCommitFailure } from './properties/PropertyControls'
import { isCourseComponentInputFailure, settleCourseComponentInput } from '../documents/CourseV10DocumentBridge'

export interface ColorPreset {
  readonly name: string
  readonly value: string
  readonly contrastColor?: string
}

/** Read-only projection of the current project's designTokens.colors. */
export const ProjectColorPaletteContext = createContext<readonly ColorPreset[]>([])

export const COMMON_COLOR_PRESETS: readonly ColorPreset[] = [
  { name: '纯白', value: '#ffffff', contrastColor: '#000000' },
  { name: '浅灰', value: '#f3f4f6', contrastColor: '#000000' },
  { name: '中灰', value: '#9ca3af', contrastColor: '#000000' },
  { name: '深灰', value: '#374151', contrastColor: '#ffffff' },
  { name: '纯黑', value: '#000000', contrastColor: '#ffffff' },
  { name: '红色', value: '#ef4444', contrastColor: '#ffffff' },
  { name: '橙色', value: '#f97316', contrastColor: '#ffffff' },
  { name: '黄色', value: '#eab308', contrastColor: '#000000' },
  { name: '绿色', value: '#22c55e', contrastColor: '#ffffff' },
  { name: '青色', value: '#06b6d4', contrastColor: '#000000' },
  { name: '蓝色', value: '#3b82f6', contrastColor: '#ffffff' },
  { name: '紫色', value: '#8b5cf6', contrastColor: '#ffffff' },
] as const

const isValidHex = (val: string): boolean => /^#[0-9a-fA-F]{6}$/.test(val)
/** Equivalent opaque input for professional fields whose stored color is six-digit hex. */
export function normalizeOpaqueColor(value: string): string | null {
  const color = value.trim().toLowerCase()
  if (isValidHex(color)) return color
  if (/^#[0-9a-f]{3}$/.test(color)) return `#${color.slice(1).split('').map(channel => channel + channel).join('')}`
  const rgb = /^rgb\(([^()]+)\)$/.exec(color)
  if (!rgb || rgb[1].includes('/')) return null
  const parts = rgb[1].includes(',') ? rgb[1].split(',').map(part => part.trim()) : rgb[1].trim().split(/\s+/)
  if (parts.length !== 3) return null
  const channels = parts.map(part => {
    const percent = part.endsWith('%'), numeric = percent ? part.slice(0, -1) : part
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(numeric)) return null
    const channel = Number(numeric), maximum = percent ? 100 : 255
    return Number.isFinite(channel) && channel <= maximum ? Math.round(channel * 255 / maximum) : null
  })
  return channels.some(channel => channel === null) ? null
    : `#${channels.map(channel => channel!.toString(16).padStart(2, '0')).join('')}`
}

export interface ColorInputProps {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void | Promise<void>
  readonly onPreviewChange?: (value: string | null) => void
  readonly 'data-testid'?: string
}

export function ColorInput({
  id,
  label,
  value,
  onChange,
  onPreviewChange,
  'data-testid': testId,
}: ColorInputProps) {
  const projectColors = useContext(ProjectColorPaletteContext)
  const parentBinding = usePropertyDraftBindingKey()
  let parts: unknown[] = [parentBinding]
  try { const parsed: unknown = JSON.parse(parentBinding); if (Array.isArray(parsed)) parts = parsed } catch { /* unbound standalone control */ }
  const bindingKey = JSON.stringify([...parts, ['color', id]])
  const normalizedValue = normalizeOpaqueColor(value || '') ?? (value || '').toLowerCase()
  const [draft, setDraft] = useState(normalizedValue)
  const [pickerDraft, setPickerDraft] = useState(normalizedValue)
  const [expanded, setExpanded] = useState(false)
  const [inputError, setInputError] = useState('')
  const isCancelledRef = useRef(false)
  const isPreviewDirtyRef = useRef(false)
  const draftRef = useRef(normalizedValue)
  const pickerRef = useRef<HTMLInputElement>(null)
  const lastCommittedRef = useRef(normalizedValue)
  const onPreviewChangeRef = useRef(onPreviewChange)
  const previousBindingRef = useRef(bindingKey)
  const rejectRetiredPickerRef = useRef(false)
  const pointerGestureRef = useRef(false)
  const ownerBinding = useRef(bindingKey)
  const commitRef = useRef(onChange)
  const latest = useRef({ bindingKey, value: normalizedValue, onChange })
  latest.current = { bindingKey, value: normalizedValue, onChange }
  const pending = useRef<Promise<boolean> | undefined>(undefined)
  const failure = useRef<PropertyCommitFailure | undefined>(undefined)
  const composing = useRef(false), resumeRequired = useRef(false)
  const [, setInputEpoch] = useState(0)
  const dirty = () => resumeRequired.current || composing.current || Boolean(pending.current) || Boolean(failure.current) || draftRef.current !== lastCommittedRef.current

  useLayoutEffect(() => {
    if (previousBindingRef.current === bindingKey) return
    previousBindingRef.current = bindingKey
    if (isPreviewDirtyRef.current) onPreviewChangeRef.current?.(null)
    isPreviewDirtyRef.current = false
    rejectRetiredPickerRef.current = true
    pointerGestureRef.current = false
    isCancelledRef.current = true
    if (dirty()) { setInputError('编辑目标已改变；颜色输入已保留，请按 Esc 放弃后重试。'); return }
    ownerBinding.current = bindingKey
    commitRef.current = onChange
    draftRef.current = normalizedValue
    lastCommittedRef.current = normalizedValue
    setDraft(normalizedValue)
    setPickerDraft(normalizedValue)
    setExpanded(false)
    setInputError('')
  }, [bindingKey, normalizedValue])

  useEffect(() => {
    onPreviewChangeRef.current = onPreviewChange
  }, [onPreviewChange])

  useEffect(() => {
    if (ownerBinding.current === bindingKey) commitRef.current = onChange
    if (dirty()) return
    isCancelledRef.current = false
    draftRef.current = normalizedValue
    setDraft(normalizedValue)
    setPickerDraft(normalizedValue)
    lastCommittedRef.current = normalizedValue
    setInputError('')
  }, [normalizedValue, bindingKey, onChange])

  useEffect(() => {
    return () => {
      if (isPreviewDirtyRef.current) {
        isPreviewDirtyRef.current = false
        onPreviewChangeRef.current?.(null)
      }
    }
  }, [])

  useEffect(() => {
    const el = pickerRef.current
    if (!el) return

    const handleNativeInput = (e: Event) => {
      if (rejectRetiredPickerRef.current) return
      isCancelledRef.current = false
      isPreviewDirtyRef.current = true
      const targetVal = (e.target as HTMLInputElement).value.toLowerCase()
      setPickerDraft(targetVal)
      draftRef.current = targetVal
      setDraft(targetVal)
      onPreviewChange?.(targetVal)
    }

    const handleNativeChange = (e: Event) => {
      if (rejectRetiredPickerRef.current) return
      isCancelledRef.current = false
      const targetVal = (e.target as HTMLInputElement).value.toLowerCase()
      setPickerDraft(targetVal)
      draftRef.current = targetVal
      setDraft(targetVal)
      commit(targetVal, true)
    }

    el.addEventListener('input', handleNativeInput)
    el.addEventListener('change', handleNativeChange)
    return () => {
      el.removeEventListener('input', handleNativeInput)
      el.removeEventListener('change', handleNativeChange)
    }
  }, [normalizedValue, onChange, onPreviewChange])

  const commit = (candidate = draftRef.current, explicit = false): boolean | Promise<boolean> => {
    if (propertyDraftSuspended(ownerBinding.current)) return false
    if (pending.current) return pending.current
    if (failure.current && !explicit) return false
    if (composing.current || resumeRequired.current) return false
    if (ownerBinding.current !== latest.current.bindingKey
      || latest.current.value !== lastCommittedRef.current && latest.current.value !== normalizeOpaqueColor(candidate) && latest.current.value !== failure.current?.value) {
      setInputError('原颜色或编辑目标已改变；输入已保留，请按 Esc 放弃后重试。'); return false
    }
    if (isCancelledRef.current) {
      isCancelledRef.current = false
      isPreviewDirtyRef.current = false
      draftRef.current = normalizedValue
      setDraft(normalizedValue)
      setPickerDraft(normalizedValue)
      onPreviewChange?.(null)
      return true
    }
    isPreviewDirtyRef.current = false
    onPreviewChange?.(null)
    const trimmed = normalizeOpaqueColor(candidate)
    if (trimmed) {
      setInputError('')
      if (trimmed !== lastCommittedRef.current || failure.current) {
        draftRef.current = trimmed
        setDraft(trimmed)
        setPickerDraft(trimmed)
        const finish = () => { failure.current = undefined; lastCommittedRef.current = trimmed; setInputError(''); setInputEpoch(epoch => epoch + 1); return draftRef.current === trimmed }
        const fail = (error: unknown) => {
          if (isCourseComponentInputFailure(error)) failure.current = { error, value: trimmed, bindingKey: ownerBinding.current, label, kind: 'text' }
          setInputError(error instanceof Error ? error.message : String(error))
          return isCourseComponentInputFailure(error) ? settleCourseComponentInput(error).then(outcome => outcome === 'applied' && failure.current?.error === error ? finish() : false,
            reason => { setInputError(reason instanceof Error ? reason.message : String(reason)); return false }) : false
        }
        try {
          const previous = failure.current
          const result = previous ? previous.error.resolveInput('retry').then(outcome => {
            if (outcome === 'pending') { setInputError(previous.error.message); return false }
            if (failure.current !== previous || ownerBinding.current !== latest.current.bindingKey || propertyDraftSuspended(ownerBinding.current)) return false
            if (outcome === 'applied') {
              failure.current = undefined; lastCommittedRef.current = previous.value
              if (draftRef.current !== trimmed || previous.value !== trimmed) { setInputError(''); return false }
              return true
            }
            if (draftRef.current !== trimmed) return false
            failure.current = undefined
            return Promise.resolve(commitRef.current(trimmed)).then(() => true)
          }) : commitRef.current(trimmed)
          if (!result) return finish()
          const ack = Promise.resolve(result).then(applied => { pending.current = undefined; return applied === false ? false : finish() }, error => { pending.current = undefined; return fail(error) })
          pending.current = ack; return ack
        } catch (error) { return fail(error) }
      } else {
        draftRef.current = normalizedValue
        setDraft(normalizedValue)
        setPickerDraft(normalizedValue)
      }
      return true
    } else {
      setInputError('当前专业颜色支持 #RGB、#RRGGBB 或不透明 rgb()；输入已保留，请修正后应用。')
      return false
    }
  }

  const cancel = () => {
    if (pending.current) return
    const reset = () => {
      isCancelledRef.current = true
      ownerBinding.current = latest.current.bindingKey; commitRef.current = latest.current.onChange; lastCommittedRef.current = latest.current.value
      resumeRequired.current = false; composing.current = false; failure.current = undefined
      isPreviewDirtyRef.current = false; draftRef.current = latest.current.value
      setDraft(latest.current.value); setPickerDraft(latest.current.value); setInputError(''); onPreviewChangeRef.current?.(null)
    }
    const previous = failure.current
    if (!previous) { reset(); return }
    const raw = draftRef.current
    const task = previous.error.resolveInput('cancel').then(outcome => {
      if (outcome === 'pending') { setInputError(previous.error.message); return false }
      if (failure.current !== previous || draftRef.current !== raw) return false
      reset(); return true
    }, error => { setInputError(error instanceof Error ? error.message : String(error)); return false })
      .finally(() => { if (pending.current === task) pending.current = undefined })
    pending.current = task
  }

  const handlePresetClick = (presetColor: string) => {
    isCancelledRef.current = false
    isPreviewDirtyRef.current = false
    onPreviewChange?.(null)
    const next = presetColor.toLowerCase()
    setInputError('')
    if (next !== normalizedValue && next !== lastCommittedRef.current) {
      draftRef.current = next
      setDraft(next)
      setPickerDraft(next)
      commit(next, true)
    }
  }

  usePropertyDraftFlush(() => dirty() ? commit() : true, {
    hasDirty: dirty,
    isComposing: () => composing.current,
    inFlight: () => pending.current,
    commitFailure: () => failure.current,
    readDraft: () => ({ bindingKey: ownerBinding.current, label, kind: 'text', raw: draftRef.current,
      baseline: lastCommittedRef.current, composing: resumeRequired.current || composing.current }),
    restoreDraft: (record, resume) => { ownerBinding.current = record.bindingKey; lastCommittedRef.current = record.baseline ?? normalizedValue
      draftRef.current = record.raw; resumeRequired.current = record.composing; setDraft(record.raw)
      const sameSession = resume?.readDraft()?.bindingKey === bindingKey
      const adoptFailure = () => {
        const previous = sameSession ? resume?.commitFailure?.() : undefined
        failure.current = previous?.bindingKey === bindingKey && previous.label === label && previous.kind === 'text' ? previous : undefined
        if (failure.current) setInputError(failure.current.error.message)
      }
      adoptFailure()
      if (sameSession && resume?.pending) {
        const task = resume.pending.then(ready => {
          if (pending.current !== task) return ready
          pending.current = undefined; adoptFailure()
          const previous = resume.readDraft()
          if (previous?.baseline !== undefined) lastCommittedRef.current = previous.baseline
          setInputEpoch(epoch => epoch + 1)
          return ready && !failure.current && draftRef.current === lastCommittedRef.current
        })
        pending.current = task
      }
      const normalized = normalizeOpaqueColor(record.raw); if (normalized) setPickerDraft(normalized) },
  })

  return (
    <div className="form-field" {...(testId ? { 'data-testid': testId } : {})}>
      <label htmlFor={`${id}-text`}>{label}</label>
      <div className="color-presets" role="group" aria-label={`${label}常用色`}>
        {COMMON_COLOR_PRESETS.map((preset) => {
          const isSelected = preset.value.toLowerCase() === normalizedValue
          return (
            <button
              key={preset.value}
              type="button"
              className={`color-preset-swatch ${isSelected ? 'is-selected' : ''}`}
              data-testid={`${id}-preset-${preset.value.replace('#', '')}`}
              data-selected={isSelected ? 'true' : undefined}
              aria-current={isSelected ? 'true' : undefined}
              aria-label={`${preset.name} ${preset.value}`}
              title={`${preset.name} (${preset.value})`}
              style={{ backgroundColor: preset.value, color: preset.contrastColor ?? '#ffffff' }}
              onClick={() => handlePresetClick(preset.value)}
            >
              {isSelected ? '✓' : ''}
            </button>
          )
        })}
      </div>
      {projectColors.length > 0 && <div className="color-presets" role="group" aria-label={`${label}项目色板`}>
        {projectColors.map((preset, index) => <button
          key={`${preset.name}:${index}`}
          type="button"
          className={`color-preset-swatch${preset.value.toLowerCase() === normalizedValue ? ' is-selected' : ''}`}
          aria-label={`项目色 ${preset.name} ${preset.value}`}
          title={`${preset.name} (${preset.value})`}
          style={{ backgroundColor: preset.value }}
          onClick={() => handlePresetClick(preset.value)}
        >{preset.value.toLowerCase() === normalizedValue ? '✓' : ''}</button>)}
      </div>}
      <div className="color-control">
        <input
          ref={pickerRef}
          className="color-swatch"
          id={`${id}-picker`}
          type="color"
          aria-label={`${label}选择器`}
          value={isValidHex(pickerDraft) ? pickerDraft : '#000000'}
          onPointerDown={() => { rejectRetiredPickerRef.current = false }}
          onKeyDown={() => { rejectRetiredPickerRef.current = false }}
          onChange={() => {}}
        />
        <input
          className="form-input"
          id={`${id}-text`}
          value={draft}
          aria-invalid={Boolean(inputError) || undefined}
          onFocus={() => {
            isCancelledRef.current = false
          }}
          onChange={(event) => {
            isCancelledRef.current = false
            resumeRequired.current = false
            const nextVal = event.target.value
            setInputError('')
            draftRef.current = nextVal
            setDraft(nextVal)
            const trimmed = normalizeOpaqueColor(nextVal)
            if (trimmed) {
              setPickerDraft(trimmed)
              isPreviewDirtyRef.current = true
              onPreviewChange?.(trimmed)
            }
          }}
          onCompositionStart={() => { composing.current = true; resumeRequired.current = false; setInputEpoch(epoch => epoch + 1) }}
          onCompositionEnd={() => { composing.current = false; setInputEpoch(epoch => epoch + 1) }}
          onBlur={() => commit()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              if (event.nativeEvent.isComposing || composing.current) return
              commit(undefined, true)
              event.currentTarget.blur()
            }
            if (event.key === 'Escape') {
              cancel()
              event.currentTarget.blur()
            }
          }}
        />
      </div>
      {inputError && <small role="alert">{inputError}</small>}
      <button type="button" className="secondary-button" aria-expanded={expanded}
        onClick={() => { if (expanded) commit(); setExpanded(!expanded) }}>连续调色</button>
      {expanded && <div role="group" aria-label={`${label}连续调色`} onKeyDown={event => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        pointerGestureRef.current = false
        cancel()
        setExpanded(false)
      }}>
        {['红', '绿', '蓝'].map((channel, index) => <label key={channel} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {channel}<input type="range" min={0} max={255} step={1} aria-label={`${label}${channel}通道`}
            style={{ flex: 1, minWidth: 0 }}
            value={parseInt((isValidHex(pickerDraft) ? pickerDraft : '#000000').slice(1 + index * 2, 3 + index * 2), 16)}
            onPointerDown={event => {
              pointerGestureRef.current = true
              isCancelledRef.current = false
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onChange={event => {
              const before = isValidHex(draftRef.current) ? draftRef.current : '#000000'
              const offset = 1 + index * 2
              const next = before.slice(0, offset) + Number(event.currentTarget.value).toString(16).padStart(2, '0') + before.slice(offset + 2)
              draftRef.current = next
              setDraft(next)
              setPickerDraft(next)
              isPreviewDirtyRef.current = true
              onPreviewChange?.(next)
            }}
            onPointerUp={() => { pointerGestureRef.current = false; commit(undefined, true) }}
            onPointerCancel={() => { pointerGestureRef.current = false; cancel() }}
            onLostPointerCapture={() => {
              if (!pointerGestureRef.current) return
              pointerGestureRef.current = false
              cancel()
            }}
            onKeyUp={event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) commit(undefined, true) }}
            onBlur={() => {
              if (pointerGestureRef.current) {
                pointerGestureRef.current = false
                isCancelledRef.current = true
              }
              commit()
            }}
          />
        </label>)}
      </div>}
    </div>
  )
}
