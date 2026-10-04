import { isIP } from 'node:net'
import type { Session } from 'electron'
import { Agent, buildConnector, setGlobalDispatcher } from 'undici'
import { openProxyTunnel, parseProxyList, setSystemProxyResolver, systemProxyRoute, type ProxyRouteResolver } from './systemProxy'

/**
 * The dispatcher for fetch (model, image, OAuth, search and MCP-over-HTTP requests): every new
 * connection asks the system proxy for its origin and is made directly or through the proxy.
 */
export function createSystemProxyAgent(route: ProxyRouteResolver = systemProxyRoute): Agent {
  const direct = buildConnector({})
  return new Agent({ connect: (options, callback) => {
    const host = options.hostname.replace(/^\[|\]$/g, '')
    const port = Number(options.port) || (options.protocol === 'https:' ? 443 : 80)
    route(`${options.protocol}//${isIP(host) === 6 ? `[${host}]` : host}:${port}/`).then(async proxy => {
      if (proxy.kind === 'direct') { direct(options, callback); return }
      const tunnel = await openProxyTunnel(proxy, { host, port }, { timeoutMs: 30_000 })
      if (options.protocol === 'https:') direct({ ...options, httpSocket: tunnel }, callback)
      else callback(null, tunnel)
    }).catch(error => callback(error instanceof Error ? error : new Error(String(error)), null))
  } })
}

/** Main, once the app is ready: the session's system or PAC proxy decision drives every outbound HTTP(S) request. */
export function installSystemProxy(session: Pick<Session, 'resolveProxy'>): void {
  setSystemProxyResolver(async url => parseProxyList(await session.resolveProxy(url)))
  setGlobalDispatcher(createSystemProxyAgent())
}
