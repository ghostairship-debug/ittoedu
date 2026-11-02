import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { WEB_DEFINITION } from '../../src/components/web/data'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createTextComponentData } from '../../src/components/text/data'
import { setRootContainers } from './glxWorkFixture'

/** Responsive HTML is intentionally contained in the existing managed Web component. */
export function makeFlowD5Archive(): Uint8Array {
  const project = createBlankCourseProjectV10('Flow 动态尺寸')
  project.definitions[WEB_DEFINITION.id] = WEB_DEFINITION
  project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><style>
    *{box-sizing:border-box} body{margin:0;padding:12px;font:16px/1.5 sans-serif;background:#e0f2fe}
    button{font:inherit;margin:0 8px 8px 0} p{margin:8px 0} #more[hidden]{display:none}
  </style></head><body><button id="grow">增长文字</button><button id="toggle">展开内容</button>
  <section id="content"><p>文本随可用宽度换行，组件高度由实际内容决定。请检查相邻正文是否持续自然排列。</p></section>
  <section id="more" hidden><p>${'展开后的示例内容，包含随宽度变化重新换行的自然段落。'.repeat(12)}</p></section>
  <script>document.getElementById('grow').addEventListener('click',function(){var p=document.createElement('p');p.textContent='${'新增文字随正文宽度变化并自然换行。'.repeat(12)}';document.getElementById('content').appendChild(p)});
  document.getElementById('toggle').addEventListener('click',function(){var n=document.getElementById('more');n.hidden=!n.hidden;this.textContent=n.hidden?'展开内容':'收起内容'});</script></body></html>`
  project.instances['d5-widget'] = { id: 'd5-widget', definitionId: WEB_DEFINITION.id, data: { html },
    frame: { width: 380, height: 180, transform: [1, 0, 0, 1, 0, 0] }, flowLayout: { width: 'content-width', widthPercent: 46, wrap: 'left' } }
  project.instances['d5-tail'] = { id: 'd5-tail', definitionId: TEXT_DEFINITION.id,
    data: JSON.parse(JSON.stringify(createTextComponentData('正文需要绕开互动组件，并继续随阅读宽度变化自然换行。'.repeat(30)))) }
  setRootContainers(project, [{ id: 'd5-flow', kind: 'flow', title: '动态排版', childIds: ['d5-widget', 'd5-tail'],
    flow: { layout: { widthMode: 'fluid', readingWidth: 860, wideContentWidth: 1100, toc: 'hidden' } } }])
  return new CourseV10Driver().serialize({ kind: 'course-v10', project, resources: { assets: {}, components: {} } })
}

