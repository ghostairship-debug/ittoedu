import { useEffect, useState } from 'react'

export const QUICK_BAR_SELECTOR = '[data-selection-quick-bar]'

/**
 * True while a pointer that went down inside `root` is held: dragging or resizing an object hides the quick bar,
 * which comes back where the selection ends up after release. Presses on the quick bar itself do not count.
 */
export function usePointerGesture(root: HTMLElement | null | undefined): boolean {
  const [active, setActive] = useState(false)
  useEffect(() => {
    if (!root) return
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return
      if (event.target instanceof Element && event.target.closest(QUICK_BAR_SELECTOR)) return
      setActive(true)
    }
    const up = () => setActive(false)
    root.addEventListener('pointerdown', down, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', up, true)
    window.addEventListener('blur', up)
    return () => {
      root.removeEventListener('pointerdown', down, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', up, true)
      window.removeEventListener('blur', up)
      setActive(false)
    }
  }, [root])
  return active
}
