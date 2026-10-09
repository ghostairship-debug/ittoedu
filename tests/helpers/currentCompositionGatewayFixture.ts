import { randomUUID } from 'node:crypto'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { createTextComponentData } from '../../src/components/text/data'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { WEB_DEFINITION, HTML_PROGRAM_DEFINITION } from '../../src/components/web/data'
import { IMAGE_DEFINITION, createImageData } from '../../src/components/image'
import { CHART_DEFINITION, createChartData } from '../../src/components/chart'
import type { ComponentAuthorRecord, ComponentDefinition, ComponentFrame, JsonValue } from '../../src/shared/contracts/component-platform'
import type { DocumentModel } from '../../src/shared/workbench/document'
import type { ToolTarget } from '../../src/shared/workbench/tools'

export const currentFragmentPrompt = '先预测数据变化，再操作并观察图表。'
export const compositionSourceCss = '.card{padding:20px;color:#20334b}.columns{display:grid;grid-template-columns:1fr 1fr;gap:18px}@media(max-width:600px){.columns{grid-template-columns:1fr}}'
export const compositionParagraphHtml = `<section class="card" id="left"><p id="paragraph" style="line-height:1.6">${currentFragmentPrompt}</p></section>`
export const compositionPictureHtml = '<section class="card"><img id="picture" src="cw-resource:photo" alt="资源闭包示例" style="object-fit:cover;border-radius:9px"></section>'
export const compositionProgramHtml = '<!doctype html><html><body><button id="counter">count:0</button><script>window.counterCreates=(window.counterCreates||0)+1;let count=0;document.getElementById("counter").onclick=()=>document.getElementById("counter").textContent="count:"+(++count);</script></body></html>'
const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value))
const frame = (x: number, y: number, width: number, height: number): ComponentFrame => ({ width, height, transform: [1, 0, 0, 1, x, y] })

/** Current free objects own subtree authority; retained Web content owns its exact DOM author fields. */
export function currentCompositionGatewayFixture(options: { professionalText?: boolean } = {}) {
  const project = createBlankCourseProjectV10('结构内容课件', randomUUID)
  project.global = { underlay: [], overlay: [] }; project.instances = {}; project.definitions = {}
  const group: ComponentDefinition = { id: 'guoling.group', role: 'content', implementation: { kind: 'builtin', key: 'guoling.group' }, title: '编组' }
  for (const definition of [group, WEB_DEFINITION, HTML_PROGRAM_DEFINITION, IMAGE_DEFINITION, CHART_DEFINITION, TEXT_DEFINITION]) project.definitions[definition.id] = structuredClone(definition)
  project.surfaces = [{ id: 'slide', kind: 'slide', title: '观察与解释', childIds: ['quality-composition'], designSize: { width: 800, height: 1100 } }]
  const textRecord: ComponentAuthorRecord = { kind: 'text', binding: { kind: 'dom', path: [
    { tag: 'section', index: 0, attributes: { id: 'left' } }, { tag: 'p', index: 0, attributes: { id: 'paragraph' } },
  ], textIndex: 0, baseline: currentFragmentPrompt }, overrides: { text: currentFragmentPrompt } }
  const imageRecord: ComponentAuthorRecord = { kind: 'image', binding: { kind: 'dom', path: [
    { tag: 'section', index: 0 }, { tag: 'img', index: 0, attributes: { id: 'picture' } },
  ], baseline: 'cw-resource:photo' }, overrides: { src: 'cw-resource:photo' } }
  const insert = (id: string, definitionId: string, data: unknown, box: ComponentFrame, childIds?: string[]) => {
    project.instances[id] = { id, name: id, definitionId, data: json(data), frame: box, ...(childIds ? { childIds } : {}) }
  }
  insert('quality-composition', group.id, {}, frame(0, 0, 800, 900), ['heading', 'left', 'right'])
  insert('heading', TEXT_DEFINITION.id, createTextComponentData('用观察解释变化'), frame(20, 20, 760, 60))
  insert('left', group.id, {}, frame(20, 100, 370, 700), ['paragraph', 'picture', 'interaction'])
  insert('right', group.id, {}, frame(410, 100, 370, 700), ['chart', 'shared-picture', 'native-picture'])
  insert('paragraph', options.professionalText ? TEXT_DEFINITION.id : WEB_DEFINITION.id,
    options.professionalText ? createTextComponentData(currentFragmentPrompt) : { html: compositionParagraphHtml, css: compositionSourceCss, authoringRecords: { paragraph: textRecord } }, frame(0, 0, 330, 100))
  insert('picture', WEB_DEFINITION.id, { html: compositionPictureHtml, css: compositionSourceCss, authoringRecords: { picture: imageRecord }, resourceBindings: { photo: 'source-photo' } }, frame(0, 120, 100, 100))
  insert('interaction', HTML_PROGRAM_DEFINITION.id, { html: compositionProgramHtml }, frame(0, 240, 330, 100))
  insert('chart', CHART_DEFINITION.id, createChartData(), frame(0, 0, 330, 300))
  insert('shared-picture', IMAGE_DEFINITION.id, createImageData('source-photo', '未选共享图片'), frame(0, 320, 100, 100))
  const nativeData = createImageData('source-photo', '原生图片'); nativeData.fit = 'cover'; nativeData.cornerRadius = 13; nativeData.flipX = true
  insert('native-picture', IMAGE_DEFINITION.id, nativeData, frame(120, 320, 100, 100))
  const bytes = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5GQAAAAASUVORK5CYII=', 'base64'))
  project.assets['source-photo'] = { id: 'source-photo', path: 'assets/source-photo.png', mimeType: 'image/png', kind: 'image', filename: 'source-photo.png', byteLength: bytes.byteLength, width: 1, height: 1 }
  const resources = { assets: { 'source-photo': bytes }, components: {} }
  const model: Extract<DocumentModel, { kind: 'course-v10' }> = { kind: 'course-v10', project, resources }
  const instanceTarget = (instanceId: string): Extract<ToolTarget, { kind: 'course-instance' }> => ({ kind: 'course-instance', surfaceId: 'slide', instanceId })
  const textTarget = { ...instanceTarget('paragraph'), dataPath: options.professionalText ? ['content'] : ['authoringRecords', 'paragraph', 'overrides', 'text'] }
  const imageTarget = { ...instanceTarget('picture'), dataPath: ['authoringRecords', 'picture', 'overrides', 'src'] }
  return { model, project, resources, target: instanceTarget('quality-composition'), selection: instanceTarget('left'), textTarget, imageTarget, instanceTarget, textRecord, imageRecord }
}

export function currentCompositionProject(model: DocumentModel) {
  if (model.kind !== 'course-v10') throw new Error('Current V10 course required')
  return model.project
}
export function currentCompositionText(model: DocumentModel): string {
  const data = currentCompositionProject(model).instances.paragraph.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Paragraph data required')
  const records = data.authoringRecords as unknown as Record<string, ComponentAuthorRecord>
  return records.paragraph.overrides.text ?? records.paragraph.binding.baseline
}
