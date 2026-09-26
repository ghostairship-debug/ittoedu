import { createServer } from 'node:http'
import { modelToolWireName } from '../../../src/main/workbench/providers/OpenAIChatProvider'

const FROZEN = '本次固定文档与权限（切换界面不改变它们）：'
interface Frozen { documentId: string; target: string; writable: { kind: string; target: string }[]; selection: { kind: string; target: string }[] }
interface Message { role: string; content?: unknown; tool_call_id?: string }
interface Request { messages: Message[]; tools?: { function: { name: string } }[] }
export interface CardRequest { instruction: string; frozen: Frozen[]; step: string; reply?: string }

const event = (delta: unknown, finish: string | null = null) =>
  `data: ${JSON.stringify({ id: 'm15-cards', model: 'fixture-cards', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
const text = (content: unknown) => typeof content === 'string' ? content : JSON.stringify(content ?? '')
/** A user turn's words: a string, or the text of its content parts. */
const words = (content: unknown) => Array.isArray(content)
  ? content.map(part => part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : '').join(' ')
  : text(content)

/**
 * The model for the element card acceptance. Real HTTP/SSE; every edit is a tool call the real engine and gateway
 * run on the card's one writable target. What the latest request asks for:
 *   改文字：X   read the target, then text.replace it with X (for a table: 加一行, flow.table insert-row)
 *   问我        first ask_user with two options, then write the chosen option
 *   看看        inspect the target and reply
 *   慢          hold the first answer until release(instruction)
 * A request that is not one of these is answered in words only. As a real model does, an edit the engine refuses until
 * the current document is read (a queued request continues the one before it) is made again after reading it.
 */
export async function cardModelServer() {
  const requests: CardRequest[] = []
  const holds = new Map<string, { release(): void; wait: Promise<void> }>()
  let inFlight = 0, maxInFlight = 0
  const hold = (key: string) => {
    let entry = holds.get(key)
    if (!entry) { let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve }); entry = { release, wait }; holds.set(key, entry) }
    return entry
  }
  const server = createServer((request, response) => { void (async () => {
    if (request.url === '/v1/models') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ data: [{ id: 'fixture-selection' }] })); return }
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') throw new Error(`Unexpected fixture route ${request.method} ${request.url}`)
    let body = ''; for await (const chunk of request) body += chunk.toString()
    const data = JSON.parse(body) as Request
    const lastUser = data.messages.map(message => message.role).lastIndexOf('user')
    const instruction = words(data.messages[lastUser]?.content).trim()
    const frozenMessage = [...data.messages].reverse().find(message => typeof message.content === 'string' && message.content.startsWith(FROZEN))
    const frozen: Frozen[] = frozenMessage ? JSON.parse(String(frozenMessage.content).slice(FROZEN.length)) : []
    // This turn's tool results, by the call ids this model gave them.
    const results = new Map<string, unknown>()
    for (const message of data.messages.slice(lastUser + 1)) {
      if (message.role === 'tool' && message.tool_call_id) results.set(message.tool_call_id.replace(/^.*:/, ''), JSON.parse(text(message.content)))
    }
    const tools = new Set(data.tools?.map(tool => tool.function.name) ?? [])
    const turn = `t${lastUser}`
    const call = (name: string, args: unknown, id: string, note: string) => {
      requests.push({ instruction, frozen, step: note })
      response.write(event({ role: 'assistant', tool_calls: [{ index: 0, id: `${turn}:${id}`, type: 'function', function: { name: modelToolWireName(name), arguments: JSON.stringify(args) } }] }, 'tool_calls'))
    }
    const say = (content: string) => { requests.push({ instruction, frozen, step: 'reply', reply: content }); response.write(event({ role: 'assistant', content }, 'stop')) }
    inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight)
    try {
      if (instruction.includes('慢') && results.size === 0) await hold(instruction).wait
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const target = frozen[0]?.writable[0]
      const table = instruction.includes('加一行')
      const edit = instruction.match(/改文字：(.+)$/)?.[1]?.trim()
      const ask = instruction.includes('问我')
      const writeTool = table ? 'flow.table' : 'text.replace'
      const read = results.get('read') as { kind?: string; data?: { target?: string; text?: string } } | undefined
      const answer = results.get('ask')
      const unobserved = (value: unknown) => (value as { code?: string } | undefined)?.code === 'resume-observation-required'
      const write = (id: string) => {
        const handle = read?.data?.target ?? target!.target
        const chosen = ask ? (JSON.stringify(answer).includes('说法乙') ? '说法乙' : '说法甲') : edit
        if (table) call('flow.table', { target: handle, change: { kind: 'insert-row' } }, id, 'edit')
        else call('text.replace', { target: handle, content: chosen }, id, 'edit')
      }
      if (!target) say('没有可以修改的对象。')
      else if (instruction.includes('看看')) {
        if (!results.has('inspect')) call('inspect', { target: target.target }, 'inspect', 'inspect')
        else say(`看过了：${JSON.stringify(results.get('inspect')).slice(0, 60)}`)
      } else if (!edit && !table && !ask) say('好的，我没有改动。')
      else if ((edit || table || ask) && !tools.has(modelToolWireName(writeTool)) && !results.has('load')) call('tools.load', { families: ['content', 'layout'] }, 'load', 'load')
      else if (ask && !results.has('ask')) call('ask_user', { question: '用哪一种说法？', options: [{ label: '说法甲' }, { label: '说法乙' }] }, 'ask', 'ask')
      else if (!results.has('read')) call('read', { target: target.target, limit: 100 }, 'read', 'read')
      else if (!results.has('edit')) write('edit')
      else if (unobserved(results.get('edit')) && !results.has('observe')) call('read', { target: frozen[0]!.target, limit: 100 }, 'observe', 'observe')
      else if (unobserved(results.get('edit')) && !results.has('again')) write('again')
      else {
        const result = (results.get('again') ?? results.get('edit')) as { kind?: string; result?: { status?: string } } | undefined
        say(result?.kind === 'document-operation' && result.result?.status === 'applied' ? '已修改。' : `没有改成：${JSON.stringify(result).slice(0, 120)}`)
      }
      response.end('data: [DONE]\n\n')
    } catch (error) {
      if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: { message: String(error) } }))
    } finally { inFlight -= 1 }
  })().catch(error => { if (!response.headersSent) response.writeHead(500); response.end(String(error)) }) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return {
    endpoint: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`,
    requests,
    get maxInFlight() { return maxInFlight },
    get inFlight() { return inFlight },
    /** Lets a held (慢) request answer. */
    release(instruction: string) { hold(instruction).release() },
    async close() {
      for (const entry of holds.values()) entry.release()
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
    },
  }
}
