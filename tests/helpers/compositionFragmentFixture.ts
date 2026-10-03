import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { createChartLayerItem, createChartNode } from '../../src/core/tools/nativeNodeFactories'
import type { CompositionLayerItem } from '../../src/shared/courseProjectTypes'

export const fragmentImageBytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='), c => c.charCodeAt(0))
export const fragmentPrompt = '先预测数据变化，再操作并观察图表。'

export function compositionFragmentFixture() {
  const project = createBlankCourseProject({ title: '优质结构资产来源', canvas: { width: 800, height: 1100 }, includeDefaultController: false, controls: 'none' })
  const chart = createChartLayerItem(createChartNode({ title: '观测数据', chartType: 'bar' })).content
  const item: CompositionLayerItem = {
    layerItemId: 'quality-composition', label: '两栏观察与解释', kind: 'composition',
    frame: { mode: 'absolute', x: 0, y: 0, width: 800, height: 900 }, order: 0, locked: false, visible: true,
    rotation: 0, opacity: 1, hitPolicy: 'auto', playbackInitialVisibility: 'inherit',
    content: { doctype: '<!DOCTYPE html>', assets: { photo: { assetId: 'source-photo' } }, root: {
      id: 'html', kind: 'element', tagName: 'html', attributes: {}, children: [
        { id: 'head', kind: 'element', tagName: 'head', attributes: {}, children: [
          { id: 'style', kind: 'element', tagName: 'style', attributes: {}, children: [{ id: 'css', kind: 'text', text:
            'html,body{margin:0;font:18px sans-serif;background:#f4f7fc;color:#172b46}main{padding:32px}.columns{display:grid;grid-template-columns:1fr 1fr;gap:24px}.card{background:white;border-radius:16px;padding:20px;min-width:0}h1{font-size:30px;margin:0 0 20px}p{line-height:1.5;margin:0 0 16px}.chart{height:260px}.interaction{height:70px}img{width:32px;height:32px}@media(max-width:500px){.columns{grid-template-columns:1fr}}' }] },
        ] },
        { id: 'body', kind: 'element', tagName: 'body', attributes: {}, children: [
          { id: 'main', kind: 'element', tagName: 'main', attributes: {}, children: [
            { id: 'heading', kind: 'element', tagName: 'h1', attributes: {}, children: [{ id: 'heading-text', kind: 'text', text: '用观察解释变化' }] },
            { id: 'columns', kind: 'element', tagName: 'div', attributes: { class: 'columns' }, children: [
              { id: 'left', kind: 'element', tagName: 'section', attributes: { class: 'card', 'data-card': 'left' }, children: [
                { id: 'paragraph', kind: 'element', tagName: 'p', attributes: {}, children: [{ id: 'paragraph-text', kind: 'text', text: fragmentPrompt }] },
                { id: 'picture', kind: 'element', tagName: 'img', attributes: { src: 'cw-resource:photo', alt: '资源闭包示例' }, children: [] },
                { id: 'interaction', kind: 'element', tagName: 'div', attributes: { class: 'interaction' }, children: [{ id: 'counter', kind: 'runtime', runtime: {
                  protocol: 'surface-runtime', runtimeApiVersion: 3, enabled: true, renderMode: 'dom', assets: {}, content: { values: {} },
                  source: `CoursewareRuntime.define({protocol:'surface-runtime',runtimeApiVersion:3,create(ctx){let n=0;const button=document.createElement('button');button.dataset.fragmentCounter='true';button.textContent='观察次数：0';button.onclick=()=>button.textContent='观察次数：'+ ++n;ctx.dom.root.append(button);return{resize(){},destroy(){button.remove()}}}})`,
                } }] },
              ] },
              { id: 'right', kind: 'element', tagName: 'section', attributes: { class: 'card', 'data-card': 'right' }, children: [
                { id: 'chart-wrap', kind: 'element', tagName: 'div', attributes: { class: 'chart' }, children: [{ id: 'chart', kind: 'native', content: chart }] },
              ] },
            ] },
          ] },
        ] },
      ],
    } },
  }
  project.assets['source-photo'] = { id: 'source-photo', kind: 'image', filename: 'dot.png', mimeType: 'image/png', path: 'assets/dot.png', byteLength: fragmentImageBytes.length, width: 1, height: 1 }
  const slide = project.surfaces.find(surface => surface.type === 'slide')!
  slide.scenes[0]!.layerItems.push(item)
  return { project, item, assetFiles: { 'source-photo': fragmentImageBytes } }
}
