import { createRequire } from 'node:module'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { pptxInheritanceFixture, pptxCommonMappingFixture } from '../pptxImport.ts'

const PptxGenJS = createRequire(import.meta.url)('pptxgenjs')

const directory = resolve('output/S2-acceptance')
mkdirSync(directory, { recursive: true })
for (const name of ['build.mjs', '01-teaching-plan.md', '02-presentation-script.md', '材料示例.txt']) copyFileSync(new URL(name, import.meta.url), resolve(directory, name))
const pptx = new PptxGenJS()
pptx.layout = 'LAYOUT_WIDE'
const slide = pptx.addSlide()
slide.addText('可编辑的分数练习', { x: 0.7, y: 0.6, w: 11.5, h: 0.8, fontSize: 30, fontFace: 'Microsoft YaHei', bold: true, color: '123456' })
slide.addText('把一个整体平均分成 4 份，取其中 1 份。', { x: 0.7, y: 1.6, w: 11.5, h: 0.8, fontSize: 24, fontFace: 'Microsoft YaHei', color: '123456' })
for (let index = 0; index < 4; index++) slide.addShape(pptx.ShapeType.rect, { x: 1 + index * 2.7, y: 3.1, w: 2.5, h: 1.9, fill: { color: index === 0 ? '2563EB' : 'EFF6FF' }, line: { color: '2563EB', width: 2 } })
slide.addImage({ path: resolve('resources/icons/icon.png'), x: 11.6, y: 6.1, w: 0.7, h: 0.7 })
await pptx.writeFile({ fileName: resolve(directory, '可编辑分数.pptx') })
const table = new PptxGenJS(); table.addSlide().addTable([['项目', '数值'], ['可以编辑的表格', '1']], { x: 1, y: 1, w: 8, h: 2 })
await table.writeFile({ fileName: resolve(directory, '可编辑表格.pptx') })
slide.addTable([['项目', '数值'], ['此表格可以继续编辑', '1']], { x: 1, y: 5.4, w: 8, h: 1 })
await pptx.writeFile({ fileName: resolve(directory, '分数与可编辑表格.pptx') })
const inheritance = await pptxInheritanceFixture()
writeFileSync(resolve(directory, '多母版与表格.pptx'), inheritance)
writeFileSync(resolve(directory, '小尺寸与分组文字.pptx'), pptxCommonMappingFixture())
const mergedFiles = unzipSync(await table.write({ outputType: 'uint8array' }))
mergedFiles['ppt/slides/slide1.xml'] = strToU8(strFromU8(mergedFiles['ppt/slides/slide1.xml']).replace('<a:tc>', '<a:tc gridSpan="2">'))
writeFileSync(resolve(directory, '应提示的合并表格.pptx'), zipSync(mergedFiles))
const server = await createServer({ configFile: resolve('vite.renderer.config.ts'), server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: { ignored: ['**/output/**', '**/test-results/**'] } } })
await server.listen()
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`)
  const results = []
  for (const filename of ['可编辑分数.pptx', '可编辑表格.pptx', '分数与可编辑表格.pptx', '多母版与表格.pptx', '应提示的合并表格.pptx', '小尺寸与分组文字.pptx']) {
    const result = await page.evaluate(async (bytes) => {
      const { parsePptxImport } = await import('/src/renderer/project/pptxImport.ts')
      try { const draft = await parsePptxImport(new Uint8Array(bytes)); return { ok: true, pages: draft.slides.length, items: draft.slides.flatMap(s => s.items.map(i => i.content.nativeType)), shared: draft.shared?.length ?? 0, assets: draft.assets.length, issues: draft.issues } }
      catch (error) { return { ok: false, message: error.message } }
    }, [...readFileSync(resolve(directory, filename))])
    results.push({ filename, ...result })
  }
  if (!results[0].ok || results[0].assets !== 1 || !results[1].ok || results[1].items.join() !== 'table') throw new Error(JSON.stringify(results))
  if (!results[2].ok || results[2].items.length !== 8 || results[2].assets !== 1 || !results[2].items.includes('table')) throw new Error(JSON.stringify(results))
  if (!results[3].ok || results[3].pages !== 4 || results[3].shared !== 4 || results[4].ok || !results[4].message.includes('合并表格')) throw new Error(JSON.stringify(results))
  if (!results[5].ok || results[5].items.length !== 6 || results[5].issues.some(i => i.message.startsWith('已跳过'))) throw new Error(JSON.stringify(results))
  writeFileSync(resolve(directory, 'pptx-input-check.json'), JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results, null, 2))
} finally { await browser.close(); await server.close() }
