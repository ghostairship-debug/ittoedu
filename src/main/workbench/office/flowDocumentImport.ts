import path from 'node:path'
import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { XMLSerializer } from '@xmldom/xmldom'
import { OfficePackage, NS, children, descendants, textOf } from './officePackage'
import { prepareImageResource } from '../admittedImageResource'
import { parseDocumentMarkdown } from '../../../shared/document/markdown'
import { documentContentSchema, documentInlineSchema, type DocumentBlock, type FlowInline, type FlowTextContent } from '../../../shared/document/content'
import type { TextRunStyle } from '../../../shared/contracts/native-v1'
import type { FlowImportResult } from '../../../shared/workbench/flowImportDesktop'
import { OMML_NAMESPACE } from '../../../shared/document/omml'
import { importOmmlMath } from './ommlImport'

const id = () => randomUUID()
const elements = (node: Element) => Array.from(node.childNodes).filter((value): value is Element => value.nodeType === 1)
const val = (node: Element | undefined, key = 'val') => node?.getAttributeNS(NS.word, key) ?? undefined
const first = (node: Element | undefined, name: string) => node ? children(node, NS.word, name)[0] : undefined
const plain = (text: string): FlowTextContent => ({ inlines: [{ type: 'text', text }] })
const imageMime: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' }

/** Native Flow content only. Original files are read without alteration; resources become managed project bytes. */
export async function importFlowDocument(filename: string, bytes: Uint8Array): Promise<FlowImportResult> {
  const result: FlowImportResult = { name: path.basename(filename), blocks: [], assets: [], issues: [] }
  const imageIds = new Map<string, string>()
  const admit = async (key: string, image: Uint8Array, name: string): Promise<string | undefined> => {
    if (imageIds.has(key)) return imageIds.get(key)
    try {
      const resource = await prepareImageResource({ bytes: image, filename: name, mimeType: imageMime[path.extname(name).toLowerCase()] ?? '' }, id)
      const asset = { id: resource.meta.id, path: resource.meta.path, filename: name, kind: 'image' as const,
        mimeType: resource.meta.mimeType, byteLength: resource.bytes.length, width: resource.meta.width, height: resource.meta.height }
      result.assets.push({ asset, bytes: resource.bytes }); imageIds.set(key, asset.id); return asset.id
    } catch { result.issues.push(`图片 ${path.basename(name)} 未能导入；原文件仍保留，请单独添加受支持的图片。`); return undefined }
  }
  const extension = path.extname(filename).toLowerCase()
  if (extension === '.txt') {
    const text = decodeText(bytes, result.issues)
    result.blocks = text.split(/\r?\n/).map(line => ({ id: id(), type: 'paragraph', content: plain(line) }))
  } else if (extension === '.md' || extension === '.markdown') {
    const requested = new Map<string, string>()
    const parsed = parseDocumentMarkdown(decodeText(bytes, result.issues), { createId: id, target: 'flow', recoverUnsupportedBlocks: true,
      resolveImage: href => { const assetId = requested.get(href) ?? id(); requested.set(href, assetId); return { assetId, source: { kind: 'project' } } } })
    if (parsed.status === 'invalid') {
      result.blocks = [{ id: id(), type: 'paragraph', content: plain(parsed.source) }]
      result.issues.push(...parsed.diagnostics.map(item => `第 ${item.line} 行：${item.message}；原文保留为可编辑文字。`))
    } else {
      result.blocks = parsed.document.content.blocks
      result.issues.push(...parsed.diagnostics.map(item => item.message))
      const root = await fs.realpath(path.dirname(filename))
      for (const [href, assetId] of requested) {
        try {
          if (/^[a-z][a-z0-9+.-]*:/i.test(href) || path.isAbsolute(href)) throw new Error('不是本地相对素材')
          const source = await fs.realpath(path.resolve(root, decodeURIComponent(href))), relative = path.relative(root, source)
          if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('素材在来源目录之外')
          const added = await admit(href, new Uint8Array(await fs.readFile(source)), path.basename(source))
          if (added) {
            const entry = result.assets.find(entry => entry.asset.id === added)!
            entry.asset = { ...entry.asset, id: assetId }; imageIds.set(href, assetId)
          }
        } catch { result.issues.push(`图片 ${href} 无法从来源目录读取；请单独添加图片。`) }
      }
      const missing = new Set([...requested.values()].filter(assetId => !result.assets.some(entry => entry.asset.id === assetId)))
      const repair = (blocks: DocumentBlock[]): DocumentBlock[] => blocks.map(block => block.type === 'media' && block.assetId && missing.has(block.assetId)
        ? { id: block.id, type: 'paragraph', content: plain(`[图片：${block.altText || '未能读取'}]`) } : block.type === 'section' ? { ...block, blocks: repair(block.blocks) } : block)
      result.blocks = repair(result.blocks)
    }
  } else if (extension === '.docx') {
    const pkg = new OfficePackage(bytes), main = pkg.main(), doc = pkg.xml(main)
    const body = descendants(doc, NS.word, 'body')[0]
    if (!body) throw new Error('DOCX 没有可读取的正文')
    const relationships = pkg.relationships(main)
    const relPart = path.posix.join(path.posix.dirname(main), '_rels', path.posix.basename(main) + '.rels')
    const links = pkg.parts[relPart] ? new Map(descendants(pkg.xml(relPart), NS.relationship, 'Relationship').filter(rel => rel.getAttribute('TargetMode') === 'External').map(rel => [rel.getAttribute('Id')!, rel.getAttribute('Target')!])) : new Map<string, string>()
    const stylePart = path.posix.join(path.posix.dirname(main), 'styles.xml')
    const styles = pkg.parts[stylePart] ? new Map(descendants(pkg.xml(stylePart), NS.word, 'style').map(style => [val(style, 'styleId')!, style])) : new Map<string, Element>()
    const resolveStyle = (styleId: string | undefined, seen = new Set<string>()): TextRunStyle => {
      if (!styleId || seen.has(styleId)) return {}
      seen.add(styleId); const style = styles.get(styleId)
      return { ...resolveStyle(val(first(style, 'basedOn')), seen), ...runStyle(first(style, 'rPr')) }
    }
    const defaults = { fontSize: 16, ...(pkg.parts[stylePart] ? runStyle(descendants(pkg.xml(stylePart), NS.word, 'rPrDefault')[0] ? first(descendants(pkg.xml(stylePart), NS.word, 'rPrDefault')[0], 'rPr') : undefined) : {}) }
    const paragraph = async (p: Element): Promise<{ block: DocumentBlock; images: DocumentBlock[]; list?: { numId: string; ordered: boolean; level: string } }> => {
      const properties = first(p, 'pPr'), styleId = val(first(properties, 'pStyle')), inherited = { ...defaults, ...resolveStyle(styleId), ...runStyle(first(properties, 'rPr')) }
      const inlines: FlowInline[] = [], images: DocumentBlock[] = []
      const visit = async (node: Element, href?: string) => {
        const linkId = node.getAttributeNS(NS.officeRelationship, 'id') ?? ''
        const anchor = val(node, 'anchor')
        const target = node.localName === 'hyperlink' ? links.get(linkId) ?? (anchor ? '#' + anchor : undefined) : href
        if (node.localName === 'oMath' && node.namespaceURI === OMML_NAMESPACE) {
          try {
            const formula = importOmmlMath(node), style = { ...(inherited.fontSize ? { fontSize: inherited.fontSize } : {}), ...(inherited.color ? { color: inherited.color } : {}) }
            inlines.push(documentInlineSchema.parse({ type: 'math', formulaId: id(), ...formula, ...(Object.keys(style).length ? { style } : {}), ...(target && /^(https?:|mailto:|#)/i.test(target) ? { link: { href: target } } : {}) }))
          } catch (error) {
            inlines.push({ type: 'text', text: new XMLSerializer().serializeToString(node), code: true })
            result.issues.push(`Word 公式未能映射：${error instanceof Error ? error.message : String(error)}；完整 OMML 原式保留为可编辑文字。`)
          }
        } else if (node.localName === 'r' && node.namespaceURI === NS.word) {
          const style = { ...inherited, ...resolveStyle(val(first(first(node, 'rPr'), 'rStyle'))), ...runStyle(first(node, 'rPr')) }
          let text = ''
          for (const part of elements(node)) {
            if (part.localName === 't') text += part.textContent ?? ''
            else if (part.localName === 'tab') text += '\t'
            else if (part.localName === 'br' || part.localName === 'cr') text += '\n'
          }
          if (text) inlines.push({ type: 'text', text, ...(Object.keys(style).length ? { style } : {}), ...(target && /^(https?:|mailto:|#)/i.test(target) ? { link: { href: target } } : {}) })
          for (const blip of descendants(node, NS.drawing, 'blip')) {
            const embedded = blip.getAttributeNS(NS.officeRelationship, 'embed') ?? '', part = relationships.get(embedded)
            const assetId = part && pkg.parts[part] ? await admit(part, pkg.parts[part], path.posix.basename(part)) : undefined
            if (assetId) images.push({ id: id(), type: 'media', assetId, mediaKind: 'image', layout: 'content-width', altText: descendants(node, 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing', 'docPr')[0]?.getAttribute('descr') ?? '' })
            else if (!part) result.issues.push('Word 中一张链接图片缺少内嵌资源；原文件保留。')
          }
        } else if (node.localName !== 'del') for (const child of elements(node)) await visit(child, target)
      }
      for (const child of elements(p)) if (child.localName !== 'pPr') await visit(child)
      const outline = val(first(properties, 'outlineLvl')) ?? val(first(first(styles.get(styleId ?? ''), 'pPr'), 'outlineLvl'))
      const heading = /heading\s*([1-6])|标题\s*([1-6])/i.exec(styleId ?? '')
      const level = heading ? Number(heading[1] ?? heading[2]) : outline !== undefined && Number(outline) < 6 ? Number(outline) + 1 : undefined
      const alignment = val(first(properties, 'jc')), textAlign = alignment === 'center' ? 'center' : alignment === 'right' ? 'right' : alignment === 'left' ? 'left' : undefined
      const content = { inlines }
      const block: DocumentBlock = level ? { id: id(), type: 'heading', level: level as 1 | 2 | 3 | 4 | 5 | 6, content, ...(textAlign ? { textAlign } : {}) } : { id: id(), type: 'paragraph', content, ...(textAlign ? { textAlign } : {}) }
      const num = first(properties, 'numPr'), numId = val(first(num, 'numId')), listLevel = val(first(num, 'ilvl')) ?? '0'
      return { block, images, ...(numId && numId !== '0' ? { list: { numId, ordered: orderedList(pkg, main, numId, listLevel), level: listLevel } } : {}) }
    }
    const readBlocks = async (parent: Element) => {
      let listKey = ''
      for (const element of elements(parent)) {
        if (element.localName === 'p') {
          const parsed = await paragraph(element)
          if (parsed.list && parsed.block.type === 'paragraph') {
            const key = `${parsed.list.numId}:${parsed.list.level}`, last = result.blocks.at(-1)
            if (key === listKey && last?.type === 'list') last.items.push({ id: parsed.block.id, content: parsed.block.content })
            else result.blocks.push({ id: id(), type: 'list', ordered: parsed.list.ordered, items: [{ id: parsed.block.id, content: parsed.block.content }] })
            listKey = key
            if (parsed.list.level !== '0') result.issues.push('嵌套列表已按阅读顺序保留，缩进层级简化。')
          } else { result.blocks.push(parsed.block); listKey = '' }
          result.blocks.push(...parsed.images)
          if (parsed.images.length) { listKey = ''; result.issues.push('正文内图片已保留在所属段落下方，按 Flow 内容宽度展示；Word 行内位置和尺寸可继续整理。') }
        } else if (element.localName === 'tbl') { const table = await readTable(element, paragraph, result.issues); result.blocks.push(table.block, ...table.images); listKey = '' }
        else if (element.localName === 'sdt') { const content = first(element, 'sdtContent'); if (content) await readBlocks(content) }
      }
    }
    await readBlocks(body)
    if (descendants(body, NS.word, 'txbxContent').length || descendants(body, 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing', 'anchor').length) result.issues.push('Word 浮动对象按正文阅读顺序导入，不复刻分页和浮动位置。')
  } else throw new Error('支持导入 DOCX、MD 和 TXT 文档')
  if (!result.blocks.length) result.blocks = [{ id: id(), type: 'paragraph', content: { inlines: [] } }]
  result.blocks = documentContentSchema.parse({ blocks: result.blocks }).blocks
  result.issues = [...new Set(result.issues)]
  return result
}

function decodeText(bytes: Uint8Array, issues: string[]): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.slice(2))
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.slice(2))
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch { issues.push('源文件不是 UTF-8，按 GB18030 读取；请核对文字。'); return new TextDecoder('gb18030').decode(bytes) }
}
function runStyle(properties: Element | undefined): TextRunStyle {
  if (!properties) return {}
  const style: TextRunStyle = {}
  for (const [tag, key] of [['b', 'bold'], ['i', 'italic'], ['u', 'underline'], ['strike', 'strike']] as const) {
    const entry = first(properties, tag); if (entry) style[key] = !['0', 'false', 'off', 'none'].includes(val(entry) ?? '')
  }
  const size = Number(val(first(properties, 'sz'))) * 2 / 3
  if (size > 0) style.fontSize = Math.max(8, Math.min(400, size))
  const fonts = first(properties, 'rFonts'), family = val(fonts, 'eastAsia') || val(fonts, 'ascii')
  if (family) style.fontFamily = family
  const color = val(first(properties, 'color')); if (color && /^[a-f0-9]{6}$/i.test(color)) style.color = '#' + color
  const highlight = val(first(properties, 'highlight')), colors: Record<string, string> = { yellow: '#ffff00', green: '#00ff00', cyan: '#00ffff', magenta: '#ff00ff', blue: '#0000ff', red: '#ff0000', lightGray: '#d3d3d3', darkGray: '#808080', none: '' }
  if (highlight && colors[highlight]) style.highlightColor = colors[highlight]
  const vertical = val(first(properties, 'vertAlign')); if (vertical) style.baseline = vertical === 'superscript' ? 0.35 : vertical === 'subscript' ? -0.25 : 0
  return style
}
function orderedList(pkg: OfficePackage, main: string, numId: string, level: string): boolean {
  const part = path.posix.join(path.posix.dirname(main), 'numbering.xml'); if (!pkg.parts[part]) return true
  const doc = pkg.xml(part), num = descendants(doc, NS.word, 'num').find(node => val(node, 'numId') === numId)
  const abstractId = val(first(num, 'abstractNumId')), abstract = descendants(doc, NS.word, 'abstractNum').find(node => val(node, 'abstractNumId') === abstractId)
  const matchesLevel = (node: Element) => (val(node, 'ilvl') ?? '0') === level
  const override = num && children(num, NS.word, 'lvlOverride').find(matchesLevel)
  const overridden = first(override, 'lvl'), defined = abstract && children(abstract, NS.word, 'lvl').find(matchesLevel)
  return (val(first(overridden, 'numFmt')) ?? val(first(defined, 'numFmt'))) !== 'bullet'
}
async function readTable(table: Element, paragraph: (p: Element) => Promise<{ block: DocumentBlock; images: DocumentBlock[] }>, issues: string[]): Promise<{ block: DocumentBlock; images: DocumentBlock[] }> {
  const images: DocumentBlock[] = []
  const wordRows = children(table, NS.word, 'tr')
  const grid = first(table, 'tblGrid')
  const width = Math.max(1, grid ? children(grid, NS.word, 'gridCol').length : 0,
    ...wordRows.map(row => children(row, NS.word, 'tc').reduce((sum, cell) => sum + Math.max(1, Number(val(first(first(cell, 'tcPr'), 'gridSpan'))) || 1), 0)))
  const columns = Array.from({ length: width }, () => ({ id: id(), header: { inlines: [] } })), rows = wordRows.map(() => ({ id: id(), cells: Object.fromEntries(columns.map(column => [column.id, { inlines: [] } as FlowTextContent])) }))
  const merges: { rowIds: string[]; columnIds: string[] }[] = [], active = new Map<number, { row: number; span: number; merge: { rowIds: string[]; columnIds: string[] } }>()
  for (let r = 0; r < wordRows.length; r++) {
    let c = 0; const continued = new Set<number>()
    for (const cell of children(wordRows[r], NS.word, 'tc')) {
      const properties = first(cell, 'tcPr'), span = Math.max(1, Number(val(first(properties, 'gridSpan'))) || 1), vertical = first(properties, 'vMerge')
      const texts = await Promise.all(descendants(cell, NS.word, 'p').map(paragraph))
      const inlines = texts.flatMap((entry, index) => 'content' in entry.block ? [...(index ? [{ type: 'text' as const, text: '\n' }] : []), ...entry.block.content.inlines] : [])
      images.push(...texts.flatMap(entry => entry.images))
      if (texts.some(entry => entry.images.length)) issues.push('表格内图片已保留在表格下方，可继续移动和编辑。')
      if (descendants(cell, NS.word, 'tbl').length) issues.push('嵌套表格按单元格阅读顺序保留文字；内层网格需继续整理。')
      const old = active.get(c)
      if (vertical && val(vertical) !== 'restart' && old && old.span === span) {
        old.merge.rowIds.push(rows[r].id); continued.add(c)
        if (inlines.some(inline => inline.type !== 'text' || inline.text)) rows[old.row].cells[columns[c].id].inlines.push({ type: 'text', text: '\n' }, ...inlines)
      } else {
        rows[r].cells[columns[c].id] = { inlines }
        if (span > 1 || vertical && val(vertical) === 'restart') {
          const merge = { rowIds: [rows[r].id], columnIds: columns.slice(c, c + span).map(column => column.id) }
          merges.push(merge)
          if (vertical) { active.set(c, { row: r, span, merge }); continued.add(c) }
        }
      }
      c += span
    }
    for (const column of active.keys()) if (!continued.has(column)) active.delete(column)
  }
  return { block: { id: id(), type: 'table', headerEnabled: false, columns, rows, merges: merges.filter(merge => merge.rowIds.length * merge.columnIds.length > 1) }, images }
}
