import { useRef, type MouseEvent } from 'react'
import { ChevronDown } from 'lucide-react'
import { useDismissableDetails } from '../ui/useDismissableDetails'

export interface ReferenceScopeOption<Id extends string> {
  id: Id
  label: string
  available: boolean
}

export function ReferenceFilename({ name, path }: { name: string; path?: string }) {
  const dot = name.lastIndexOf('.')
  const hasExtension = dot > 0 && name.length - dot <= 9
  const stem = Array.from(hasExtension ? name.slice(0, dot) : name)
  const tailLength = stem.length > 14 ? 5 : 0
  const head = tailLength ? stem.slice(0, -tailLength).join('') : stem.join('')
  const tail = (tailLength ? stem.slice(-tailLength).join('') : '') + (hasExtension ? name.slice(dot) : '')
  return <span className="execution-assistant__chip-label" title={path ?? name} aria-label={name}>
    <span>{head}</span>{tail && <span>{tail}</span>}
  </span>
}

export function ReferenceScopePicker<Id extends string>({ name, path, label, location, options, disabled, onSelect }: {
  name: string
  path?: string
  label: string
  location?: string
  options: readonly ReferenceScopeOption<Id>[]
  disabled: boolean
  onSelect(id: Id): void
}) {
  const details = useRef<HTMLDetailsElement>(null)
  useDismissableDetails(details)
  const position = (event: MouseEvent<HTMLElement>) => {
    if (disabled) { event.preventDefault(); return }
    const rect = event.currentTarget.getBoundingClientRect()
    details.current?.style.setProperty('--reference-popup-left', `${Math.max(8, Math.min(rect.left, window.innerWidth - 288))}px`)
    details.current?.style.setProperty('--reference-popup-bottom', `${Math.max(8, window.innerHeight - rect.top + 6)}px`)
  }
  return <details className="execution-assistant__chip-scope" ref={details}>
    <summary aria-label={`切换引用范围：${name}，${label}`} aria-disabled={disabled} onClick={position}>
      <span>{label}</span><ChevronDown size={12} aria-hidden="true" />
    </summary>
    <div className="execution-assistant__popup execution-assistant__scope-popup" aria-label="引用范围">
      <header>
        <strong>{name}</strong>
        {path && path !== name && <small>{path}</small>}
        <span>已引用：{location ?? label}</span>
      </header>
      {options.map(option => <button key={option.id} type="button" disabled={disabled || !option.available} onClick={() => {
        if (details.current) details.current.open = false
        onSelect(option.id)
      }}>{option.label}</button>)}
    </div>
  </details>
}
