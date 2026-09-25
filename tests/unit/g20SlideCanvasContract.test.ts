import { describe, expect, it } from 'vitest'
import { createBlankCourseProject } from '@/core/course/createCourseProject'
import { courseProjectDocumentSchema } from '@/shared/contracts/course-project-v9/schema'
import { publishedCourseV2Schema } from '@/shared/contracts/published-course-v2/schema'
import { courseSlideCanvas, DEFAULT_SLIDE_CANVAS, isValidSlideCanvas, mismatchedSlideCanvasIndexes, SLIDE_CANVAS_PRESETS, slideCanvasSchema } from '@/shared/slideCanvas'
import { createStageViewportTransform, logicalStageViewport, rotatedRectIntersectsStage } from '@/renderer/authoring/stageViewportTransform'
import { buildPublishedCourseV2Payload } from '@/renderer/export/course/buildPublishedCourse'

const blank = (canvas?: { width: number; height: number }) => createBlankCourseProject({ includeDefaultController: false, controls: 'none', ...(canvas ? { canvas } : {}) })

describe('M19 Slide canvas contract', () => {
  it('accepts every preset and rejects out-of-range or fractional sizes', () => {
    for (const preset of SLIDE_CANVAS_PRESETS) expect(isValidSlideCanvas({ width: preset.width, height: preset.height })).toBe(true)
    expect(slideCanvasSchema.safeParse({ width: 100, height: 720 }).success).toBe(false)
    expect(slideCanvasSchema.safeParse({ width: 1280.5, height: 720 }).success).toBe(false)
    expect(slideCanvasSchema.safeParse({ width: 1280, height: 9000 }).success).toBe(false)
    expect(slideCanvasSchema.safeParse({ width: 1280, height: 720, depth: 1 }).success).toBe(false)
  })

  it('keeps the legacy default and persists a chosen size through the V9 schema', () => {
    expect(courseSlideCanvas(blank())).toEqual({ width: 1280, height: 720 })
    const portrait = blank({ width: 720, height: 1280 })
    expect(courseSlideCanvas(portrait)).toEqual({ width: 720, height: 1280 })
    expect(courseProjectDocumentSchema.parse(portrait).surfaces.find(surface => surface.type === 'slide')).toMatchObject({ canvas: { width: 720, height: 1280 } })
    expect(() => blank({ width: 10, height: 10 })).toThrow(RangeError)
    expect(DEFAULT_SLIDE_CANVAS).toEqual({ width: 1280, height: 720 })
  })

  it('requires one Slide canvas size per course', () => {
    const project = blank({ width: 1024, height: 768 })
    const slide = project.surfaces.find(surface => surface.type === 'slide')!
    const second = { ...structuredClone(slide), id: `${slide.id}:second`, canvas: { width: 1280, height: 720 } }
    project.surfaces.push(second)
    expect(mismatchedSlideCanvasIndexes(project.surfaces)).toEqual([project.surfaces.length - 1])
    const result = courseProjectDocumentSchema.safeParse(project)
    expect(result.success).toBe(false)
    expect(result.error?.issues.some(issue => issue.path.join('.') === `surfaces.${project.surfaces.length - 1}.canvas`
      && issue.message.includes('one canvas size'))).toBe(true)
  })

  it('publishes the course canvas into Published V2', () => {
    const project = blank({ width: 1024, height: 768 })
    const payload = buildPublishedCourseV2Payload({ project, assetFiles: {}, components: {} })
    const published = publishedCourseV2Schema.parse(payload)
    expect(published.surfaces.find(surface => surface.type === 'slide')).toMatchObject({ canvas: { width: 1024, height: 768 } })
  })

  it('fits the course canvas instead of a hard-coded 1280×720 stage', () => {
    const viewport = { x: 0, y: 0, width: 1000, height: 1000 }
    const portrait = createStageViewportTransform({ viewport, stage: { width: 720, height: 1280 } })
    expect(portrait.fitScale).toBeCloseTo(1000 / 1280)
    expect(portrait.stageRect.width).toBeCloseTo(720 * 1000 / 1280)
    expect(portrait.stageRect.height).toBeCloseTo(1000)
    expect(portrait.stage).toEqual({ width: 720, height: 1280 })
    const legacy = createStageViewportTransform({ viewport })
    expect(legacy.stage).toEqual({ width: 1280, height: 720 })
    expect(legacy.fitScale).toBeCloseTo(1000 / 1280)
    expect(logicalStageViewport({ width: 720, height: 1280 })).toEqual({ x: 0, y: 0, width: 720, height: 1280 })
    const rect = { x: 900, y: 100, width: 100, height: 100 }
    expect(rotatedRectIntersectsStage(rect, 0)).toBe(true)
    expect(rotatedRectIntersectsStage(rect, 0, { width: 720, height: 1280 })).toBe(false)
  })
})

it('M19 lets the editor stage and its Phaser canvas follow the course canvas instead of 1280×720', async () => {
  const { readFileSync } = await import('node:fs')
  const css = readFileSync('src/renderer/styles/globals.css', 'utf8')
  // The stack is sized inline from the course canvas; a fixed px box here stretched the hit and selection layer.
  for (const selector of ['.canvas-stage', '.canvas-stage canvas']) {
    const block = css.match(new RegExp(`(?:^|\n)${selector.replace(/[.]/g, '\.')} \{([^}]*)\}`))?.[1]
    expect(block, selector).toBeDefined()
    expect(block, selector).not.toMatch(/(?:width|height):\s*\d+px/)
    expect(block, selector).toMatch(/width:\s*100%/)
    expect(block, selector).toMatch(/height:\s*100%/)
  }
})
