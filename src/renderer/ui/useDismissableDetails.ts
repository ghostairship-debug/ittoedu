import { useEffect, type RefObject } from 'react'

/** Closes an open `<details>` menu when the pointer goes down outside it or Escape is pressed. */
export function useDismissableDetails(ref: RefObject<HTMLDetailsElement | null>): void {
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const details = ref.current
      if (details?.open && !(event.target instanceof Node && details.contains(event.target))) details.open = false
    }
    const escape = (event: KeyboardEvent) => {
      const details = ref.current
      if (details?.open && event.key === 'Escape' && !event.isComposing) details.open = false
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', escape, true)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('keydown', escape, true)
    }
  }, [ref])
}
