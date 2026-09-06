import PptxGenJS from 'pptxgenjs'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

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
const unsupported = new PptxGenJS(); unsupported.addSlide().addTable([['项目', '数值'], ['表格不在首批导入范围', '1']], { x: 1, y: 1, w: 8, h: 2 })
await unsupported.writeFile({ fileName: resolve(directory, '应拒绝的表格.pptx') })
slide.addTable([['项目', '数值'], ['此表格将跳过', '1']], { x: 1, y: 5.4, w: 8, h: 1 })
await pptx.writeFile({ fileName: resolve(directory, '部分导入的分数与表格.pptx') })
const server = await createServer({ configFile: resolve('vite.renderer.config.ts'), server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: { ignored: ['**/output/**', '**/test-results/**'] } } })
await server.listen()
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`)
  const results = []
  for (const filename of ['可编辑分数.pptx', '应拒绝的表格.pptx', '部分导入的分数与表格.pptx']) {
    const result = await page.evaluate(async (bytes) => {
      const { parsePptxImport } = await import('/src/renderer/project/pptxImport.ts')
      try { const draft = await parsePptxImport(new Uint8Array(bytes)); return { ok: true, pages: draft.slides.length, items: draft.slides.flatMap(s => s.items.map(i => i.content.nativeType)), assets: draft.assets.length, issues: draft.issues } }
      catch (error) { return { ok: false, message: error.message } }
    }, [...readFileSync(resolve(directory, filename))])
    results.push({ filename, ...result })
  }
  if (!results[0].ok || results[0].assets !== 1 || results[1].ok || !results[1].message.includes('graphicFrame')) throw new Error(JSON.stringify(results))
  if (!results[2].ok || results[2].items.length !== 7 || results[2].assets !== 1 || !results[2].issues.some(issue => issue.type === 'graphicFrame')) throw new Error(JSON.stringify(results))
  writeFileSync(resolve(directory, 'pptx-input-check.json'), JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results, null, 2))
} finally { await browser.close(); await server.close() }
