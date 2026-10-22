import { promises as fs } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { unzipSync, strFromU8 } from 'fflate'
import { DOMParser } from '@xmldom/xmldom'

const relationshipNamespace = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
type XmlDocument = ReturnType<DOMParser['parseFromString']>

function xml(bytes: Uint8Array | undefined, filename: string): XmlDocument {
  if (!bytes) throw new Error(`制品缺少 XML 部件：${filename}`)
  const errors: string[] = []
  const document = new DOMParser({ errorHandler: { warning: () => {}, error: message => errors.push(message), fatalError: message => errors.push(message) } }).parseFromString(strFromU8(bytes), 'application/xml')
  if (errors.length) throw new Error(`${filename} 不能解析：${errors.join('; ')}`)
  return document
}

const elements = (document: XmlDocument, name: string) => Array.from(document.getElementsByTagNameNS('*', name))
const text = (document: XmlDocument, name = 't') => elements(document, name).map(node => node.textContent ?? '').join('')

function relationshipTargets(document: XmlDocument) {
  return Object.fromEntries(elements(document, 'Relationship').map(node => [node.getAttribute('Id')!, {
    target: node.getAttribute('Target')!, type: node.getAttribute('Type')!, external: node.getAttribute('TargetMode') === 'External',
  }]))
}

function pptxFacts(files: Record<string, Uint8Array>) {
  const presentation = xml(files['ppt/presentation.xml'], 'ppt/presentation.xml')
  const relationships = relationshipTargets(xml(files['ppt/_rels/presentation.xml.rels'], 'ppt/_rels/presentation.xml.rels'))
  const slides = elements(presentation, 'sldId').map((node, index) => {
    const relationshipId = node.getAttributeNS(relationshipNamespace, 'id') ?? node.getAttribute('r:id')!
    const relation = relationships[relationshipId]
    if (!relation || relation.external) throw new Error(`幻灯片顺序引用不可用：${relationshipId}`)
    const filename = relation.target.startsWith('/') ? relation.target.slice(1) : path.posix.normalize(path.posix.join('ppt', relation.target))
    const document = xml(files[filename], filename)
    const relName = path.posix.join(path.posix.dirname(filename), '_rels', `${path.posix.basename(filename)}.rels`)
    const imageRelations = files[relName] ? Object.values(relationshipTargets(xml(files[relName], relName))).filter(value => value.type.endsWith('/image')) : []
    return { page: index + 1, relationshipId, part: filename, text: text(document),
      nativeTextRuns: elements(document, 't').length, tables: elements(document, 'tbl').length,
      charts: elements(document, 'chart').length, pictures: elements(document, 'pic').length,
      imageRelationships: imageRelations.length, externalImageRelationships: imageRelations.filter(value => value.external).length }
  })
  return { kind: 'pptx' as const, pageCount: slides.length, slides,
    embeddedMedia: Object.entries(files).filter(([name]) => /^ppt\/media\//.test(name) && !name.endsWith('/')).map(([name, data]) => ({ name, bytes: data.byteLength })) }
}

function docxFacts(files: Record<string, Uint8Array>) {
  const document = xml(files['word/document.xml'], 'word/document.xml')
  return { kind: 'docx' as const, text: text(document),
    paragraphs: elements(document, 'p').map(node => Array.from(node.getElementsByTagNameNS('*', 't')).map(value => value.textContent ?? '').join('')),
    tables: elements(document, 'tbl').length, formulas: elements(document, 'oMath').length,
    fractions: elements(document, 'f').map(node => ({
      numerator: Array.from(node.getElementsByTagNameNS('*', 'num')).map(value => value.textContent ?? '').join(''),
      denominator: Array.from(node.getElementsByTagNameNS('*', 'den')).map(value => value.textContent ?? '').join(''),
    })),
    pictures: elements(document, 'pic').length,
    headings: elements(document, 'pStyle').map(node => node.getAttribute('w:val')).filter(value => value?.startsWith('Heading')),
    embeddedMedia: Object.entries(files).filter(([name]) => /^word\/media\//.test(name) && !name.endsWith('/')).map(([name, data]) => ({ name, bytes: data.byteLength })) }
}

type PdfFacts = { kind: 'pdf'; pageCount: number; encrypted: boolean; pages: { page: number; widthPoints: number; heightPoints: number; text: string; images?: { name: string; bytes: number }[] }[]; representativePage: string; contactSheet: string }
type ArtifactFacts = { path: string; bytes: number } & (ReturnType<typeof pptxFacts> | ReturnType<typeof docxFacts> | PdfFacts)

function checkPreservedArtifacts(artifacts: readonly ArtifactFacts[]) {
  const pdf = artifacts.find(value => value.kind === 'pdf')
  assert(pdf?.kind === 'pdf', '缺少 PDF 制品')
  assert.equal(pdf.pageCount, 2)
  assert(pdf.pages.every(page => page.images?.some(image => image.bytes > 0)), 'PDF 每页应有非空固定图面')
  const pptx = artifacts.find(value => value.kind === 'pptx')
  assert(pptx?.kind === 'pptx', '缺少 PPTX 制品')
  assert.equal(pptx.pageCount, 2)
  assert.match(pptx.slides[0]!.text, /V11 preserved title/)
  assert.equal(pptx.slides[0]!.nativeTextRuns, 3)
  assert.equal(pptx.slides[0]!.pictures, 2)
  assert.match(pptx.slides[1]!.text, /Formal Next arrived/)
  assert(pptx.embeddedMedia.length > 0 && pptx.embeddedMedia.every(media => media.bytes > 0 && !media.name.endsWith('/')))
  assert(pptx.slides.every(slide => slide.externalImageRelationships === 0))
  const docx = artifacts.find(value => value.kind === 'docx')
  assert(docx?.kind === 'docx', '缺少 DOCX 制品')
  const body = docx.paragraphs.join('\n')
  assert.match(body, /Flow\s*讲义标题[\s\S]*当前作者初态[\s\S]*仍可编辑的表格[\s\S]*x2/)
  assert.equal(docx.tables, 1)
  assert.equal(docx.formulas, 1)
  assert(docx.headings.includes('Heading1'))
  assert.deepEqual(docx.fractions, [{ numerator: 'x', denominator: '2' }])
  assert(!body.includes('共同正文'))
  return { pdfTwoNonemptyImagePages: true, pptxRelationshipPageOrderAndNativeContent: true, pptxEmbeddedMediaClosed: true, docxInitialStateReadingOrderAndNativeTableFraction: true }
}

const pdfFactsProgram = `import json, sys
from pypdf import PdfReader
reader = PdfReader(sys.argv[1])
pages = []
for index, page in enumerate(reader.pages):
    item = {'page': index + 1, 'widthPoints': float(page.mediabox.width), 'heightPoints': float(page.mediabox.height), 'text': page.extract_text() or ''}
    try:
        item['images'] = [{'name': image.name, 'bytes': len(image.data)} for image in page.images]
    except Exception as error:
        item['imageExtractionError'] = str(error)
    pages.append(item)
print(json.dumps({'kind': 'pdf', 'pageCount': len(pages), 'encrypted': reader.is_encrypted, 'pages': pages}, ensure_ascii=False))
`

export async function inspectStaticArtifacts(options: { files: readonly string[]; outputDirectory: string; python: string; pdftoppm: string; verifyPreservedOutput?: boolean }) {
  await fs.mkdir(options.outputDirectory, { recursive: true })
  const artifacts: ArtifactFacts[] = []
  for (const filename of options.files) {
    const absolutePath = path.resolve(filename), bytes = await fs.readFile(absolutePath)
    const extension = path.extname(filename).toLowerCase()
    let facts: ReturnType<typeof pptxFacts> | ReturnType<typeof docxFacts> | PdfFacts
    if (extension === '.pdf') {
      const parsed = spawnSync(options.python, ['-X', 'utf8', '-c', pdfFactsProgram, absolutePath], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
      if (parsed.status !== 0) throw new Error(`PDF 事实读取失败：${parsed.stderr || parsed.error || parsed.status}`)
      const pdf = JSON.parse(parsed.stdout) as Omit<PdfFacts, 'representativePage' | 'contactSheet'>
      const previews: string[] = []
      for (let page = 1; page <= Math.min(pdf.pageCount, 2); page++) {
        const previewPrefix = path.join(path.resolve(options.outputDirectory), `${path.basename(filename, extension)}-page${page}`)
        const render = spawnSync(options.pdftoppm, ['-f', String(page), '-singlefile', '-r', '110', '-png', absolutePath, previewPrefix], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
        if (render.status !== 0) throw new Error(`PDF 代表页渲染失败：${render.stderr || render.error || render.status}`)
        previews.push(`${previewPrefix}.png`)
      }
      const contactSheet = path.join(path.resolve(options.outputDirectory), `${path.basename(filename, extension)}-contact.png`)
      const contact = spawnSync(options.python, ['-X', 'utf8', '-c', 'from PIL import Image, ImageOps, ImageDraw\nimport sys\nimages=[]\nfor index,filename in enumerate(sys.argv[2:]):\n image=Image.open(filename).convert("RGB")\n image.thumbnail((1200,675))\n panel=Image.new("RGB",(1220,715),"#e5e7eb")\n panel.paste(image,((1220-image.width)//2,30))\n ImageDraw.Draw(panel).text((10,10),f"PDF page {index+1}",fill="black")\n images.append(panel)\ncanvas=Image.new("RGB",(1220,715*len(images)),"white")\nfor index,image in enumerate(images): canvas.paste(image,(0,index*715))\ncanvas.save(sys.argv[1])', contactSheet, ...previews], { encoding: 'utf8' })
      if (contact.status !== 0) throw new Error(`PDF 联系图生成失败：${contact.stderr || contact.error || contact.status}`)
      facts = { ...pdf, representativePage: previews[0]!, contactSheet }
    } else if (extension === '.pptx') facts = pptxFacts(unzipSync(bytes))
    else if (extension === '.docx') facts = docxFacts(unzipSync(bytes))
    else throw new Error(`不是本轮静态输出制品：${filename}`)
    artifacts.push({ path: absolutePath, bytes: bytes.byteLength, ...facts })
  }
  const result = { artifacts, ...(options.verifyPreservedOutput ? { checks: checkPreservedArtifacts(artifacts) } : {}) }
  await fs.writeFile(path.join(options.outputDirectory, 'artifact-facts.json'), JSON.stringify(result, null, 2), 'utf8')
  return result
}

async function main() {
  const args = process.argv.slice(2), files: string[] = []
  let outputDirectory = '', python = '', pdftoppm = '', verifyPreservedOutput = false
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--output') outputDirectory = args[++index] ?? ''
    else if (args[index] === '--python') python = args[++index] ?? ''
    else if (args[index] === '--pdftoppm') pdftoppm = args[++index] ?? ''
    else if (args[index] === '--verify-preserved-output') verifyPreservedOutput = true
    else files.push(args[index]!)
  }
  if (!files.length || !outputDirectory || !python || !pdftoppm) throw new Error('用法：tsx glxStaticArtifactFacts20261020.ts --output <目录> --python <现有Python> --pdftoppm <现有Poppler> <PDF/PPTX/DOCX文件...>')
  const result = await inspectStaticArtifacts({ files, outputDirectory, python, pdftoppm, verifyPreservedOutput })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

if (process.argv[1]?.endsWith('glxStaticArtifactFacts20261020.ts')) void main().catch(error => { process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode = 1 })
