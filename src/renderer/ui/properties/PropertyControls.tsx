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
import { fontFamilySource, FONT_FAMILY_SOURCE_TAGS, FONT_FAMILY_OPTIONS, orderFontOptionsBySource } from '../../../shared/fonts/fontFamilyCatalog'
import { captureTextRunInputEdit, type TextRunEdit, type TextRunInputCapture } from '../../../shared/textRuns'
export { fontFamilySource, FONT_FAMILY_SOURCE_TAGS, FONT_FAMILY_OPTIONS, COMMON_FONT_FAMILIES } from '../../../shared/fonts/fontFamilyCatalog'
export type { FontFamilySource } from '../../../shared/fonts/fontFamilyCatalog'

interface PropertyDraftBindingValue {
  readonly key: string
  readonly onStale: () => void
}

const PropertyDraftBindingContext = createContext<PropertyDraftBindingValue | null>(null)

type PropertyDraftFlush = () => boolean | Promise<boolean>
export interface PropertyDraftRecovery {
  readonly bindingKey: string
  readonly label: string
  readonly kind: 'text' | 'number' | 'range' | 'chart' | 'structured'
  readonly raw: string
  readonly baseline?: string
  readonly composing: boolean
}
interface PropertyDraftPort {
  hasDirty(): boolean
  readDraft(): PropertyDraftRecovery
  restoreDraft?(draft: PropertyDraftRecovery): void
}
type PropertyDraftEntry = { flush: PropertyDraftFlush; read: () => PropertyDraftRecovery | null; dirty: () => boolean;
  restore?: (draft: PropertyDraftRecovery) => void; mounted?: boolean }
const pendingPropertyDrafts = new Set<PropertyDraftEntry>()
const propertyDraftListeners = new Set<() => void>()
let notificationPending = false
function notifyPropertyDrafts() {
  if (notificationPending) return
  notificationPending = true
  queueMicrotask(() => { notificationPending = false; for (const listener of propertyDraftListeners) listener() })
}
function bindingParts(key: string): unknown[] | null {
  try { const parts: unknown = JSON.parse(key); return Array.isArray(parts) ? parts : null } catch { return null }
}
function belongsToDocument(entry: PropertyDraftEntry, documentId?: string): boolean {
  return documentId === undefined || bindingParts(entry.read()?.bindingKey ?? '')?.[0] === documentId
}
function sameDraftTarget(left: PropertyDraftRecovery, right: PropertyDraftRecovery): boolean {
  const a = bindingParts(left.bindingKey), b = bindingParts(right.bindingKey)
  return left.label === right.label && left.kind === right.kind && (a && b
    ? a[0] === b[0] && JSON.stringify(a.slice(2)) === JSON.stringify(b.slice(2))
    : left.bindingKey === right.bindingKey)
}

export function subscribePropertiesDrafts(listener: () => void): () => void {
  propertyDraftListeners.add(listener)
  return () => { propertyDraftListeners.delete(listener) }
}
export function hasPropertiesDrafts(documentId?: string): boolean {
  return [...pendingPropertyDrafts].some(entry => belongsToDocument(entry, documentId) && entry.dirty())
}
export function preservePropertiesDrafts(documentId: string): PropertyDraftRecovery[] {
  return [...pendingPropertyDrafts].filter(entry => belongsToDocument(entry, documentId) && entry.dirty())
    .flatMap(entry => { const draft = entry.read(); return draft ? [draft] : [] })
}
/** Called after the existing document owner has preserved or explicitly discarded the input. */
export function discardPropertiesDrafts(documentId: string): void {
  for (const entry of [...pendingPropertyDrafts]) if (belongsToDocument(entry, documentId)) pendingPropertyDrafts.delete(entry)
  notifyPropertyDrafts()
}
/** Recovery restores input only. It never replays an authoring command. */
export function restorePropertiesDrafts(documentId: string, records: readonly PropertyDraftRecovery[], epoch?: string): void {
  for (const record of records) {
    const parts = bindingParts(record.bindingKey)
    if (!parts) continue
    const draft = { ...record, bindingKey: JSON.stringify([documentId, epoch ?? parts[1], ...parts.slice(2)]) }
    const existing = [...pendingPropertyDrafts].find(entry => entry.read() && sameDraftTarget(entry.read()!, draft))
    if (existing) {
      if (!existing.dirty()) existing.restore?.({ ...draft, bindingKey: existing.read()!.bindingKey })
      continue
    }
    pendingPropertyDrafts.add({ flush: () => false, read: () => draft, dirty: () => true })
  }
  notifyPropertyDrafts()
}

/** Saving commits focused property drafts without moving focus. IME retains its native composition. */
export async function flushPropertiesDrafts(documentId?: string): Promise<boolean> {
  let complete = true
  for (const entry of [...pendingPropertyDrafts]) {
    if (!belongsToDocument(entry, documentId)) continue
    const before = entry.read()?.raw
    let finished = await entry.flush()
    // A newer edit arriving during the ACK is new work, not a retry of the old command.
    if (!finished && entry.dirty() && before !== entry.read()?.raw) finished = await entry.flush()
    if (!finished) complete = false
    if (entry.mounted === false && !entry.dirty()) pendingPropertyDrafts.delete(entry)
  }
  notifyPropertyDrafts()
  return complete
}

export function usePropertyDraftFlush(flush: PropertyDraftFlush, port?: PropertyDraftPort): void {
  const binding = useContext(PropertyDraftBindingContext)?.key ?? 'unbound'
  const current = useRef({ flush, port, binding })
  current.current = { flush, port, binding }
  const lastDraft = useRef('')
  useLayoutEffect(() => {
    const entry: PropertyDraftEntry = { flush: () => current.current.flush(),
      read: () => current.current.port?.readDraft() ?? { bindingKey: current.current.binding, label: '', kind: 'text', raw: '', composing: false },
      dirty: () => current.current.port?.hasDirty() ?? false,
      restore: record => current.current.port?.restoreDraft?.(record), mounted: true }
    const target = entry.read()
    if (target && current.current.port?.restoreDraft) {
      for (const saved of [...pendingPropertyDrafts]) {
        const record = saved.read()
        if (saved.dirty() && record && sameDraftTarget(record, target)) {
          pendingPropertyDrafts.delete(saved)
          current.current.port.restoreDraft({ ...record, bindingKey: target.bindingKey })
          break
        }
      }
    }
    pendingPropertyDrafts.add(entry)
    return () => {
      entry.mounted = false
      // A panel disappearing is navigation, not permission to discard its input.
      if (!entry.dirty() || !bindingParts(entry.read()?.bindingKey ?? '')) pendingPropertyDrafts.delete(entry)
      notifyPropertyDrafts()
    }
  }, [])
  useLayoutEffect(() => {
    const next = port?.hasDirty() ? JSON.stringify(port.readDraft()) : ''
    if (lastDraft.current !== next) { lastDraft.current = next; notifyPropertyDrafts() }
  })
}

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
  validate?(value: string): string | null
  onCommit(value: string): void | Promise<void>
}

export function BufferedInput(props: BufferedInputProps) {
  const bindingKey = usePropertyDraftBindingKey()
  // A numeric draft belongs to its original object, even when the next object
  // happens to have the same value. The existing registry preserves the old
  // session on unmount and restores it only when that target is shown again.
  return <BufferedPropertyInput key={props.type === 'number' ? bindingKey : undefined} {...props} />
}

function BufferedPropertyInput({
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
  validate,
  onCommit,
}: BufferedInputProps) {
  const draftBinding = useContext(PropertyDraftBindingContext)
  const currentBindingKey = draftBinding?.key ?? 'unbound-property-draft'
  const currentValue = String(value)
  const [draft, setDraft] = useState(currentValue)
  const [commitError, setCommitError] = useState('')
  const resumeRequired = useRef(false)
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
    onCommit: (value: string) => void | Promise<void>
    pending?: Promise<boolean>
  }>({
    phase: 'idle',
    bindingKey: currentBindingKey,
    baseline: currentValue,
    draft: currentValue,
    staleNotified: false,
    onCommit,
  })
  const stale = sessionRef.current.phase !== 'idle' && (
    sessionRef.current.bindingKey !== currentBindingKey
    || (currentValue !== sessionRef.current.baseline && currentValue !== sessionRef.current.draft)
  )

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

  const sessionIsStale = () => sessionRef.current.phase !== 'idle' && (
    sessionRef.current.bindingKey !== currentRef.current.bindingKey
    || (currentRef.current.value !== sessionRef.current.baseline && currentRef.current.value !== sessionRef.current.draft)
  )
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
    session.pending = undefined
    setCommitError('')
    resumeRequired.current = false
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
  const commit = (candidate = sessionRef.current.draft): boolean | Promise<boolean> => {
    const session = sessionRef.current
    if (session.pending) return session.pending
    if (resumeRequired.current) { setCommitError('恢复的输入法草稿尚未完成，请继续编辑后再应用。'); return false }
    if (rejectStale()) return false
    if (candidate === session.baseline) {
      session.phase = 'idle'
      setCommitError('')
      return true
    }
    let next = candidate
    if (type === 'number') {
      const parsed = Number(candidate)
      if (!candidate.trim() || !Number.isFinite(parsed)) {
        setCommitError('请输入完整的有效数值；输入已保留。')
        return false
      }
      if (parsed < (min ?? -Infinity) || parsed > (max ?? Infinity)) {
        setCommitError(`数值应在 ${min ?? '−∞'} 到 ${max ?? '∞'} 之间；输入已保留。`)
        return false
      }
      next = String(parsed)
    } else if (allowEmpty || candidate.trim()) {
      next = candidate.trim()
    } else {
      setCommitError('请输入非空内容；输入已保留。')
      return false
    }
    const reason = validate?.(next)
    if (reason) { setCommitError(reason); return false }
    const callback = session.onCommit
    const changed = next !== session.baseline
    session.draft = next
    session.staleNotified = false
    setDraft(next)
    setCommitError('')
    const finish = () => {
      session.baseline = next
      if (session.draft === next && session.phase !== 'composing' && session.phase !== 'blur-pending') session.phase = 'idle'
      setSessionEpoch(epoch => epoch + 1)
      return session.phase === 'idle'
    }
    const fail = (error: unknown) => {
      setCommitError(error instanceof Error ? error.message : String(error))
      return false
    }
    if (!changed) return finish()
    try {
      const result = callback(next)
      if (!result) return finish()
      const pending = Promise.resolve(result).then(() => {
        if (session.pending !== pending) return true
        session.pending = undefined
        return finish()
      }, error => {
        if (session.pending !== pending) return false
        session.pending = undefined
        return fail(error)
      })
      session.pending = pending
      return pending
    } catch (error) { return fail(error) }
  }
  usePropertyDraftFlush(() => {
    const session = sessionRef.current
    if (session.pending) return session.pending
    if (session.phase === 'idle') return true
    if (session.phase === 'composing' || session.phase === 'blur-pending' || rejectStale()) return false
    return commit()
  }, {
    hasDirty: () => resumeRequired.current || Boolean(sessionRef.current.pending) || sessionRef.current.draft !== sessionRef.current.baseline
      || sessionRef.current.phase === 'composing' || sessionRef.current.phase === 'blur-pending',
    readDraft: () => ({ bindingKey: sessionRef.current.bindingKey, label, kind: type, raw: sessionRef.current.draft,
      baseline: sessionRef.current.baseline, composing: resumeRequired.current || sessionRef.current.phase === 'composing' || sessionRef.current.phase === 'blur-pending' }),
    restoreDraft: record => {
      sessionRef.current.phase = 'editing'
      sessionRef.current.bindingKey = record.bindingKey
      sessionRef.current.baseline = record.baseline ?? currentValue
      sessionRef.current.draft = record.raw
      resumeRequired.current = record.composing
      if (record.composing) setCommitError('恢复的输入法草稿尚未完成，请继续编辑后再应用。')
      setDraft(record.raw)
    },
  })
  return (
    <div className="form-field">
      <label>{label}</label>
      <input
        className="form-input"
        aria-label={label}
        type={type === 'number' ? 'text' : type}
        inputMode={type === 'number' ? 'decimal' : undefined}
        role={type === 'number' ? 'spinbutton' : undefined}
        aria-valuenow={type === 'number' && draft.trim() && Number.isFinite(Number(draft)) ? Number(draft) : undefined}
        aria-valuemin={type === 'number' ? min : undefined}
        aria-valuemax={type === 'number' ? max : undefined}
        value={draft}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-invalid={stale || Boolean(commitError) || undefined}
        title={stale ? '属性草稿对应的编辑目标已经改变，请按 Esc 放弃草稿后重试。' : title}
        placeholder={placeholder}
        onFocus={beginSession}
        onChange={(event) => {
          if (rejectStale()) return
          resumeRequired.current = false
          if (sessionRef.current.phase === 'idle') beginSession()
          const nextDraft = event.target.value
          const session = sessionRef.current
          session.draft = nextDraft
          setDraft(nextDraft)
        }}
        onCompositionStart={() => {
          if (rejectStale()) return
          resumeRequired.current = false
          if (sessionRef.current.phase === 'idle') beginSession()
          sessionRef.current.phase = 'composing'
          setSessionEpoch(epoch => epoch + 1)
        }}
        onCompositionEnd={(event) => {
          if (rejectStale()) {
            sessionRef.current.phase = 'editing'
            sessionRef.current.draft = event.currentTarget.value
            setDraft(event.currentTarget.value)
            return
          }
          const session = sessionRef.current
          const next = event.currentTarget.value
          const shouldCommit = session.phase === 'blur-pending'
          session.phase = 'editing'
          session.draft = next
          setDraft(next)
          setSessionEpoch(epoch => epoch + 1)
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
          if (type === 'number' && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
            if (rejectStale() || !session.draft.trim() || !Number.isFinite(Number(session.draft))) return
            event.preventDefault()
            resumeRequired.current = false
            if (session.phase === 'idle') beginSession()
            const next = Math.min(max ?? Infinity, Math.max(min ?? -Infinity,
              Number(session.draft) + (event.key === 'ArrowUp' ? 1 : -1) * (step ?? 1)))
            session.draft = String(Number(next.toPrecision(15)))
            setDraft(session.draft)
          }
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
              session.pending = undefined
              setCommitError('')
              resumeRequired.current = false
              setDraft(session.baseline)
            }
            event.currentTarget.blur()
          }
        }}
      />
      {commitError && <small role="alert">{commitError}</small>}
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
  usePropertyDraftFlush(() => {
    if (!sessionRef.current.active) return true
    if (rejectStale()) return false
    commit(sessionRef.current.draft)
    return true
  }, {
    hasDirty: () => sessionRef.current.active && sessionRef.current.draft !== sessionRef.current.baseline,
    readDraft: () => ({ bindingKey: sessionRef.current.bindingKey, label, kind: 'range', raw: String(sessionRef.current.draft),
      baseline: String(sessionRef.current.baseline), composing: false }),
    restoreDraft: record => {
      sessionRef.current.active = true
      sessionRef.current.bindingKey = record.bindingKey
      sessionRef.current.baseline = Number(record.baseline ?? value)
      sessionRef.current.draft = Number(record.raw)
      setDraft(sessionRef.current.draft)
    },
  })
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
  onChange(value: string, edit?: TextRunEdit): void
  onCommit(): void
  onCancel(): void
  onCompositionChange?(composing: boolean): void
}) {
  const draftBinding = useContext(PropertyDraftBindingContext)
  const currentBindingKey = draftBinding?.key ?? 'unbound-property-draft'
  const [draft, setDraft] = useState(value)
  const [, setSessionEpoch] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const inputCaptureRef = useRef<TextRunInputCapture | null>(null)
  const resumeRequired = useRef(false)
  const compositionCaptureRef = useRef<TextRunInputCapture | null>(null)
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
    onChange: (value: string, edit?: TextRunEdit) => void
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
  /**
   * A begin callback that rebinds the edit lease may only reach its canonical
   * revision once the commit is acknowledged, so the refreshed binding key can
   * arrive later. While the draft is untouched there is nothing to protect, so
   * the session adopts that key instead of turning stale.
   */
  const adoptBindingRef = useRef(false)

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
      if (session.bindingKey === current.bindingKey) {
        copyCurrentHandlers()
        return
      }
      const adopting = adoptBindingRef.current && session.draft === session.baseline
      adoptBindingRef.current = false
      if (!adopting) return
      session.bindingKey = current.bindingKey
      session.baseline = current.value
      session.draft = current.value
      session.staleNotified = false
      inputCaptureRef.current = null
      compositionCaptureRef.current = null
      copyCurrentHandlers()
      setDraft(current.value)
      return
    }
    adoptBindingRef.current = false
    session.bindingKey = current.bindingKey
    session.baseline = current.value
    session.draft = current.value
    session.staleNotified = false
    inputCaptureRef.current = null
    compositionCaptureRef.current = null
    resumeRequired.current = false
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
    inputCaptureRef.current = null
    compositionCaptureRef.current = null
    resumeRequired.current = false
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
    adoptBindingRef.current = Boolean(rebindAfterBegin)
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
    if (resumeRequired.current) return
    const session = sessionRef.current
    if (rejectStale()) return
    const commit = session.onCommit
    session.phase = 'idle'
    session.baseline = session.draft
    session.staleNotified = false
    inputCaptureRef.current = null
    compositionCaptureRef.current = null
    commit()
  }
  usePropertyDraftFlush(() => {
    if (resumeRequired.current) return false
    const session = sessionRef.current
    if (session.phase === 'idle') return true
    if (session.phase === 'composing' || session.phase === 'blur-pending' || rejectStale()) return false
    finishCommit()
    return true
  }, {
    hasDirty: () => resumeRequired.current || sessionRef.current.draft !== sessionRef.current.baseline
      || sessionRef.current.phase === 'composing' || sessionRef.current.phase === 'blur-pending',
    readDraft: () => ({ bindingKey: sessionRef.current.bindingKey, label, kind: 'text', raw: sessionRef.current.draft,
      baseline: sessionRef.current.baseline, composing: resumeRequired.current || sessionRef.current.phase === 'composing' || sessionRef.current.phase === 'blur-pending' }),
    restoreDraft: record => {
      sessionRef.current.phase = 'editing'
      sessionRef.current.bindingKey = record.bindingKey
      sessionRef.current.baseline = record.baseline ?? value
      sessionRef.current.draft = record.raw
      resumeRequired.current = record.composing
      setDraft(record.raw)
      setSessionEpoch(epoch => epoch + 1)
      sessionRef.current.onBegin()
      sessionRef.current.onChange(record.raw)
    },
  })

  const finishComposition = (finalDraft: string) => {
    queueMicrotask(() => {
      const session = sessionRef.current
      if (session.phase === 'idle') return
      if (rejectStale()) {
        session.onCompositionChange?.(false)
        session.phase = 'editing'
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

  const captureInput = (element: HTMLTextAreaElement, inputType: string): TextRunInputCapture => ({
    previousText: element.value,
    selectionStartUtf16: element.selectionStart ?? element.value.length,
    selectionEndUtf16: element.selectionEnd ?? element.value.length,
    inputType,
  })

  const publishChange = (
    handler: (value: string, edit?: TextRunEdit) => void,
    next: string,
    capture: TextRunInputCapture | null,
  ) => {
    if (!capture) {
      handler(next)
      return
    }
    const resolved = captureTextRunInputEdit(capture, next)
    if (resolved.ok) handler(next, resolved.edit)
    else handler(next)
  }

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    const handleBeforeInput = (event: InputEvent) => {
      if (rejectStale()) return
      if (sessionRef.current.phase === 'composing' || sessionRef.current.phase === 'blur-pending') return
      inputCaptureRef.current = captureInput(textarea, event.inputType)
    }
    textarea.addEventListener('beforeinput', handleBeforeInput)
    return () => textarea.removeEventListener('beforeinput', handleBeforeInput)
  })

  return (
    <div className="form-field">
      <label>{label}</label>
      <textarea
        ref={textareaRef}
        className="form-textarea"
        aria-label={label}
        value={draft}
        aria-invalid={stale || undefined}
        title={stale ? '文字草稿对应的编辑目标已经改变，请按 Esc 放弃草稿后重试。' : undefined}
        onFocus={beginSession}
        onChange={(event) => {
          if (rejectStale()) return
          resumeRequired.current = false
          const next = event.target.value
          setDraft(next)
          const session = sessionRef.current
          session.draft = next
          if (session.phase !== 'composing' && session.phase !== 'blur-pending') {
            const capture = inputCaptureRef.current
            inputCaptureRef.current = null
            publishChange(session.onChange, next, capture)
          }
        }}
        onCompositionStart={(event) => {
          if (rejectStale()) return
          resumeRequired.current = false
          const session = sessionRef.current
          compositionCaptureRef.current = captureInput(event.currentTarget, 'insertCompositionText')
          inputCaptureRef.current = null
          session.phase = 'composing'
          session.onCompositionChange?.(true)
        }}
        onCompositionEnd={(event) => {
          if (rejectStale()) {
            const session = sessionRef.current
            session.onCompositionChange?.(false)
            session.phase = 'editing'
            session.draft = event.currentTarget.value
            setDraft(event.currentTarget.value)
            return
          }
          const session = sessionRef.current
          const finalDraft = event.currentTarget.value
          session.draft = finalDraft
          setDraft(finalDraft)
          const capture = compositionCaptureRef.current
          compositionCaptureRef.current = null
          publishChange(session.onChange, finalDraft, capture)
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
              session.onCancel()
              rebaseCurrent()
            } else {
              const baseline = session.baseline
              const cancel = session.onCancel
              resumeRequired.current = false
              session.phase = 'idle'
              session.draft = baseline
              session.staleNotified = false
              inputCaptureRef.current = null
              compositionCaptureRef.current = null
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
      {resumeRequired.current && <small role="status">恢复的输入法草稿尚未完成，请继续编辑后再应用。</small>}
    </div>
  )
}

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
