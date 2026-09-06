import { createBlankCourseProject } from '../../src/renderer/project/createCourseProject'
import { createChartNode, createTextNode } from '../../src/renderer/project/nativeNodeFactories'
import { sceneNodeToCourseLayerItem } from '../../src/shared/courseProjectModel'

export function contentQaFixture() {
  const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
  const surface = project.surfaces[0]!
  if (surface.type !== 'slide') throw new Error('Slide fixture')
  const scene = surface.scenes[0]!
  const claims = [
    ['qa-math', '公式检查', '公式：frac('],
    ['qa-answer', '答案检查', '答案：错误项'],
    ['qa-chart', '图表检查', '图表：产量 / 一班 / 周一 = 99'],
    ['qa-source', '来源检查', '来源：待补'],
  ] as const
  claims.forEach(([id, name, text], index) => scene.layerItems.push(sceneNodeToCourseLayerItem(createTextNode({ id, name, text, x: 40, y: 40 + index * 145, width: 580, height: 110, style: { fontSize: 24 } }), index)))
  for (const [index, text] of ['正确项', '错误项'].entries()) scene.layerItems.push(sceneNodeToCourseLayerItem(createTextNode({ id: `qa-option-${index}`, text, x: 680, y: 40 + index * 90, width: 450, height: 65 }), scene.layerItems.length))
  scene.layerItems.push(sceneNodeToCourseLayerItem(createChartNode({ id: 'qa-data', x: 680, y: 260, width: 550, height: 350, title: '产量', categories: [{ id: 'monday', label: '周一' }], series: [{ id: 'class', name: '一班', color: '#2563eb', points: [{ id: 'value', categoryId: 'monday', value: 12 }] }] }), scene.layerItems.length))
  project.courseState.push({ key: 'single_choice_qa_correct', valueType: 'boolean', defaultValue: false })
  for (const index of [0, 1]) scene.interactions.push({ id: `qa-rule-${index}`, enabled: true, trigger: { type: 'node.click', nodeId: `qa-option-${index}` }, conditions: [], actions: [
    { id: `qa-set-${index}`, start: 'after-previous', delayMs: 0, action: { type: 'course-state.set', key: 'single_choice_qa_correct', value: index === 0 } },
    { id: `qa-show-${index}`, start: 'after-previous', delayMs: 0, action: { type: 'node.enter', nodeId: `qa-option-${index}`, durationMs: 200, easing: 'linear', effect: 'fade' } },
  ] })
  return project
}
