import { useRef } from 'react'

/**
 * Content import asks for a .pptx. The input lives with its owner, not inside a popover,
 * so closing the popover while the system file dialog is open does not lose the choice.
 */
export function usePptxPicker(onPick: (file: File) => void) {
  const input = useRef<HTMLInputElement>(null)
  const latest = useRef(onPick)
  latest.current = onPick
  const element = <input ref={input} type="file" accept=".pptx" hidden aria-label="选择要导入的 PPT"
    onChange={event => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (file) latest.current(file)
    }} />
  return { pick: () => input.current?.click(), element }
}
