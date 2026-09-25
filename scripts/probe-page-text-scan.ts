import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { scanPageText } from '../src/shared/runtimeText/scanPageText'

async function main() {
  const target = process.argv[2]
  if (!target) {
    console.error('usage: npx tsx scripts/probe-page-text-scan.ts <html路径>')
    process.exit(1)
  }
  const path = resolve(target)
  const text = await readFile(path, 'utf8')
  const start = performance.now()
  const result = scanPageText([{ path, kind: 'html', text }])
  const elapsed = (performance.now() - start).toFixed(1)
  console.log(`file: ${path} (${(text.length / 1024).toFixed(1)} KB)`)
  console.log(`entries: ${result.entries.length}, diagnostics: ${result.diagnostics.length}, elapsed: ${elapsed} ms`)
  for (const diagnostic of result.diagnostics.slice(0, 5)) console.log(`diagnostic: ${diagnostic.message}`)
  for (const entry of result.entries.slice(0, 30)) {
    const contexts = [...new Set(entry.occurrences.map((o) => (o.attribute ? `${o.context}:${o.attribute}` : o.context)))].join(',')
    console.log(`- [${contexts} x${entry.occurrences.length}] ${entry.text.length > 80 ? `${entry.text.slice(0, 80)}…` : entry.text}`)
  }
}
void main()
