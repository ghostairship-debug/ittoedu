import { parse, type DefaultTreeAdapterTypes } from 'parse5'
import type { WebRuntimeData } from '../../../components/web/moduleGraph'
import { htmlDocumentKind } from '../../../shared/html/documentKind'
import { compilePublishedWebProgram, stylesRequireNativeDocument } from './compiledScript'

/** Converter coverage selects a carrier before execution. A whole-document shell
 * alone is not a reason to create another iframe. */
export function webProgramRequiresNativeDocument(data: WebRuntimeData, compiled = compilePublishedWebProgram(data,{routing:true})): boolean {
  if (compiled.nativeReasons.length) return true
  const tree = parse(data.html)
  if (htmlDocumentKind(data.html) === 'document' && tree.mode !== 'no-quirks') return true
  let styles = data.css ?? ''
  const visit = (node: DefaultTreeAdapterTypes.Node): boolean => {
    if ('tagName' in node) {
      if (node.tagName === 'link' && node.attrs.some(attribute => attribute.name === 'rel' && attribute.value.split(/\s+/).includes('stylesheet'))) return true
      if (node.tagName === 'style') styles += node.childNodes.map(child=>child.nodeName === '#text' ? (child as DefaultTreeAdapterTypes.TextNode).value : '').join('')
      styles += node.attrs.find(attribute=>attribute.name === 'style')?.value ?? ''
      if (node.tagName === 'template' && visit((node as DefaultTreeAdapterTypes.Template).content)) return true
    }
    return 'childNodes' in node && node.childNodes.some(visit)
  }
  if (visit(tree)) return true
  // Document viewport rules differ from a component-local box. Preference queries
  // retain the same browser meaning in either carrier.
  return stylesRequireNativeDocument(styles)
}
