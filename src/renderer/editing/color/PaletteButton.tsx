import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ColorSwatchPanel, type ColorSwatchVariant } from './ColorSwatchPanel'

const PANEL_WIDTH = 198

/**
 * A toolbar button that opens the shared palette in a fixed layer, so a scrolling or clipping toolbar host cannot
 * cut it off. Presses keep the document selection; the pick is reported once.
 */
export function PaletteButton({ label, text, value, variant = 'color', onPick }: { label: string; text: string; value?: string | null; variant?: ColorSwatchVariant; onPick(color: string | null): void }) {
  const button = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const place = () => {
    const rect = button.current?.getBoundingClientRect()
    if (rect) setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - PANEL_WIDTH - 8)), top: rect.bottom + 4 })
  }
  const open = position !== null
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && (button.current?.contains(event.target) || panel.current?.contains(event.target))) return
      setPosition(null)
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setPosition(null) }
    window.addEventListener('scroll', place, true); window.addEventListener('resize', place)
    document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place)
      document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escape)
    }
  }, [open])
  return <>
    <button ref={button} type="button" aria-label={label} title={label} aria-expanded={open} aria-haspopup="dialog"
      onMouseDown={event => event.preventDefault()} onClick={() => { if (open) setPosition(null); else place() }}>{text}</button>
    {position && createPortal(<div ref={panel} className="palette-button__panel" role="dialog" aria-label={label} style={{ left: position.left, top: position.top }}>
      <ColorSwatchPanel label={label} value={value} variant={variant} onPick={color => { setPosition(null); onPick(color) }} />
    </div>, document.body)}
  </>
}
