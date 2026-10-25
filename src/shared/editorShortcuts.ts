export type TextFormatShortcut = 'bold' | 'italic' | 'underline'
export type EditorShortcut = 'save' | 'save-as' | 'undo' | 'redo' | 'new' | 'open' | 'select-all' | 'copy' | 'cut' | 'paste' | 'duplicate' | TextFormatShortcut

/** Keyboard aliases only. The focused input/selection owner decides the command. */
export function editorShortcut(input: { key: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean; isComposing?: boolean; keyCode?: number }): EditorShortcut | undefined {
  if (!(input.ctrlKey || input.metaKey) || input.altKey || input.isComposing || input.keyCode === 229) return undefined
  const key = input.key.toLowerCase()
  if (key === 's') return input.shiftKey ? 'save-as' : 'save'
  if (key === 'z') return input.shiftKey ? 'redo' : 'undo'
  if (key === 'y' && !input.shiftKey) return 'redo'
  if (input.shiftKey) return undefined
  return ({ n: 'new', o: 'open', a: 'select-all', c: 'copy', x: 'cut', v: 'paste', d: 'duplicate', b: 'bold', i: 'italic', u: 'underline' } as const)[key as 'n' | 'o' | 'a' | 'c' | 'x' | 'v' | 'd' | 'b' | 'i' | 'u']
}
