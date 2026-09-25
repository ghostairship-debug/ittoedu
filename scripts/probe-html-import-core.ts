import { readFileSync } from 'node:fs'
import { extractHtmlResources } from '../src/main/workbench/htmlImport/extractHtmlResources'

const file = process.argv[2]
if (!file) {
  console.error('usage: tsx scripts/probe-html-import-core.ts <html路径>')
  process.exit(1)
}

const html = readFileSync(file, 'utf8')
const result = extractHtmlResources({ html })
const byMime = new Map<string, { count: number; bytes: number }>()
for (const resource of result.resources) {
  const row = byMime.get(resource.mediaType) ?? { count: 0, bytes: 0 }
  row.count += 1
  row.bytes += resource.bytes.byteLength
  byMime.set(resource.mediaType, row)
}

console.log('resources by mime:')
for (const [mime, row] of byMime) console.log(`${mime}: ${row.count} resources, ${row.bytes} bytes`)
console.log(`output html bytes: ${Buffer.byteLength(result.html)}`)
const residual = result.html.match(/data:[a-z0-9.+-]+\/[a-z0-9.+-]+(?:;[^,]*)?;base64,/gi)?.length ?? 0
console.log(`residual base64 data URIs: ${residual}`)
console.log(`remote references: ${result.remoteReferences.length}`)
console.log(`diagnostics: ${result.diagnostics.length}`)
