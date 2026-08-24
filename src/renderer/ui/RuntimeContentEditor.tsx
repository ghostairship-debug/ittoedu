import { useEffect, useRef, useState } from 'react'
import type { CourseRuntimeContentTextTarget } from '../runtime/runtimeContentTextAuthoringCommands'
import type { RuntimeInspectorContentField } from '../runtime/runtimeInspectorAuthoringView'

export type RuntimeContentEditorField = RuntimeInspectorContentField

export type RuntimeContentEditorCommitResult =
  | {
      readonly ok: true
      readonly status: 'updated' | 'unchanged'
    }
  | {
      readonly ok: false
      readonly reason: string
    }

export interface RuntimeContentEditorProps {
  fields: readonly RuntimeContentEditorField[]
  disabled?: boolean
  onCommit(
    target: CourseRuntimeContentTextTarget,
    value: string,
  ): RuntimeContentEditorCommitResult
}

function humanizeKey(key: string): string {
  const leaf = key.split('.').pop() ?? key
  return leaf
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim() || key
}

function RuntimeContentField({
  field,
  disabled,
  onCommit,
}: {
  field: RuntimeContentEditorField
  disabled: boolean
  onCommit(
    target: CourseRuntimeContentTextTarget,
    value: string,
  ): RuntimeContentEditorCommitResult
}) {
  const [editing, setEditing] = useState(() => ({
    draft: field.value,
    capturedValue: field.value,
    target: field.target,
    dirty: false,
  }))
  const [result, setResult] = useState<{
    kind: 'success' | 'error'
    message: string
  } | null>(null)
  const cancelBlurRef = useRef(false)
  const dirtyRef = useRef(false)

  useEffect(() => {
    if (dirtyRef.current) return
    setEditing({
      draft: field.value,
      capturedValue: field.value,
      target: field.target,
      dirty: false,
    })
    setResult(null)
  }, [field.target, field.value])

  const label = field.metadata?.label ?? humanizeKey(field.key)
  const id = `runtime-content-${field.key.replace(/[^A-Za-z0-9_-]/g, '-')}`
  const descriptionId = field.metadata?.description ? `${id}-description` : undefined
  const resultId = result ? `${id}-result` : undefined
  const describedBy = [descriptionId, resultId].filter(Boolean).join(' ') || undefined

  const commitDraft = () => {
    const next = onCommit(editing.target, editing.draft)
    if (next.ok) {
      dirtyRef.current = false
      setEditing((current) => ({
        ...current,
        capturedValue: current.draft,
        dirty: false,
      }))
    }
    setResult(next.ok
      ? {
          kind: 'success',
          message: next.status === 'updated' ? '已保存' : '没有变化',
        }
      : { kind: 'error', message: next.reason })
  }

  const commit = () => {
    if (cancelBlurRef.current) return
    commitDraft()
  }

  const common = {
    id,
    'aria-label': label,
    'aria-describedby': describedBy,
    value: editing.draft,
    maxLength: field.metadata?.maxLength,
    disabled,
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      const value = event.target.value
      dirtyRef.current = value !== editing.capturedValue
      setEditing((current) => ({
        ...current,
        draft: value,
        dirty: value !== current.capturedValue,
      }))
      setResult(null)
    },
    onFocus: () => {
      if (result?.kind !== 'error' || editing.target === field.target) return
      dirtyRef.current = editing.draft !== field.value
      setEditing((current) => ({
        ...current,
        target: field.target,
        capturedValue: field.value,
        dirty: current.draft !== field.value,
      }))
      setResult(null)
    },
    onBlur: commit,
    onKeyDown: (
      event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        cancelBlurRef.current = true
        commitDraft()
        event.currentTarget.blur()
        cancelBlurRef.current = false
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        cancelBlurRef.current = true
        dirtyRef.current = false
        setEditing({
          draft: field.value,
          capturedValue: field.value,
          target: field.target,
          dirty: false,
        })
        setResult(null)
        event.currentTarget.blur()
        cancelBlurRef.current = false
      }
    },
  }

  return (
    <div className="form-field runtime-content-field">
      <label htmlFor={id}>{label}</label>
      {field.metadata?.description && (
        <small id={descriptionId}>{field.metadata.description}</small>
      )}
      {field.metadata?.multiline
        ? <textarea {...common} className="form-textarea" rows={4} />
        : <input {...common} className="form-input" type="text" />}
      {result && (
        <small
          id={resultId}
          role={result.kind === 'error' ? 'alert' : 'status'}
          data-testid={`runtime-content-result-${field.key}`}
        >
          {result.message}
        </small>
      )}
    </div>
  )
}

export function RuntimeContentEditor({
  fields,
  disabled = false,
  onCommit,
}: RuntimeContentEditorProps) {
  if (fields.length === 0) {
    return (
      <p className="property-empty" data-testid="runtime-content-empty">
        该运行时没有登记人工文案
      </p>
    )
  }

  return (
    <div className="runtime-content-editor" data-testid="runtime-content-editor">
      {fields.map((field) => (
        <RuntimeContentField
          key={field.key}
          field={field}
          disabled={disabled}
          onCommit={onCommit}
        />
      ))}
    </div>
  )
}
