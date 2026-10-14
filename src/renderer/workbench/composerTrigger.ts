export interface ComposerTrigger { kind: '/' | '@'; from: number; to: number; query: string }
/** A leading/word-boundary trigger, never an email address or URL fragment. */
export function composerTrigger(text: string, caret: number): ComposerTrigger | null {
  const before = text.slice(0, caret)
  const match = /(?:^|[\s（(])([/@])([^\s@]*)$/.exec(before)
  if (!match || match[1] === '/' && match[2].includes('/')) return null
  const from = caret - match[2].length - 1
  return { kind: match[1] as '/' | '@', from, to: caret, query: match[2] }
}
export function replaceComposerTrigger(text: string, trigger: ComposerTrigger, insertion: string) {
  return { text: text.slice(0, trigger.from) + insertion + text.slice(trigger.to), caret: trigger.from + insertion.length }
}
