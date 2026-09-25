import type { NativeTextContent } from '../../shared/contracts/native-v1'
import { locateTextRunReplacements, planTextRunRemap, type TextRunReplacement } from '../../shared/textRuns'

/** Shared by Native authoring and headless tools; remapping never guesses ambiguous repeated text. */
export function planNativeTextEdit(current: NativeTextContent, input: {
  text?: string
  replacements?: readonly TextRunReplacement[]
  textStyle?: Partial<NativeTextContent['style']>
}) {
  const mapping = input.replacements
    ? locateTextRunReplacements(current.text, current.runs, input.replacements)
    : planTextRunRemap(current.text, input.text ?? current.text, current.runs)
  if (!mapping.ok) return mapping
  const runs = mapping.runs.map(run => ({ ...run, style: Object.fromEntries(Object.entries(run.style)
    .filter(([key]) => !input.textStyle || !Object.hasOwn(input.textStyle, key))) })).filter(run => Object.keys(run.style).length > 0)
  return { ok: true as const, data: { text: mapping.text, runs, ...(input.textStyle ? { style: input.textStyle } : {}) } }
}
