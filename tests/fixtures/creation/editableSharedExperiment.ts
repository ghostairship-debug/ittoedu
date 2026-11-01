import { createBlankCourseProjectV10 } from '../../../src/core/course/createCourseProjectV10'
import { CourseV10Driver } from '../../../src/core/drivers/CourseV10Driver'
import { captureComponentOperation } from '../../../src/core/drivers/courseV10Operations'
import { componentAuthorEnhancementEdits } from '../../../src/core/components/source/componentAuthorSource'
import { loadBuiltinComponentSource } from '../../../src/core/components/source/builtinSources'
import { createTextComponentData } from '../../../src/components/text/data'
import { createImageData } from '../../../src/components/image/data'
import { WEB_DEFINITION } from '../../../src/components/web/data'
import { createComponentContainerInstance, type ComponentImplementation, type JsonObject } from '../../../src/shared/contracts/component-platform/project'
import type { ComponentFrame } from '../../../src/shared/contracts/component-platform'
import type { DocumentModel } from '../../../src/shared/workbench/document'

/** The sample and the real editor/Player consumer use this one author model. */
export const SHARED_EXPERIMENT = {
  projectId: 'editable-shared-experiment-20261031',
  experimentScene: 'mixing-scene', resultScene: 'conclusion-scene',
  title: 'experiment-title', description: 'experiment-description', image: 'experiment-image',
  experiment: 'mixing-experiment', result: 'shared-conclusion',
  modelDefinition: 'mixing-model', imageAsset: 'mixing-diagram',
  completionKey: 'mixing.complete', inputKey: 'mixing.input', resultKey: 'mixing.result',
} as const

/** One editable business module, referenced by both enhancements. This is a
 * deliberately simplified comparison model, not a measured energy-flux model. */
export const MIXING_MODEL_SOURCE = `
export const model = Object.freeze({
  initialMixPercent: 35,
  energyScale: 100,
  inputKey: ${JSON.stringify(SHARED_EXPERIMENT.inputKey)},
  resultKey: ${JSON.stringify(SHARED_EXPERIMENT.resultKey)},
  experimentScene: ${JSON.stringify(SHARED_EXPERIMENT.experimentScene)},
});
export function evaluateMix(mixPercent, trial) {
  const value = Number(mixPercent);
  const bounded = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : model.initialMixPercent;
  const fraction = bounded / 100;
  return { mixPercent: bounded, energyIndex: Math.round(4 * fraction * (1 - fraction) * model.energyScale), trial };
}
export function describeResult(result) {
  return result ? '海水比例 ' + result.mixPercent + '% · 能量比较指数 ' + result.energyIndex
    : '先在第一幕调整比例，再运行一次实验。';
}
`

const experimentEnhancement = `
import { model, evaluateMix, describeResult } from './model';
export default ({ root, scope, listen, observe, bindings, teacherController }) => {
  const input = root.querySelector('[data-mix]');
  const readInput = () => scope.state.get(model.inputKey) ?? model.initialMixPercent;
  const paintInput = value => {
    input.value = String(value ?? model.initialMixPercent);
    root.querySelector('[data-mix-label]').textContent = input.value + '%';
  };
  paintInput(readInput());
  observe(model.inputKey, paintInput);
  observe(model.resultKey, result => { root.querySelector('[data-result]').textContent = describeResult(result); });
  bindings.observe('complete', complete => {
    root.querySelector('[data-next]').disabled = !complete;
    root.querySelector('[data-status]').textContent = complete ? '实验已完成 · 相邻结论已解锁' : '运行一次实验后解锁相邻结论';
  });
  listen('input', '[data-mix]', (_event, element) => scope.state.set(model.inputKey, Number(element.value)));
  listen('click', '[data-run]', () => {
    const previous = scope.state.get(model.resultKey);
    scope.state.set(model.resultKey, evaluateMix(readInput(), Number(previous?.trial ?? 0) + 1));
    bindings.set('complete', true);
  });
  const reset = () => {
    scope.state.set(model.inputKey, model.initialMixPercent);
    scope.state.set(model.resultKey, null);
    bindings.set('complete', false);
  };
  scope.events.subscribe('__runtime.scene.reset', sceneId => { if (sceneId === model.experimentScene) reset(); });
  listen('click', '[data-next]', () => teacherController?.execute({ type: 'scene.next' }, scope.signal));
  listen('click', '[data-replay]', () => teacherController?.execute({ type: 'scene.replay' }, scope.signal));
};
`

const resultEnhancement = `
import { model, describeResult } from './model';
export default ({ root, scope, listen, observe, bindings, teacherController }) => {
  observe(model.resultKey, result => {
    root.querySelector('[data-result]').textContent = describeResult(result);
    root.querySelector('[data-energy]').textContent = result ? String(result.energyIndex) : '—';
    root.querySelector('[data-trial]').textContent = result ? '第 ' + result.trial + ' 次实验的真实结果' : '等待第一幕的结果';
  });
  bindings.observe('complete', complete => { root.querySelector('[data-status]').textContent = complete ? '与第一幕共享同一结果' : '第一幕尚未完成'; });
  listen('click', '[data-back]', () => teacherController?.execute({ type: 'scene.previous' }, scope.signal));
};
`

const panelCss = `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; font: 17px/1.5 "Microsoft YaHei", sans-serif; color: #eff9f6; }
.panel { width: 100%; min-height: 100%; padding: 20px 28px; background: #133345; border: 1px solid #2b6272; border-radius: 20px; }
h2 { font-size: 22px; margin: 0 0 8px; font-weight: 700; }
p { margin: 6px 0; }
label { display: flex; align-items: center; justify-content: space-between; }
input[type=range] { display: block; width: 100%; margin: 10px 0 12px; accent-color: #7be0c4; }
.actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 16px; }
button { border: 1px solid #72d3b8; background: #163e4a; color: #eff9f6; padding: 10px 18px; border-radius: 12px; font: inherit; cursor: pointer; }
button.primary { color: #09272d; background: #7be0c4; font-weight: 700; }
button:disabled { opacity: .46; cursor: default; }
[data-status], [data-trial] { color: #b7d8d7; font-size: 15px; }
[data-result] { display: block; min-height: 26px; }
[data-energy] { display: block; color: #7be0c4; font-size: 76px; line-height: 1.15; font-weight: 700; }
`

/** Authored vector illustration; visibly labelled as a schematic in the work. */
export const MIXING_DIAGRAM_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="340" viewBox="0 0 560 340">
<rect width="560" height="340" rx="22" fill="#103145"/>
<path d="M0 300L115 256L190 286L252 214L298 282L382 253L560 295V340H0Z" fill="#245061"/>
<path d="M223 288L241 197L266 197L282 288Z" fill="#758a85"/>
<path d="M250 188C202 150 295 130 250 83" stroke="#efb767" stroke-width="30" stroke-linecap="round" fill="none" opacity=".8"/>
<path d="M440 103C394 97 354 121 317 159" stroke="#78cce6" stroke-width="13" fill="none"/>
<path d="M320 134L306 171L344 161" fill="none" stroke="#78cce6" stroke-width="11"/>
<ellipse cx="282" cy="168" rx="83" ry="44" stroke="#7be0c4" stroke-width="3" stroke-dasharray="7 6" fill="none"/>
<g font-family="sans-serif" font-size="23" fill="#eff9f6"><text x="54" y="64">混合带示意</text><text x="386" y="74">海水</text><text x="113" y="198">热液</text></g>
<text x="32" y="320" font-family="sans-serif" font-size="16" fill="#b7d8d7">教学示意 · 非实地照片 · 比例不代表实际尺度</text></svg>`

const frame = (x: number, y: number, width: number, height: number): ComponentFrame => ({ width, height, transform: [1, 0, 0, 1, x, y] })
const data = (value: unknown): JsonObject => JSON.parse(JSON.stringify(value)) as JsonObject
const source = (value: string): Extract<ComponentImplementation, { kind: 'source' }> => ({ kind: 'source', language: 'javascript', source: value })

export async function createEditableSharedExperiment(): Promise<Extract<DocumentModel, { kind: 'course-v10' }>> {
  await loadBuiltinComponentSource('guoling.web')
  const ids = [SHARED_EXPERIMENT.projectId, SHARED_EXPERIMENT.experimentScene]
  const project = createBlankCourseProjectV10('无光绿洲 · 可编辑共享实验样本', () => ids.shift()!)
  const definitionId = project.instances[SHARED_EXPERIMENT.experimentScene]!.definitionId
  project.rootIds.push(SHARED_EXPERIMENT.resultScene)
  project.instances[SHARED_EXPERIMENT.experimentScene]!.name = '01 混合实验'
  project.instances[SHARED_EXPERIMENT.resultScene] = createComponentContainerInstance({
    id: SHARED_EXPERIMENT.resultScene, title: '02 相邻结论', kind: 'slide', childIds: [], designSize: { width: 1280, height: 720 },
  }, definitionId)
  project.background = { color: '#081e2b' }
  project.theme = { css: ':root{--experiment-accent:#7be0c4;--experiment-ink:#eff9f6;} .courseware-sample-footer{letter-spacing:.04em;}' }
  project.playback = { controls: 'none', keyboardNavigation: true,
    presenter: { enabled: true, strategy: 'scene-navigation', additionalBindings: [] } }
  project.logic = { courseState: [{ key: SHARED_EXPERIMENT.completionKey, valueType: 'boolean', defaultValue: false }],
    navigationGuards: [{ id: 'complete-experiment-first', effect: 'block', toSurfaceIds: [SHARED_EXPERIMENT.resultScene], match: 'all',
      conditions: [{ type: 'compare', key: SHARED_EXPERIMENT.completionKey, operator: 'eq', value: false }], message: '先在第一幕运行一次实验。' }] }
  project.definitions.text = { id: 'text', title: '原生文字', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } }
  project.definitions.image = { id: 'image', title: '原生图片', role: 'content', implementation: { kind: 'builtin', key: 'guoling.image' } }
  project.definitions[WEB_DEFINITION.id] = WEB_DEFINITION
  project.definitions[SHARED_EXPERIMENT.modelDefinition] = { id: SHARED_EXPERIMENT.modelDefinition, title: '共享实验参数与结果结构', role: 'behavior', implementation: source(MIXING_MODEL_SOURCE) }
  const text = (id: string, content: string, placement: ComponentFrame, fontSize: number, color = '#eff9f6', bold = false) => {
    const value = createTextComponentData(content)
    Object.assign(value.appearance, { fontFamily: '"Microsoft YaHei", sans-serif', fontSize, color, bold, lineHeight: 1.4 })
    value.sizing.mode = 'fixed'
    project.instances[id] = { id, definitionId: 'text', name: content.slice(0, 24), data: data(value), frame: placement }
  }
  text(SHARED_EXPERIMENT.title, '无光绿洲：混合与能量', frame(48, 48, 1160, 62), 40, '#eff9f6', true)
  text(SHARED_EXPERIMENT.description, '调整海水比例，运行一次实验；相邻一幕将读取这次真实结果。标题、说明、配图和位置都可以直接接手编辑。', frame(48, 126, 1140, 76), 23, '#b7d8d7')
  text('result-title', '把第一幕的结果带到这里', frame(48, 48, 1160, 62), 40, '#eff9f6', true)
  text('result-description', '这一幕没有复制实验参数或重新计算结果。返回会保留本轮记录；重播第一幕会清除本轮结果，并重新锁定相邻结论。', frame(48, 126, 1140, 76), 23, '#b7d8d7')
  text('model-note', '简化教学模型：比较指数用于比较方案，不代表实测能量通量。', frame(48, 620, 1136, 30), 20, '#efc58a')
  text('sample-footer', '双幕共享实验  /  原生内容可编辑  /  单一运行状态', frame(48, 665, 1160, 30), 16, '#88b4bc')
  project.global.overlay = ['model-note', 'sample-footer']
  const diagram = new TextEncoder().encode(MIXING_DIAGRAM_SVG)
  project.assets[SHARED_EXPERIMENT.imageAsset] = { id: SHARED_EXPERIMENT.imageAsset, path: 'assets/mixing-diagram.svg', kind: 'image',
    filename: 'mixing-diagram.svg', mimeType: 'image/svg+xml', byteLength: diagram.byteLength, width: 560, height: 340 }
  for (const id of [SHARED_EXPERIMENT.image, 'result-image']) project.instances[id] = { id, definitionId: 'image', name: '可替换教学示意图',
    data: data(createImageData(SHARED_EXPERIMENT.imageAsset, '海水与热液混合带教学示意，非实地照片')), frame: frame(48, 246, 448, 300) }
  project.instances[SHARED_EXPERIMENT.experiment] = { id: SHARED_EXPERIMENT.experiment, definitionId: WEB_DEFINITION.id,
    name: '局部混合实验', frame: frame(548, 232, 684, 370), stateBindings: { complete: SHARED_EXPERIMENT.completionKey },
    data: { html: '<section class="panel"><h2>试一试：海水比例</h2><label for="mix">海水比例 <output data-mix-label></output></label><input id="mix" data-mix type="range" min="0" max="100" step="1" aria-label="海水比例"><output data-result></output><p data-status></p><div class="actions"><button class="primary" data-run>运行实验</button><button data-next disabled>查看相邻结论</button><button data-replay>重播本幕</button></div></section>', css: panelCss } }
  project.instances[SHARED_EXPERIMENT.result] = { id: SHARED_EXPERIMENT.result, definitionId: WEB_DEFINITION.id,
    name: '共享实验结果', frame: frame(548, 232, 684, 370), stateBindings: { complete: SHARED_EXPERIMENT.completionKey },
    data: { html: '<section class="panel"><h2>能量比较指数</h2><output data-energy>—</output><p data-trial></p><output data-result></output><p data-status></p><div class="actions"><button data-back>返回实验</button></div></section>', css: panelCss } }
  project.instances[SHARED_EXPERIMENT.experimentScene]!.childIds = [SHARED_EXPERIMENT.title, SHARED_EXPERIMENT.description, SHARED_EXPERIMENT.image, SHARED_EXPERIMENT.experiment]
  project.instances[SHARED_EXPERIMENT.resultScene]!.childIds = ['result-title', 'result-description', 'result-image', SHARED_EXPERIMENT.result]
  const driver = new CourseV10Driver()
  let model: Extract<DocumentModel, { kind: 'course-v10' }> = { kind: 'course-v10', project,
    resources: { assets: { [SHARED_EXPERIMENT.imageAsset]: diagram }, components: {} } }
  for (const [id, code] of [[SHARED_EXPERIMENT.experiment, experimentEnhancement], [SHARED_EXPERIMENT.result, resultEnhancement]]) {
    const behavior = { ...source(code!), moduleBindings: { './model': SHARED_EXPERIMENT.modelDefinition } }
    const edits = componentAuthorEnhancementEdits(model.project, model.resources, id!, behavior)
    model = driver.apply(model, captureComponentOperation(model.project, edits)) as typeof model
  }
  return model
}
