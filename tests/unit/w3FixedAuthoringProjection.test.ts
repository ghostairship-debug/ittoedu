// @vitest-environment node
import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { componentProjectFiles } from '../../src/core/projectFiles/componentPlatform'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createTextComponentData } from '../../src/components/text/data'
import { flowPaperMaxWidth, resolveFlowBodyWidth } from '../../src/shared/flowBodyPresentation'

it('projects current manual frames into the authored page viewport with stable software anchors', () => {
  const project = createBlankCourseProjectV10('当前作品'), surface = project.surfaces[0]!
  project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  project.instances.text = { id: 'text', definitionId: TEXT_DEFINITION.id, data: createTextComponentData('人工改后的内容') as any,
    frame: { width: 260, height: 70, transform: [1, 0.1, 0.2, 1, 470, 190] } }
  surface.childIds = ['text']; surface.designSize = { width: 1024, height: 768 }
  const file = componentProjectFiles(project, { assets: {}, components: {} }).find(file => file.kind === 'page')!
  expect(file.content).toContain('width:1024px;height:768px')
  expect(file.content).toContain('matrix(1,0.1,0.2,1,470,190)')
  expect(file.content).toContain('id="guoling-object-text"')
  expect(file.content).toContain('人工改后的内容')
  expect(file.projection?.entries).toEqual([{ instanceId: 'text', sourcePath: [0] }])
})

it('keeps reading and wide Flow widths independent of the physical host', () => {
  for (const widthMode of ['reading', 'fluid'] as const) {
    const layout = { widthMode, readingWidth: 860, wideContentWidth: 1100 }
    expect(flowPaperMaxWidth(layout)).toBe(widthMode === 'reading' ? '860px' : '1100px')
    expect(resolveFlowBodyWidth(layout, 320)).toBe(resolveFlowBodyWidth(layout, 1600))
  }
})
