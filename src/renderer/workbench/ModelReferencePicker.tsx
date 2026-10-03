import { useMemo, useState } from 'react'
import type { ModelKnowledgeEntry } from '../../shared/workbench/modelKnowledge'

export const modelKnowledgeKey = (entry: ModelKnowledgeEntry) => entry.provider ? `${entry.provider}/${entry.id}` : entry.id

export function ModelReferencePicker({ models, value, label = '参考型号', disabled, onChange }: {
  models: ModelKnowledgeEntry[]; value: string; label?: string; disabled?: boolean; onChange(value: string): void
}) {
  const [query, setQuery] = useState('')
  const groups = useMemo(() => {
    const result = new Map<string, ModelKnowledgeEntry[]>()
    const search = query.trim().toLowerCase()
    for (const entry of models) {
      if (search && !`${entry.provider} ${entry.id} ${entry.name}`.toLowerCase().includes(search) && modelKnowledgeKey(entry) !== value) continue
      const provider = entry.provider ?? '其他来源'
      const list = result.get(provider) ?? []
      list.push(entry); result.set(provider, list)
    }
    return [...result.entries()]
  }, [models, value, query])
  return <div className="execution-assistant__model-reference">
    <input aria-label={`搜索${label}`} placeholder="搜索厂商或型号" value={query} disabled={disabled} onChange={event => setQuery(event.target.value)} />
    <label>{label}<select aria-label={label} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>
      <option value="">自动识别</option>
      {value && !models.some(entry => modelKnowledgeKey(entry) === value) && <option value={value}>{value}（已存选择）</option>}
      {groups.map(([provider, entries]) => <optgroup key={provider} label={provider}>
        {entries.map(entry => <option key={modelKnowledgeKey(entry)} value={modelKnowledgeKey(entry)}>
          {entry.name ?? entry.id}{entry.name && entry.name !== entry.id ? ` · ${entry.id}` : ''}
        </option>)}
      </optgroup>)}
    </select></label>
  </div>
}
