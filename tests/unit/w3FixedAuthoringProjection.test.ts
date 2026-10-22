// @vitest-environment node
import { componentSurfaces } from '../../src/shared/contracts/component-platform/project'
import { testContainerInstance } from '../helpers/glxWorkFixture'
import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { componentProjectFiles } from '../../src/core/projectFiles/componentPlatform'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createTextComponentData } from '../../src/components/text/data'
import { flowPaperMaxWidth, resolveFlowBodyWidth } from '../../src/shared/flowBodyPresentation'

it('projects current manual frames into the authored page viewport with stable software anchors', () => {
  const project = createBlankCourseProjectV10('当前作品'), surface = componentSurfaces(project)[0]!
  project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  project.instances.text = { id: 'text', definitionId: TEXT_DEFINITION.id, data: createTextComponentData('人工改后的内容') as any,
    frame: { width: 260, height: 70, transform: [1, 0.1, 0.2, 1, 470, 190] } }
  testContainerInstance(project, surface.id).childIds = ['text']; testContainerInstance(project, surface.id).container.designSize = { width: 1024, height: 768 }
  const file = componentProjectFiles(project, { assets: {}, components: {} }).find(file => file.kind === 'page')!
  expect(file.content).toContain('width:1024px;height:768px')
  expect(file.content).toContain('matrix(1,0.1,0.2,1,470,190)')
  expect(file.content).toContain('id="guoling-object-text"')
  expect(file.content).toContain('人工改后的内容')
  expect(file.projection?.entries).toEqual([{ instanceId: 'text', sourcePath: [0] }])
})

it('keeps Flow reading caps while allowing the available viewport to reflow the body', () => {
  for (const widthMode of ['reading', 'fluid'] as const) {
    const layout = { widthMode, readingWidth: 860, wideContentWidth: 1100 }
    expect(flowPaperMaxWidth(layout)).toBe(widthMode === 'reading' ? '860px' : '100%')
    expect(resolveFlowBodyWidth(layout, 320)).toBe(248)
    expect(resolveFlowBodyWidth(layout, 1600)).toBe(widthMode === 'reading' ? 788 : 1528)
  }
})
