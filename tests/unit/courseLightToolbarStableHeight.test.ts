import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The light toolbar's selection row sits in an auto grid row above the editor.
// If it collapses while empty, the first selection report during a pointer drag
// pushes the editor down mid-drag and CodeMirror maps the rest of the drag to
// another line (S06-T05 Flow source selection after Ctrl+Z).
describe('course light toolbar selection row', () => {
  const css = readFileSync('src/renderer/documents/courseEditorChrome.css', 'utf8')

  it('keeps its height when no selection tools are rendered', () => {
    expect(css).not.toMatch(/\.course-light-tools__selection:empty\s*\{[^}]*display:\s*none/)
    const rules = [...css.matchAll(/\.course-light-tools__selection\s*\{([^}]*)\}/g)].map(match => match[1])
    const minHeight = Math.max(0, ...rules.map(rule => Number(rule.match(/min-height:\s*(\d+(?:\.\d+)?)px/)?.[1] ?? 0)))
    const buttonHeight = Number(css.match(/\.course-light-tools button, \.course-light-tools select\s*\{[^}]*min-height:\s*(\d+)px/)?.[1] ?? NaN)
    expect(buttonHeight).toBeGreaterThan(0)
    expect(minHeight).toBeGreaterThanOrEqual(buttonHeight)
  })

  it('still hides the row outside edit mode', () => {
    expect(css).toMatch(/\.course-light-tools__selection\[hidden\]\s*\{[^}]*display:\s*none/)
  })
})
