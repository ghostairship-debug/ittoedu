import { readFileSync } from 'node:fs'
import { transform } from 'lightningcss'
import { describe, expect, it } from 'vitest'

// Selection tools stay in the floating quick bar; available width can now change toolbar density/line count.
describe('course light toolbar row', () => {
  const css = readFileSync('src/renderer/documents/courseEditorChrome.css', 'utf8')
  const rule = (selector: string) => css.split('\n').find(line => line.startsWith(`${selector} {`)) ?? ''

  it('retains a minimum height while allowing width-driven wrapping', () => {
    expect(rule('.course-light-tools')).toMatch(/[{;]\s*min-height:\s*44px/)
    expect(rule('.course-light-tools__row')).toMatch(/flex-wrap:\s*wrap/)
  })

  it('has no selection row left to grow or collapse', () => {
    expect(css).not.toMatch(/course-light-tools__selection/)
  })

  // The production build minifies CSS strictly; jsdom tests never parse it, so a stray brace only failed the build.
  it('keeps the light editing stylesheets valid for the production minifier', () => {
    for (const file of ['src/renderer/documents/courseEditorChrome.css', 'src/renderer/ui/workbenchChrome.css', 'src/renderer/editing/quickbar/quickBar.css',
      'src/renderer/editing/color/colorSwatch.css', 'src/renderer/workbench/selectionContext.css']) {
      expect(() => transform({ filename: file, code: readFileSync(file), minify: true }), file).not.toThrow()
    }
  })
})
