import { parse, type DefaultTreeAdapterTypes } from 'parse5'
import { parse as parseJavaScript } from 'acorn'
import type { ComponentCompilationDiagnostic, ComponentCompilationInput, ComponentCompilationResult } from '../../components/compilation/types'

type LocatedElement = DefaultTreeAdapterTypes.Element
type Edit = { start: number; end: number; value: string }
const escapeAttribute = (value: string) => value.replace(/[&"<>]/g, character => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[character]!)

/** Delivery projection only: author HTML remains unchanged in the project. Classic
 * scripts must reach the same compiler as modules before they enter an iframe. */
export async function prepareBrowserScripts(html: string,
  compile: (input: ComponentCompilationInput) => Promise<ComponentCompilationResult>,
  report: (issue: ComponentCompilationDiagnostic) => void,
  documentPath = ''): Promise<string> {
  const tree = parse(html, { sourceCodeLocationInfo: true }), edits: Edit[] = []
  let scriptIndex = 0, childIndex = 0, handlerIndex = 0
  const script = async (source: string, name: string, handler = false): Promise<string> => {
    const filename = `${documentPath || 'document'}/${name}.js`
    const result = await compile({ entry: filename, files: { [filename]: handler ? `function __guoling_browser_handler__(event){${source}\n}` : source },
      options: { preserveScript: true, sourceMap: false } })
    const issues = result.status === 'ready' ? result.artifact.diagnostics : result.diagnostics
    issues.forEach(issue => report({ ...issue, file: filename }))
    if (result.status !== 'ready') return source
    if (!handler) return result.artifact.code
    const program = parseJavaScript(result.artifact.code, { ecmaVersion: 'latest', sourceType: 'script' })
    const declaration = program.body.find(node => node.type === 'FunctionDeclaration')
    if (declaration?.type !== 'FunctionDeclaration') return source
    // esbuild may emit helpers outside the wrapper. Keep them in this handler's
    // own scope, after its directives, instead of depending on another script.
    let directivesEnd = declaration.body.start + 1
    for (const statement of declaration.body.body) {
      if (statement.type !== 'ExpressionStatement' || statement.expression.type !== 'Literal' || typeof statement.expression.value !== 'string') break
      directivesEnd = statement.end
    }
    return result.artifact.code.slice(declaration.body.start + 1, directivesEnd) + '\n'
      + result.artifact.code.slice(0, declaration.start) + '\n'
      + result.artifact.code.slice(directivesEnd, declaration.body.end - 1) + '\n'
      + result.artifact.code.slice(declaration.end)
  }
  const attribute = (element: LocatedElement, name: string, value: string) => {
    if (element.attrs.find(attribute => attribute.name === name)?.value === value) return
    const location = element.sourceCodeLocation?.attrs?.[name]
    if (location) edits.push({ start: location.startOffset, end: location.endOffset, value: `${name}="${escapeAttribute(value)}"` })
  }
  const visit = async (node: DefaultTreeAdapterTypes.Node): Promise<void> => {
    if ('tagName' in node) {
      for (const attr of node.attrs) if (/^on[a-z]+$/i.test(attr.name)) attribute(node, attr.name, await script(attr.value, `handler-${handlerIndex++}`, true))
      if (node.tagName === 'iframe') {
        const index = childIndex++, source = node.attrs.find(attr => attr.name === 'srcdoc')
        if (source) attribute(node, 'srcdoc', await prepareBrowserScripts(source.value, compile, report, documentPath ? `${documentPath}/${index}` : String(index)))
      }
      if (node.tagName === 'script') {
        const index = scriptIndex++, attributes = Object.fromEntries(node.attrs.map(attr => [attr.name, attr.value]))
        const type = (attributes.type ?? (attributes.language ? `text/${attributes.language}` : '')).trim().toLowerCase()
        const classic = !type || /^(?:(?:application|text)\/(?:x-)?(?:java|ecma)script|text\/(?:javascript1\.[0-5]|jscript|livescript))$/.test(type)
        if (classic) {
          if (Object.hasOwn(attributes, 'data-guoling-classic-source')) {
            let source: unknown
            try {
              source = JSON.parse(attributes['data-guoling-classic-source']!)
            } catch { /* Existing source diagnostics retain this recoverable input. */ }
            if (typeof source === 'string') attribute(node, 'data-guoling-classic-source', JSON.stringify(await script(source, `script-${index}`)))
          } else if (!Object.hasOwn(attributes, 'src')) {
            const location = node.sourceCodeLocation
            if (location?.startTag && location.endTag) edits.push({ start: location.startTag.endOffset, end: location.endTag.startOffset,
              value: (await script(html.slice(location.startTag.endOffset, location.endTag.startOffset), `script-${index}`)).replace(/<\/script/gi, '<\\/script') })
          }
        }
      }
    }
    if ('childNodes' in node) for (const child of node.childNodes) await visit(child)
    if ('content' in node) await visit(node.content)
  }
  await visit(tree)
  for (const edit of edits.sort((a, b) => b.start - a.start)) html = html.slice(0, edit.start) + edit.value + html.slice(edit.end)
  return html
}
