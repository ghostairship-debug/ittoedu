import { useEffect, useRef, useState } from 'react'

export interface ColorPreset {
  readonly name: string
  readonly value: string
  readonly contrastColor?: string
}

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

export interface ColorInputProps {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
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
  const normalizedValue = (value || '').toLowerCase()
  const [draft, setDraft] = useState(normalizedValue)
  const [pickerDraft, setPickerDraft] = useState(normalizedValue)
  const isCancelledRef = useRef(false)
  const isPreviewDirtyRef = useRef(false)
  const draftRef = useRef(normalizedValue)
  const pickerRef = useRef<HTMLInputElement>(null)
  const lastCommittedRef = useRef(normalizedValue)
  const onPreviewChangeRef = useRef(onPreviewChange)

  useEffect(() => {
    onPreviewChangeRef.current = onPreviewChange
  }, [onPreviewChange])

  useEffect(() => {
    isCancelledRef.current = false
    draftRef.current = normalizedValue
    setDraft(normalizedValue)
    setPickerDraft(normalizedValue)
  }, [normalizedValue])

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
      isCancelledRef.current = false
      isPreviewDirtyRef.current = true
      const targetVal = (e.target as HTMLInputElement).value.toLowerCase()
      setPickerDraft(targetVal)
      draftRef.current = targetVal
      setDraft(targetVal)
      onPreviewChange?.(targetVal)
    }

    const handleNativeChange = (e: Event) => {
      isCancelledRef.current = false
      isPreviewDirtyRef.current = false
      const targetVal = (e.target as HTMLInputElement).value.toLowerCase()
      setPickerDraft(targetVal)
      draftRef.current = targetVal
      setDraft(targetVal)
      onPreviewChange?.(null)
      if (targetVal !== normalizedValue && targetVal !== lastCommittedRef.current) {
        lastCommittedRef.current = targetVal
        onChange(targetVal)
      }
    }

    el.addEventListener('input', handleNativeInput)
    el.addEventListener('change', handleNativeChange)
    return () => {
      el.removeEventListener('input', handleNativeInput)
      el.removeEventListener('change', handleNativeChange)
    }
  }, [normalizedValue, onChange, onPreviewChange])

  const commit = () => {
    if (isCancelledRef.current) {
      isCancelledRef.current = false
      isPreviewDirtyRef.current = false
      draftRef.current = normalizedValue
      setDraft(normalizedValue)
      setPickerDraft(normalizedValue)
      onPreviewChange?.(null)
      return
    }
    isPreviewDirtyRef.current = false
    onPreviewChange?.(null)
    const trimmed = draftRef.current.trim().toLowerCase()
    if (isValidHex(trimmed)) {
      if (trimmed !== normalizedValue && trimmed !== lastCommittedRef.current) {
        lastCommittedRef.current = trimmed
        draftRef.current = trimmed
        setDraft(trimmed)
        setPickerDraft(trimmed)
        onChange(trimmed)
      } else {
        draftRef.current = normalizedValue
        setDraft(normalizedValue)
        setPickerDraft(normalizedValue)
      }
    } else {
      draftRef.current = normalizedValue
      setDraft(normalizedValue)
      setPickerDraft(normalizedValue)
    }
  }

  const handlePresetClick = (presetColor: string) => {
    isCancelledRef.current = false
    isPreviewDirtyRef.current = false
    onPreviewChange?.(null)
    const next = presetColor.toLowerCase()
    if (next !== normalizedValue && next !== lastCommittedRef.current) {
      lastCommittedRef.current = next
      draftRef.current = next
      setDraft(next)
      setPickerDraft(next)
      onPreviewChange?.(next)
      onChange(next)
    }
  }

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
      <div className="color-control">
        <input
          ref={pickerRef}
          className="color-swatch"
          id={`${id}-picker`}
          type="color"
          aria-label={`${label}选择器`}
          value={isValidHex(pickerDraft) ? pickerDraft : '#000000'}
          onChange={() => {}}
        />
        <input
          className="form-input"
          id={`${id}-text`}
          value={draft}
          maxLength={7}
          onFocus={() => {
            isCancelledRef.current = false
          }}
          onChange={(event) => {
            isCancelledRef.current = false
            const nextVal = event.target.value
            draftRef.current = nextVal
            setDraft(nextVal)
            const trimmed = nextVal.trim().toLowerCase()
            if (isValidHex(trimmed)) {
              setPickerDraft(trimmed)
              isPreviewDirtyRef.current = true
              onPreviewChange?.(trimmed)
            }
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commit()
              event.currentTarget.blur()
            }
            if (event.key === 'Escape') {
              isCancelledRef.current = true
              isPreviewDirtyRef.current = false
              draftRef.current = normalizedValue
              setDraft(normalizedValue)
              setPickerDraft(normalizedValue)
              onPreviewChange?.(null)
              event.currentTarget.blur()
            }
          }}
        />
      </div>
    </div>
  )
}
