import type { ComponentBackground } from '../../shared/contracts/component-platform/project'
import { componentBackgroundPaintStyles } from '../../shared/componentBackgroundPaint'

/** A background paints below the host's existing content and has no author identity. */
export function ComponentBackgroundPaint({ background, resolveAsset }: {
  background: ComponentBackground
  resolveAsset(id: string): string | undefined
}) {
  return <div data-component-background-paint="" aria-hidden="true"
    style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: -1 }}>
    {componentBackgroundPaintStyles(background, resolveAsset).map((style, index) => <div key={index}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', ...style }} />)}
  </div>
}
