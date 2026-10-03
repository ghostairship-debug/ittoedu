// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { documentDigest } from '../../src/core/documents/documentDigest'
import { normalizeCourseProject } from '../../src/core/course/normalizeCourseProject'
import { parsePageHtml, serializePageHtml, type PageComposition, type PageNode } from '../../src/core/projectFiles/pageHtml'
import { applyCompositionContentEdit, type CompositionContentEdit } from '../../src/core/tools/compositionContent'
import { parseWebComposition } from '../../src/main/workbench/htmlImport/parseWebComposition'
import { prepareHtmlCourseCandidate } from '../../src/main/workbench/htmlImport/prepareHtmlCourseCandidate'
import { walkComposition } from '../../src/shared/composition/content'
import type { CourseProjectDocument } from '../../src/shared/courseProjectTypes'
import { unpackHtmlDocumentRuntimeSource } from '../../src/shared/runtime/htmlDocumentSource'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'

const SOURCE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>地球公转</title>
<style>
.stage { background: #f8fafc url("diagram.png") no-repeat; padding: 24px; }
.fragment { opacity: 1; }
</style>
</head>
<body>
<section class="stage" id="intro">
  <h1 class="fragment">四季的成因&nbsp;·&nbsp;导入</h1>
  <p title="提示 &quot;引号&quot; &amp; 符号">温度 &lt; 30 &amp; 光照 &gt; 10</p>
  <img src="diagram.png" alt="地轴倾斜示意">
  <img src="photo.png" alt="照片">
  <svg viewBox="0 0 100 50" width="200"><defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/></linearGradient></defs><rect width="100" height="50" fill="url(#g)"/><foreignObject width="10" height="10"><p>内嵌</p></foreignObject></svg>
  <table><tr><th>季节</th><td>夏</td></tr></table>
  <pre>
  缩进的代码
</pre>
  <template><p>模板内容</p></template>
  <!-- 教师备注 -->
  <details><summary>展开</summary><p>原生交互</p></details>
  <guoling-chart>{"chartType":"bar","title":"日照","categories":["春","夏"],"series":[{"name":"时长","values":[10,14]}]}</guoling-chart>
  <guoling-document><script type="application/json">{"blocks":[
    {"type":"heading","level":2,"content":{"inlines":[{"type":"text","text":"要点"}]}},
    {"type":"paragraph","content":{"inlines":[{"type":"text","text":"能量 "},{"type":"math","latex":"E=mc^2","accessibleText":"E 等于 m c 平方"}]}},
    {"type":"list","ordered":true,"items":[{"content":{"inlines":[{"type":"text","text":"第一条"}]}},{"content":{"inlines":[{"type":"text","text":"第二条"}]}}]},
    {"type":"formula","latex":"a^2+b^2=c^2","accessibleText":"勾股定理"},
    {"type":"table","columns":[{"id":"c1","header":{"inlines":[{"type":"text","text":"列"}]}}],"rows":[{"id":"r1","cells":{"c1":{"inlines":[{"type":"text","text":"值"}]}}}]},
    {"type":"section","title":{"inlines":[{"type":"text","text":"拓展"}]},"collapsedByDefault":false,"blocks":[{"type":"paragraph","content":{"inlines":[{"type":"text","text":"更多 <\\/script> 内容"}]}}]}
  ]}</script></guoling-document>
  <iframe title="内嵌模拟" srcdoc="<!doctype html><html><body><img src=&quot;diagram.png&quot;><script>document.body.dataset.ready = '1'</script></body></html>"></iframe>
</section>
</body>
</html>
`

let root = ''
let project: CourseProjectDocument
let page: PageComposition
let photoAssetId = ''

function nodes(content: PageComposition): PageNode[] {
  const found: PageNode[] = []
  walkComposition(content.root, node => found.push(node))
  return found
}
function element(content: PageComposition, test: (node: Extract<PageNode, { kind: 'element' }>) => boolean) {
  const found = nodes(content).find((node): node is Extract<PageNode, { kind: 'element' }> => node.kind === 'element' && test(node))
  if (!found) throw new Error('fixture element missing')
  return found
}
function edit(content: PageComposition, change: CompositionContentEdit): PageComposition {
  const result = applyCompositionContentEdit(content, change)
  if (!result.ok) throw new Error(result.diagnostic.message)
  return result.content as PageComposition
}
const parse = (html: string, previous?: PageComposition) => parsePageHtml(html, { parse: parseWebComposition, assets: project.assets, ...(previous ? { previous } : {}) })

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-files-page-'))
  const sourcePath = path.join(root, 'lesson.html')
  await fs.writeFile(sourcePath, SOURCE)
  await sharp({ create: { width: 4, height: 3, channels: 4, background: '#336699' } }).png().toFile(path.join(root, 'diagram.png'))
  await sharp({ create: { width: 3, height: 3, channels: 4, background: '#996633' } }).png().toFile(path.join(root, 'photo.png'))
  const blank = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
  const snapshot: DocumentSnapshot = {
    documentId: 'project-files-page', epoch: 'epoch', revision: blank.revision,
    binding: { kind: 'untitled', suggestedName: 'lesson.h5lesson' },
    model: { kind: 'course-v9', project: blank, resources: { assets: {}, components: {} } },
    dirty: false, saving: false, recoverable: true, undoDepth: 0, redoDepth: 0,
  }
  const candidate = await prepareHtmlCourseCandidate({ snapshot, sourcePath, locationId: blank.locations[0]!.id })
  project = candidate.model.project
  const slide = project.surfaces.find(surface => surface.type === 'slide')!
  const item = slide.scenes[0]!.layerItems[0]!
  if (item.kind !== 'composition') throw new Error('fixture page should be an editable composition')
  photoAssetId = Object.values(project.assets).find(meta => meta.kind === 'image' && meta.width === 3 && meta.height === 3)?.id
    ?? Object.values(project.assets).filter(meta => meta.kind === 'image' && !meta.id.startsWith('runtime-capture-'))[1]!.id
  // Editor results: drag and resize inside the page, restyle, retext, reclass, and an AI-card image swap.
  let edited = item.content as PageComposition
  const heading = element(edited, node => node.tagName === 'h1')
  const paragraph = element(edited, node => node.tagName === 'p' && node.attributes.title !== undefined)
  edited = edit(edited, { type: 'style', nodeId: heading.id, patch: { position: 'absolute', left: '120px', top: '48px', width: '640px', height: 'auto', color: '#1d4ed8' } })
  edited = edit(edited, { type: 'attributes', nodeId: paragraph.id, patch: { class: 'note emphasis' } })
  const text = paragraph.children.find(child => child.kind === 'text')!
  edited = edit(edited, { type: 'text', nodeId: text.id, text: '温度 < 30 & 光照 > 10，人工修改' })
  const diagram = element(edited, node => node.tagName === 'img' && node.attributes.alt === '地轴倾斜示意')
  const key = `image-${photoAssetId}`
  edited = { ...edit(edited, { type: 'attributes', nodeId: diagram.id, patch: { src: `cw-resource:${key}` } }), }
  edited = { ...edited, assets: { ...edited.assets, [key]: { assetId: photoAssetId } } }
  page = edited
})

afterAll(async () => {
  if (root && path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) await fs.rm(root, { recursive: true, force: true })
})

describe('slide page file round trip', () => {
  it('serializes a page without identities or resource keys and reads its own output back with zero changes', () => {
    const html = serializePageHtml(page, project.assets)
    expect(html).not.toMatch(/cw-resource:|web_[0-9a-f-]{8}/)
    expect(html).toContain('src="../assets/')
    expect(html).toContain('url("../assets/')
    expect(html).toContain('srcdoc="')
    expect(html).toContain('<guoling-chart><script type="application/json">')
    expect(html).not.toContain('"formulaId"')
    expect(html).toContain('<guoling-document><script type="application/json">')
    expect(html).toContain(['更多 ', 'u003c/script> 内容'].join(String.fromCharCode(92)))
    expect(nodes(page).some(node => node.kind === 'document')).toBe(true)
    expect(html.startsWith('<!DOCTYPE html>\n')).toBe(true)

    const parsed = parse(html, page)
    if (parsed.kind !== 'composition') throw new Error('page should stay editable')
    expect(parsed.content).toEqual(page)
    expect(documentDigest(parsed.content)).toBe(documentDigest(page))
    // Its embedded program keeps the admitted definition, including the static fallback.
    const runtime = nodes(parsed.content).find(node => node.kind === 'runtime')
    expect(runtime?.kind === 'runtime' && runtime.runtime.staticFallback).toBeTruthy()
    expect(serializePageHtml(parsed.content, project.assets)).toBe(html)
  })

  it('applies a local text replacement while every other identity, style and binding is kept', () => {
    const html = serializePageHtml(page, project.assets)
    const changed = html.replace('人工修改', '模型修改')
    expect(changed).not.toBe(html)
    const parsed = parse(changed, page)
    if (parsed.kind !== 'composition') throw new Error('page should stay editable')
    const before = nodes(page), after = nodes(parsed.content)
    expect(after.map(node => node.id)).toEqual(before.map(node => node.id))
    const differing = after.filter((node, index) => documentDigest(node) !== documentDigest(before[index]))
    // Only the edited text node and its ancestors (whose children changed) differ.
    const text = differing.filter(node => node.kind === 'text')
    expect(text).toHaveLength(1)
    expect(text[0]!.kind === 'text' && text[0]!.text).toBe('温度 < 30 & 光照 > 10，模型修改')
    expect(differing.every(node => node.kind === 'text' || node.kind === 'element')).toBe(true)
    expect(parsed.content.assets).toEqual(page.assets)
  })

  it('keeps new references as written; normalization binds a slot that names an existing asset', () => {
    const name = Object.values(project.assets).find(meta => meta.id === photoAssetId)!.path
    const html = serializePageHtml(page, project.assets).replace('<p>原生交互</p>', `<p>原生交互</p><img src="../${name}" alt="新图"><img src="../assets/待画.svg" alt="待填素材">`)
    const parsed = parse(html, page)
    if (parsed.kind !== 'composition') throw new Error('page should stay editable')
    const images = nodes(parsed.content).filter((node): node is Extract<PageNode, { kind: 'element' }> => node.kind === 'element' && node.tagName === 'img')
    const added = images.find(node => node.attributes.alt === '新图')!
    expect(added.attributes.src).toBe(`../${name}`)
    expect(images.find(node => node.attributes.alt === '待填素材')!.attributes.src).toBe('../assets/待画.svg')
    const slide = project.surfaces.find(surface => surface.type === 'slide')!
    if (slide.type !== 'slide') throw new Error('slide')
    const withPage = structuredClone(project)
    const item = (withPage.surfaces.find(surface => surface.id === slide.id) as typeof slide).scenes[0]!.layerItems[0]!
    if (item.kind !== 'composition') throw new Error('composition')
    item.content = parsed.content
    const bound = normalizeCourseProject(withPage)
    const boundItem = (bound.surfaces.find(surface => surface.id === slide.id) as typeof slide).scenes[0]!.layerItems[0]!
    expect(boundItem.kind === 'composition' && boundItem.content.assets[name]).toEqual({ assetId: photoAssetId })
    expect(boundItem.kind === 'composition' && boundItem.content.assets['assets/待画.svg']).toBeUndefined()
  })

  it('treats a scripted page as a whole-page program whose document keeps relative asset references for the reader', () => {
    const serialized = serializePageHtml(page, project.assets), end = serialized.lastIndexOf('</body>')
    const html = `${serialized.slice(0, end)}<script>document.title = "程序"</script>${serialized.slice(end)}`
    const parsed = parse(html, page)
    if (parsed.kind !== 'program') throw new Error('script should make a whole-page program')
    const payload = unpackHtmlDocumentRuntimeSource(parsed.runtime.source)!
    expect(payload.html).not.toContain('../assets/')
    expect(Object.values(parsed.runtime.assets).map(binding => binding.assetId)).toContain(photoAssetId)
    expect(payload.resourceKeys.every(key => /^[a-f0-9]{64}$/.test(key))).toBe(true)
  })
})
