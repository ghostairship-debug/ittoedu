import { useEffect, useRef, useState } from 'react'
import type { CompositionLayerItem } from '../../shared/courseProjectTypes'
import type { PublishedCompositionLayerItem } from '../../shared/publishedCourseTypes'
import type { CompositionContentEdit } from '../../core/tools/compositionContent'
import { CompositionContentEditor } from './CompositionContentEditor'
import { WebCompositionAuthoringContent, type WebCompositionAuthoringContentProps } from './WebCompositionAuthoringContent'

export interface CompositionEditorDialogProps {
  item: CompositionLayerItem
  content: PublishedCompositionLayerItem['content']
  assetUrls: Readonly<Record<string, string>>
  projectId?: string
  components?: WebCompositionAuthoringContentProps['components']
  onEdit(edit: CompositionContentEdit): Promise<void>
  onClose(): void
}

/** Focused content view using the exact Player composition mount and canonical edit port. */
export function CompositionEditorDialog({ item, content, assetUrls, projectId, components, onEdit, onClose }: CompositionEditorDialogProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [availableWidth, setAvailableWidth] = useState(item.frame.width)
  const [layoutViewport, setLayoutViewport] = useState<HTMLIFrameElement | null>(null)
  const [pending, setPending] = useState(false)
  const submitting = useRef(false)
  const submit = async (edit: CompositionContentEdit) => {
    if (submitting.current) throw new Error('上一处修改正在保存，请稍后再操作。')
    submitting.current = true; setPending(true)
    try { await onEdit(edit) } finally { submitting.current = false; setPending(false) }
  }
  const viewport = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = viewport.current
    if (!element) return
    const resize = () => setAvailableWidth(Math.max(1, element.clientWidth - 32))
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const scale = Math.min(1, availableWidth / item.frame.width)
  return <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#0008', padding: 24, display: 'flex' }}>
    <section role="dialog" aria-modal="true" aria-label="编辑组合内容" style={{ background: '#fff', color: '#172033', borderRadius: 12, width: '100%', minWidth: 0, display: 'flex', flexDirection: 'column', boxShadow: '0 12px 48px #0005' }}>
      <header style={{ display: 'flex', gap: 16, alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #ddd' }}>
        <strong style={{ flex: 1 }}>编辑组合内容 · {item.label}</strong>
        <button type="button" onClick={onClose}>返回画布</button>
      </header>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 300px', minHeight: 0, flex: 1 }}>
        <div ref={viewport} style={{ overflow: 'auto', background: '#edf0f5', padding: 16 }}>
          <div style={{ width: item.frame.width * scale, height: item.frame.height * scale }}>
            <div style={{ transform: `scale(${scale})`, transformOrigin: '0 0', width: item.frame.width, height: item.frame.height, background: '#fff' }}>
              <WebCompositionAuthoringContent layerItemId={item.layerItemId} content={content} width={item.frame.width} height={item.frame.height}
                assetUrls={assetUrls} projectId={projectId} components={components} selectedNodeId={selectedNodeId ?? undefined}
                onSelection={selection => setSelectedNodeId(selection.nodeId)} onEdit={submit} editingDisabled={pending}
                onLayoutMount={setLayoutViewport} />
            </div>
          </div>
        </div>
        <CompositionContentEditor content={item.content} selectedNodeId={selectedNodeId} onSelect={setSelectedNodeId}
          onEdit={submit} disabled={pending} assetUrls={assetUrls} viewport={layoutViewport} />
      </div>
    </section>
  </div>
}
