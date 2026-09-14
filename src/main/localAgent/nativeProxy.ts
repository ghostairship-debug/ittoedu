import type { LocalAgentId } from '../../shared/localAgentContract'

let resolveSystemProxy: ((url: string) => Promise<string>) | undefined
export function configureNativeSystemProxy(resolver: (url: string) => Promise<string>) { resolveSystemProxy = resolver }

/** Explicit native environment wins. Resolve the running machine's system proxy
 * at launch, including PAC, without changing persistent CLI/user settings. */
export async function nativeProxyEnvironment(adapter: LocalAgentId, source: NodeJS.ProcessEnv = process.env): Promise<NodeJS.ProcessEnv> {
  if (Object.entries(source).some(([key, value]) => /^(?:https?_proxy|all_proxy)$/i.test(key) && value?.trim()) || !resolveSystemProxy) return {}
  const endpoint = adapter === 'claude' ? source.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com'
    : source.OPENAI_BASE_URL ?? 'https://chatgpt.com/backend-api/codex/responses'
  let result: string
  try { result = await resolveSystemProxy(endpoint) } catch { return {} }
  const first = result.split(';')[0]?.trim() ?? ''
  const match = /^(PROXY|HTTPS)\s+([^\s/]+:\d+)$/i.exec(first)
  if (!match) return {}
  const proxy = `${match[1]!.toUpperCase() === 'HTTPS' ? 'https' : 'http'}://${match[2]}`
  // loopback services (ACP/MCP/local editor) must remain local.
  const bypass = Object.entries(source).find(([key]) => /^no_proxy$/i.test(key))?.[1]
  return { HTTPS_PROXY: proxy, HTTP_PROXY: proxy, NO_PROXY: [bypass, 'localhost', '127.0.0.1', '::1'].filter(Boolean).join(',') }
}
