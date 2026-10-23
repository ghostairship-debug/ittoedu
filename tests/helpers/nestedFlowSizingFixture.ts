import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform/project'
import { createInputData } from '../../src/components/input/data'
import { createTextComponentData } from '../../src/components/text/data'

export function nestedFlowSizingFixture(): CourseProjectV10 {
  const flow = { kind: 'flow' as const, flow: { layout: { readingWidth: 860, wideContentWidth: 1100, widthMode: 'fluid' as const, toc: 'hidden' as const, edgeToEdge: true } } }
  const paragraph = (text: string) => JSON.parse(JSON.stringify(createTextComponentData(text)))
  return { schemaVersion: 11, id: 'nested-flow-sizing', revision: 0, title: '自然高度阅读容器',
    definitions: {
      flow: { id: 'flow', role: 'mixed', implementation: { kind: 'builtin', key: 'guoling.container.flow' } },
      slide: { id: 'slide', role: 'mixed', implementation: { kind: 'builtin', key: 'guoling.container.slide' } },
      spatial: { id: 'spatial', role: 'mixed', implementation: { kind: 'builtin', key: 'guoling.container.spatial' } },
      doc: { id: 'doc', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } },
      input: { id: 'input', role: 'mixed', implementation: { kind: 'builtin', key: 'guoling.input' } },
    },
    instances: {
      root: { id: 'root', definitionId: 'flow', data: {}, childIds: ['child', 'after'], container: flow },
      child: { id: 'child', definitionId: 'flow', name: '随宽重排的阅读区域', data: {}, childIds: ['long', 'input', 'space', 'slide'], container: { ...flow, designSize: { width: 640, height: 20 } } },
      long: { id: 'long', definitionId: 'doc', data: paragraph('父级分配宽度，子级按内容自然占高。'.repeat(120)) },
      input: { id: 'input', definitionId: 'input', data: JSON.parse(JSON.stringify(createInputData({ label: '保持输入' }))), frame: { width: 300, height: 90, transform: [1, 0, 0, 1, 0, 0] } },
      space: { id: 'space', definitionId: 'spatial', data: {}, childIds: [], frame: { width: 300, height: 120, transform: [1, 0, 0, 1, 0, 0] }, container: { kind: 'spatial', spatial: { home: { x: 40, y: 30, zoom: 1 }, frames: [] } } },
      slide: { id: 'slide', definitionId: 'slide', data: {}, childIds: [], frame: { width: 300, height: 100, transform: [1, 0, 0, 1, 0, 0] }, container: { kind: 'slide', designSize: { width: 1200, height: 400 } } },
      after: { id: 'after', definitionId: 'doc', data: paragraph('阅读区域之后的正文，不应重叠。') },
    }, rootIds: ['root'], entry: { rootInstanceId: 'root' }, global: { underlay: [], overlay: [] }, assets: {} }
}
