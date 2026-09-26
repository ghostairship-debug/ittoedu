import { useRef } from 'react'

/**
 * Asks for a .pptx (M21 "从 PPT 新建 H5 演示"). The input lives with its owner, not inside a popover,
 * so closing the popover while the system file dialog is open does not lose the choice.
 */
export function usePptxPicker(onPick: (file: File) => void) {
  const input = useRef<HTMLInputElement>(null)
  const latest = useRef(onPick)
  latest.current = onPick
  const element = <input ref={input} type="file" accept=".pptx" hidden aria-label="选择要新建为 H5 演示的 PPT"
    onChange={event => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (file) latest.current(file)
    }} />
  return { pick: () => input.current?.click(), element }
}
