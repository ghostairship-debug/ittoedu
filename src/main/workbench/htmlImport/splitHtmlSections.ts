import { decodeHtmlEntities, indexHtmlElements, scanHtmlSource } from '../../../shared/html/htmlSourceScanner'

export interface HtmlSectionPage { order: number; id: string | null; title?: string; html: string }
export interface SplitHtmlSectionsResult { mode: 'sections' | 'whole'; sections: HtmlSectionPage[]; warnings: string[] }

/** Uses the shared source scanner so nested sections and script strings never become pages. */
export function splitHtmlSections(source: string, mode: 'auto' | 'sections' | 'whole' = 'auto'): SplitHtmlSectionsResult {
  const whole = (warning?: string): SplitHtmlSectionsResult => ({ mode: 'whole', sections: [{ order: 0, id: null, html: source }], warnings: warning ? [warning] : [] })
  if (mode === 'whole') return whole()
  const unsplit = (reason: string): SplitHtmlSectionsResult => {
    if (mode === 'sections') throw new Error(reason)
    return whole(`${reason}，按整份 HTML 导入`)
  }
  const scan = scanHtmlSource(source)
  if (scan.diagnostics.length) return unsplit(`无法确定 HTML 分页范围：${scan.diagnostics[0]!.message}`)
  const index = indexHtmlElements(source, scan.tokens)
  if (index.sectionsAmbiguous) return unsplit('HTML 分页结构不明确')
  if (!index.sections.length) return unsplit('未找到可分页的 <section>')
  const body = index.body === null ? null : index.elements[index.body]
  if (!body?.endTag) return unsplit('HTML 分页需要完整的 body 标签')
  const main = index.main === null ? null : index.elements[index.main]
  if (main && !main.endTag) return unsplit('HTML 分页需要完整的 main 标签')
  const unclosed = index.sections.find(section => !index.elements[section.elementIndex]!.endTag)
  if (unclosed) return unsplit(`HTML 第 ${unclosed.order + 1} 页的 section 未闭合`)
  const parent = index.main ?? index.body!
  const sharedNames = new Set(['script', 'style', 'template'])
  const belongsToSection = (start: number) => index.sections.some(section => start >= section.full.start && start < section.full.end)
  const unassigned = index.elements.some((element, at) => element.parent === parent && element.name !== 'section' && !sharedNames.has(element.name)
    || element.parent === index.body && main && at !== index.main && !sharedNames.has(element.name))
    || scan.tokens.some(token => token.kind === 'text' && token.span.start >= body.content.start && token.span.end <= body.content.end
      && !belongsToSection(token.span.start) && source.slice(token.span.start, token.span.end).trim() !== ''
      && !(main && token.span.start >= main.startTag.start && token.span.end <= main.endTag!.end && token.span.start < main.content.start))
  if (unassigned) return unsplit('存在不可归属于特定 <section> 的页面内容')
  const prefix = source.slice(0, body.content.start)
  const suffix = source.slice(body.content.end)
  const sections = index.sections.map(section => {
    const element = index.elements[section.elementIndex]!
    const heading = index.elements.find(entry => /^h[1-6]$/.test(entry.name) && entry.full.start >= element.content.start && entry.full.end <= element.content.end)
    const title = heading ? decodeHtmlEntities(source.slice(heading.content.start, heading.content.end).replace(/<[^>]*>/g, '')).trim() : ''
    let cursor = body.content.start
    let content = ''
    for (const other of index.sections) {
      content += source.slice(cursor, other.full.start)
      if (other.order === section.order) content += source.slice(other.full.start, other.full.end)
      cursor = other.full.end
    }
    content += source.slice(cursor, body.content.end)
    return { order: section.order, id: section.id, ...(title ? { title } : {}), html: `${prefix}${content}${suffix}` }
  })
  return { mode: 'sections', sections, warnings: [] }
}
