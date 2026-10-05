import type { CSSProperties } from 'react'
import type { ComponentFrame } from '../../../../shared/contracts/component-platform/frame'

/** Placement only; the mature workspace owns authoring events and chrome. */
export const componentFrameStyle = (frame?: ComponentFrame): CSSProperties => frame ? {
  position: 'absolute', left: 0, top: 0, width: frame.width, height: frame.height,
  transform: `matrix(${frame.transform.join(',')})`, transformOrigin: '0 0',
} : { position: 'relative' }
