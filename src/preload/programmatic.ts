import { contextBridge, ipcRenderer } from 'electron'

interface RuntimeInput {
  code: string
  definitions: readonly { name: string; description: string; inputSchema: Record<string, unknown> }[]
}
type RuntimeReply = { status: 'completed'; valueJSON: string } | { status: 'failed'; error: string }
interface ToolReply { callId: number; ok: boolean; resultJSON?: string; error?: string }

// One job and one tool bridge only; no generic IPC or host API enters the page.
let started = false
contextBridge.exposeInMainWorld('programmaticRuntimeAPI', {
  run(execute: (input: RuntimeInput, bridge: { call(name: string, inputJSON: string): Promise<string> }) => Promise<RuntimeReply>): void {
    if (started) throw new Error('Programmatic runtime already started')
    started = true
    let sequence = 0
    const pending = new Map<number, { resolve(value: string): void; reject(error: Error): void }>()
    ipcRenderer.on('programmatic:tool-result', (_event, reply: ToolReply) => {
      const callback = pending.get(reply?.callId)
      if (!callback) return
      pending.delete(reply.callId)
      if (reply.ok && typeof reply.resultJSON === 'string') callback.resolve(reply.resultJSON)
      else callback.reject(new Error(reply.error || 'Tool execution failed'))
    })
    ipcRenderer.once('programmatic:input', async (_event, input: RuntimeInput) => {
      try {
        const reply = await execute(input, {
          call(name, inputJSON) {
            const callId = ++sequence
            return new Promise<string>((resolve, reject) => {
              pending.set(callId, { resolve, reject })
              ipcRenderer.send('programmatic:call', { callId, name, inputJSON })
            })
          },
        })
        ipcRenderer.send('programmatic:result', reply)
      } catch (error) {
        ipcRenderer.send('programmatic:result', { status: 'failed', error: error instanceof Error ? error.message : String(error) })
      }
    })
    ipcRenderer.send('programmatic:ready')
  },
})
