const routes = {
  teamorouter: { url: 'https://api.teamorouter.com/v1/chat/completions', model: 'deepseek-flash' },
  official: { url: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-flash' },
  oauth: { url: 'https://chatgpt.com/backend-api/codex/responses', model: 'gpt-6-luna' },
}

function createRecoveryFault(route, nativeFetch) {
  if (!Object.hasOwn(routes, route)) throw new Error('Explicit M12 recovery route is required')
  const expected = routes[route]
  let armed = true, allowPaid = false
  const counters = { faulted: 0, forwarded: 0, blockedBeforeContinue: 0, blockedAfterContinue: 0, unrelated: 0 }
  return {
    state() { return { ...counters, armed, allowPaid, route } },
    allowPaidContinuation() {
      if (armed || counters.faulted !== 1 || counters.forwarded !== 0 || counters.unrelated !== 0 || counters.blockedBeforeContinue !== 0)
        throw new Error('M12 paid continuation preflight is incomplete')
      allowPaid = true
    },
    closePaidContinuation() { allowPaid = false },
    async fetch(input, init) {
      const url = String(input instanceof Request ? input.url : input)
      const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
      const candidate = method === 'POST' && url === expected.url
      if (candidate) {
        const raw = init?.body
        if (typeof raw !== 'string' || JSON.parse(raw).model !== expected.model)
          throw new Error('M12 recovery selected model does not match the frozen route')
        if (armed) {
          armed = false
          counters.faulted++
          const cause = Object.assign(new Error('controlled Main transport disconnect'), { code: 'ECONNRESET' })
          throw new TypeError('fetch failed', { cause })
        }
        if (!allowPaid) {
          if (counters.forwarded > 0) counters.blockedAfterContinue++
          else counters.blockedBeforeContinue++
          throw new Error('M12 recovery blocked model POST outside explicit continuation')
        }
        // A single Engine run may require several normal model turns after
        // tool results. No count cap is inferred from the first response.
        counters.forwarded++
      } else if (method === 'POST' && /(?:chat\/completions|\/responses)$/.test(url)) {
        counters.unrelated++
        throw new Error('M12 recovery blocked an unexpected model route')
      }
      return nativeFetch(input, init)
    },
  }
}
module.exports = { createRecoveryFault }
