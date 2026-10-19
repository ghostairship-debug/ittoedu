import type { ComponentFrame } from '../../../shared/contracts/component-platform'
import type { ContentChangeRequest } from './types'

/** A placement is author input for new roots, never a second geometry owner. */
export function contentPlacementRegion(request: Pick<ContentChangeRequest, 'intent' | 'target' | 'region'>): ComponentFrame | undefined {
  return request.intent === 'insert' || request.intent === 'redo' && request.target.kind === 'container'
    ? request.region : undefined
}
