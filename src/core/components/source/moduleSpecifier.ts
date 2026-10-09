/** Local URL identity is distinct from the pathname used to capture supplied files. */
export interface ComponentModuleSpecifier {
  pathname: string
  suffix: string
  diagnostic?: string
}

// These build-tool conventions require an actual alternate loader/runtime.
// Ordinary URL parameters (including cache versions) only distinguish module identity.
const alternateLoaders = new Set(['raw', 'url', 'worker', 'sharedworker', 'inline', 'no-inline', 'direct'])

export const componentModuleFileExtensions = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.json', '.css', '/index.ts', '/index.tsx', '/index.js', '/index.jsx', '/index.mjs', '/index.json']

export function componentModuleSpecifier(reference: string, loading: 'module' | 'resource' = 'module'): ComponentModuleSpecifier {
  const index = reference.search(/[?#]/)
  const encodedPath = index === -1 ? reference : reference.slice(0, index)
  const suffix = index === -1 ? '' : reference.slice(index)
  let pathname: string
  try { pathname = decodeURIComponent(encodedPath) }
  catch { pathname = encodedPath }
  if (loading === 'module' && suffix.startsWith('?')) {
    const query = suffix.slice(1).split('#', 1)[0]
    for (const key of new URLSearchParams(query).keys()) {
      if (alternateLoaders.has(key)) return { pathname, suffix,
        diagnostic: `组件模块加载方式 ?${key} 尚未支持：${reference}；原源码保留，请提供对应加载实现` }
    }
  }
  return { pathname, suffix }
}
