import type { ComponentProjectFileInput } from '../projectFiles/componentPlatform'
import { decodeHtmlSource } from '../../shared/html/sourceEncoding'
import type { TaskTargetMetadata } from '../../shared/workbench/taskTargetContext'

function relativeToEntry(entry: string, name: string): string {
  const base = entry.split('/').slice(0, -1), file = name.split('/')
  while (base.length && file.length && base[0] === file[0]) { base.shift(); file.shift() }
  return [...base.map(() => '..'), ...file].join('/')
}

/** Read-only group bytes feed the existing content/resource preparation once. */
export function artifactGroupInput(entry: string, files: readonly { name: string; bytes: Uint8Array }[], metadata?: TaskTargetMetadata): ComponentProjectFileInput {
  const selected = files.find(file => file.name === entry)
  if (!selected) throw new Error('成果入口未在封存文件组中声明')
  const bytes = new Uint8Array(selected.bytes)
  const source = /\.(?:[cm]?js|[jt]sx?)$/i.test(entry)
  const textFormat = source || /\.(?:html?|css|json|md|markdown|txt|svg)$/i.test(entry)
  let text: string | undefined
  if (textFormat) try {
    text = /\.html?$/i.test(entry) ? decodeHtmlSource(bytes).text : new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch { /* Original bytes remain available to the format adapter. */ }
  return { filename: entry, bytes, ...(text !== undefined ? { text } : {}),
    siblingFiles: new Map(files.map(file => [source ? file.name : relativeToEntry(entry, file.name), new Uint8Array(file.bytes)])),
    ...(source ? { sourceEntry: entry } : {}), ...(metadata ? { metadata: structuredClone(metadata) } : {}) }
}
