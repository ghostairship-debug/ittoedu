import type { CourseGlobalPropertiesContext } from './CourseGlobalPropertiesPanel'
import type { EmptyScenePropertiesContext } from './EmptyScenePropertiesPanel'
import type { FlowPropertiesContext } from './FlowPropertiesPanel'
import type { MultiSelectionPropertiesContext } from './MultiSelectionPropertiesPanel'
import type { SlideNativePropertiesContext } from './SlideNativePropertiesPanel'
import type { SpatialPropertiesContext } from './SpatialPropertiesPanel'

export type PropertiesContext =
  | FlowPropertiesContext
  | SpatialPropertiesContext
  | SlideNativePropertiesContext
  | CourseGlobalPropertiesContext
  | MultiSelectionPropertiesContext
  | EmptyScenePropertiesContext
  | { readonly kind: 'empty-surface' }
  | { readonly kind: 'stale-target'; readonly reason: string }
