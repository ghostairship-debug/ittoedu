import { useLayoutEffect, useRef } from 'react'
import {
  fittedPublishedFormulaSize,
  paintPublishedFormula,
  type PublishedFormulaPaintInput,
} from '../../player/surfaces/publishedFormula'

export function PublishedFormulaPaint(
  input: PublishedFormulaPaintInput & {
    readonly lockHeight?: boolean
    readonly pointerEvents?: 'auto' | 'none'
  },
) {
  const hostRef = useRef<HTMLDivElement>(null)
  const height = input.lockHeight ? input.height : fittedPublishedFormulaSize(input).height

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    paintPublishedFormula(host, { ...input, height })
  }, [
    height,
    input.accessibleText,
    input.ast,
    input.formulaId,
    input.height,
    input.lockHeight,
    input.style.align,
    input.style.color,
    input.style.fontSize,
    input.width,
  ])

  return (
    <div
      ref={hostRef}
      data-published-formula-paint={input.formulaId}
      style={{
        width: '100%',
        height,
        maxWidth: '100%',
        overflow: 'hidden',
        pointerEvents: input.pointerEvents,
      }}
    />
  )
}
