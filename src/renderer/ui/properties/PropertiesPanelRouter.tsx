import { Layers3 } from 'lucide-react'
import { CourseGlobalPropertiesPanel } from './CourseGlobalPropertiesPanel'
import { EmptyScenePropertiesPanel } from './EmptyScenePropertiesPanel'
import { FlowPropertiesPanel } from './FlowPropertiesPanel'
import { MultiSelectionPropertiesPanel } from './MultiSelectionPropertiesPanel'
import type { PropertiesContext } from './PropertiesContext'
import { SlideNativePropertiesPanel } from './SlideNativePropertiesPanel'
import { SpatialPropertiesPanel } from './SpatialPropertiesPanel'

export function PropertiesPanelRouter({ context }: { context: PropertiesContext }) {
  switch (context.kind) {
    case 'flow-block':
    case 'flow-overlay':
    case 'flow-page':
      return <FlowPropertiesPanel context={context} />
    case 'spatial-page':
    case 'spatial-graph':
      return <SpatialPropertiesPanel context={context} />
    case 'multi-selection':
      return <MultiSelectionPropertiesPanel context={context} />
    case 'stale-target':
      return (
        <div className="properties-scroll" data-testid="properties-tab">
          <p className="property-empty" role="status">{context.reason}</p>
        </div>
      )
    case 'empty-surface':
      return (
        <div className="properties-scroll" data-testid="properties-tab">
          <section className="property-section" data-testid="slide-surface-properties-context" role="status">
            <h3 className="property-title"><Layers3 size={14} />表面共享层</h3>
            <p className="property-hint">此范围的元素由同一 Slide 表面的所有场景共享；请选择一个表面图层后编辑其基础值。</p>
          </section>
        </div>
      )
    case 'empty-scene':
      return <EmptyScenePropertiesPanel context={context} />
    case 'course-global':
      return <CourseGlobalPropertiesPanel context={context} />
    case 'slide-native':
      return (
        <div className="properties-scroll" data-testid="properties-tab">
          <SlideNativePropertiesPanel context={context} />
        </div>
      )
  }
}
