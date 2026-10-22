import type { CourseGlobalPropertiesContext } from './CourseGlobalPropertiesPanel'
import type { EmptyScenePropertiesContext } from './EmptyScenePropertiesPanel'
import type { FlowPropertiesContext } from './FlowPropertiesPanel'
import type { MultiSelectionPropertiesContext } from './MultiSelectionPropertiesPanel'
import type { SlideNativePropertiesContext } from './SlideNativePropertiesPanel'
import type { SpatialPropertiesContext } from './SpatialPropertiesPanel'
import type { AuthorFieldPropertiesContext } from './AuthorFieldPropertiesPanel'

export type PropertiesContext =
  | AuthorFieldPropertiesContext
  | FlowPropertiesContext
  | SpatialPropertiesContext
  | SlideNativePropertiesContext
  | CourseGlobalPropertiesContext
  | MultiSelectionPropertiesContext
  | EmptyScenePropertiesContext
  | { readonly kind: 'empty-surface' }
  | { readonly kind: 'stale-target'; readonly reason: string }
