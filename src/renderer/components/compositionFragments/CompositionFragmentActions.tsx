import { useState } from 'react'
import { CopyPlus } from 'lucide-react'
import type { CourseProjectDocument } from '../../../shared/courseProjectTypes'
import { compositionLayerIn } from './compositionFragmentPackage'

/** Extraction uses the current selection and existing document/resource transaction (supplied by the Store adapter). */
export function CompositionFragmentActions({ selectedId, project, extract }: {
  selectedId: string | null; project: CourseProjectDocument | null; extract(layerItemId: string, name: string): string | null
}) {
  const layer = selectedId && project ? compositionLayerIn(project, selectedId) : null
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [target, setTarget] = useState<{ projectId: string; layerItemId: string } | null>(null)
  return <div style={{ margin: '10px 0' }}>
    <button type="button" className="component-entry-action" disabled={!layer} data-testid="extract-composition-fragment"
      title={layer ? '保存当前组合的内容、样式、专业节点和互动，供另一份作品复用。' : '在画布上选中组合内容后提取。'}
      onClick={() => { if (project && layer) { setTarget({ projectId: project.id, layerItemId: layer.layerItemId }); setName(layer.label); setEditing(true) } }}>
      <CopyPlus size={20} /><span><strong>提取选中组合为结构资产</strong><small>保留布局与互动，插入后各实例独立编辑</small></span>
    </button>
    {editing && <form style={{ display: 'flex', gap: 6, marginTop: 8 }} onSubmit={event => {
      event.preventDefault()
      if (project && target?.projectId === project.id && extract(target.layerItemId, name)) setEditing(false)
    }}>
      <input aria-label="结构资产名称" required maxLength={100} value={name} onChange={event => setName(event.currentTarget.value)} style={{ flex: 1, minWidth: 0 }} />
      <button type="submit" disabled={!project || target?.projectId !== project.id}>提取</button><button type="button" onClick={() => setEditing(false)}>取消</button>
    </form>}
  </div>
}
