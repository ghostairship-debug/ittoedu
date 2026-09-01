import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { COURSE_PLAYER_CSS } from '@/renderer/export/course/buildCoursePackages'

describe('Flow try-run / export CSS paper hit', () => {
  it('lets the try-run host receive pointers without turning Spatial into a pan world', () => {
    const css = readFileSync('src/renderer/styles/globals.css', 'utf8')
    expect(css).toMatch(/\.flow-try-run-host\s*\{[^}]*pointer-events:\s*auto/)
    expect(COURSE_PLAYER_CSS).toMatch(/\.spatial-surface\{[^}]*touch-action:none/)
  })
  it('documents runtime article scrolling in exported player CSS', () => {
    expect(COURSE_PLAYER_CSS).toMatch(/\.flow-runtime-article\{[^}]*pointer-events:auto/)
    expect(COURSE_PLAYER_CSS).toMatch(/\.flow-runtime-article\{[^}]*overflow:auto/)
    expect(COURSE_PLAYER_CSS).toMatch(/\.flow-runtime-article\{[^}]*background:transparent/)
    expect(COURSE_PLAYER_CSS).toMatch(/\.flow-runtime-layer-plane,[^{]*\{pointer-events:none/)
  })
})
