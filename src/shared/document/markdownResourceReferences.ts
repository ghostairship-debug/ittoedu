import { Lexer } from 'marked'
import { documentRelativePathSchema } from './resources'

/** Collect actual packaged resources; navigation remains literal source content. */
export function markdownResourceReferences(source: string, validatePath: (relative: string) => string = relative => documentRelativePathSchema.parse(relative)): string[] {
  const references = new Set<string>()
  const addPath = (relative: string) => references.add(validatePath(relative))
  const addHref = (href: string) => {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href)) return
    const pathname = href.split(/[?#]/)[0]!
    let decoded = pathname
    try { decoded = decodeURIComponent(pathname) } catch { /* A literal percent can name a local file. */ }
    if (decoded) addPath(decoded.replace(/^\.\//, ''))
  }
  const visit = (tokens: unknown[]) => { for (const item of tokens) {
    if (!item || typeof item !== 'object') continue
    const token = item as Record<string, unknown>
    if (token.type === 'image' && typeof token.href === 'string') addHref(token.href)
    if (token.type === 'html' && typeof token.text === 'string') {
      for (const match of token.text.matchAll(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) addHref(match[1] ?? match[2] ?? match[3] ?? '')
    }
    if (token.type === 'code' && token.lang === 'cw-object-v1' && typeof token.text === 'string') {
      try {
        const object = JSON.parse(token.text) as { resources?: { assets?: unknown; components?: unknown } } | null
        for (const group of [object?.resources?.assets, object?.resources?.components]) {
          if (!Array.isArray(group)) continue
          for (const resource of group) {
            if (!resource || typeof resource !== 'object') continue
            const source = resource.source
            if (!source || source.kind !== 'relative' || typeof source.path !== 'string' || !source.path) continue
            // Official paths are literal. Malformed fragments stay available to
            // the editor's existing local diagnostic and repair path.
            try { addPath(source.path) } catch { /* Never open an unsafe fragment path. */ }
          }
        }
      } catch { /* Preserve malformed object source for repair. */ }
    }
    for (const child of Object.values(token)) if (Array.isArray(child)) visit(child)
  } }
  visit(Lexer.lex(source))
  return [...references].sort()
}
