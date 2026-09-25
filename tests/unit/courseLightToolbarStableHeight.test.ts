import { readFileSync } from 'node:fs'
import { transform } from 'lightningcss'
import { describe, expect, it } from 'vitest'

// The light toolbar sits in an auto grid row above the editor. Any height change during a selection (for example
// a wrapping row of selection tools) re-fits the canvas under the pointer; M21 keeps one fixed row and moves
// selection tools into the floating quick bar (S06-T05, M21-T01).
describe('course light toolbar row', () => {
  const css = readFileSync('src/renderer/documents/courseEditorChrome.css', 'utf8')
  const rule = (selector: string) => css.split('\n').find(line => line.startsWith(`${selector} {`)) ?? ''

  it('has a fixed height and never wraps', () => {
    expect(rule('.course-light-tools')).toMatch(/[{;]\s*height:\s*44px/)
    expect(rule('.course-light-tools__row')).toMatch(/flex-wrap:\s*nowrap/)
  })

  it('has no selection row left to grow or collapse', () => {
    expect(css).not.toMatch(/course-light-tools__selection/)
    expect(css).not.toMatch(/\.course-light-tools[^{]*\{[^}]*flex-wrap:\s*wrap/)
  })

  // The production build minifies CSS strictly; jsdom tests never parse it, so a stray brace only failed the build.
  it('keeps the light editing stylesheets valid for the production minifier', () => {
    for (const file of ['src/renderer/documents/courseEditorChrome.css', 'src/renderer/editing/quickbar/quickBar.css',
      'src/renderer/editing/color/colorSwatch.css', 'src/renderer/workbench/selectionContext.css']) {
      expect(() => transform({ filename: file, code: readFileSync(file), minify: true }), file).not.toThrow()
    }
  })
})
