import type { Extension } from '@codemirror/state'

/** Optional coloring only: no formatting, validation gate or source mutation. */
export async function loadSourceLanguage(filename: string): Promise<Extension> {
  const extension = /\.([^.\\/]+)$/.exec(filename)?.[1]?.toLowerCase()
  switch (extension) {
    case 'json': case 'jsonc':
      return (await import('@codemirror/lang-json')).json()
    case 'js': case 'jsx': case 'mjs': case 'cjs':
      return (await import('@codemirror/lang-javascript')).javascript({ jsx: extension === 'jsx' })
    case 'ts': case 'tsx': case 'mts': case 'cts':
      return (await import('@codemirror/lang-javascript')).javascript({ typescript: true, jsx: extension === 'tsx' })
    case 'html': case 'htm':
      return (await import('@codemirror/lang-html')).html()
    case 'css':
      return (await import('@codemirror/lang-css')).css()
    default:
      return []
  }
}
