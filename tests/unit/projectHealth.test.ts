import { describe, expect, it } from 'vitest'
import { collectCourseProjectHealth } from '../../src/shared/courseProjectHealth'
import { createBlankCourseProject } from '../../src/renderer/project/createCourseProject'

/**
 * V8 `collectProjectHealth` still requires a ProjectDocument. This wave does
 * not invent a V8 factory; V9 health coverage lives in courseProjectHealth.test.ts.
 */
describe('工程健康检查', () => {
  it('product health collector is the V9 Course Project path', () => {
    const project = createBlankCourseProject({
      includeDefaultController: false,
      controls: 'none',
    })
    expect(collectCourseProjectHealth(project, {
      assetFiles: {},
      componentFiles: {},
    }).some((item) => item.code === 'controller-required-for-canvas')).toBe(false)
  })
})
