import { parse } from '@babel/parser'
import type { ComponentAuthorField } from '../../../shared/contracts/component-platform/runtime'
import { decodeHtmlEntities } from '../../../shared/html/htmlSourceScanner'

type Region = NonNullable<ComponentAuthorField['sourceRegion']>
/** Identify the actual JS/TS string carrier without executing author code. */
function stringCarrier(source: string, region: Region): { value: string; quote: string } | undefined {
  if (region.kind !== 'implementation') return undefined
  let tree: unknown
  try { tree = parse(source, { sourceType: 'unambiguous', plugins: ['typescript', 'jsx'] }) } catch { return undefined }
  let found: { value: string; quote: string } | undefined
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object' || found) return
    if (Array.isArray(value)) { value.forEach(visit); return }
    const node = value as Record<string, unknown>
    if (node.start === region.start - 1 && node.end === region.end + 1) {
      if (node.type === 'StringLiteral' && typeof node.value === 'string') found = { value: node.value, quote: source[region.start - 1] }
      if (node.type === 'TemplateLiteral' && Array.isArray(node.expressions) && !node.expressions.length) {
        const quasi = (node.quasis as { value: { cooked: string | null } }[])[0]
        if (typeof quasi?.value.cooked === 'string') found = { value: quasi.value.cooked, quote: '`' }
      }
    }
    if (!found) Object.values(node).forEach(visit)
  }
  visit(tree)
  return found
}
export function readAuthorSourceText(source: string, region: Region): string {
  const raw = source.slice(region.start, region.end)
  return region.kind === 'data' && region.encoding ? decodeHtmlEntities(raw) : stringCarrier(source, region)?.value ?? raw
}
export function encodeAuthorSourceText(source: string, region: Region, value: string): string {
  const carrier = stringCarrier(source, region)
  if (!carrier) return value
  let escaped = value.replace(/\\/g, '\\\\').replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
  escaped = escaped.replaceAll(carrier.quote, `\\${carrier.quote}`)
  return carrier.quote === '`' ? escaped.replace(/\$\{/g, '\\${') : escaped
}
