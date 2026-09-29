import type { ExecutionEventInput } from '../../../shared/workbench/executionEvents'

/** Bounded display-only batching. The ordinary EventStore still publishes only after its real durable ACK. */
export class DisplayEventBuffer {
  private pending: ExecutionEventInput[] = []
  private bytes = 0
  private queuedBytes = 0
  private timer?: ReturnType<typeof setTimeout>
  private tail: Promise<void> = Promise.resolve()
  private failure?: unknown
  constructor(private readonly append: (inputs: ExecutionEventInput[]) => Promise<void>,
    private readonly intervalMs = 60, private readonly maximumBytes = 32 * 1024) {}
  async push(input: ExecutionEventInput): Promise<void> {
    this.throwFailure()
    if (!['text', 'reasoning', 'tool'].includes(input.type) || input.data.status !== 'running')
      throw new Error('只有运行中的显示增量可以进入缓冲，正式状态与提交必须直接持久化')
    const previous = this.pending.at(-1)
    if (previous && previous.itemId === input.itemId && previous.type === input.type && previous.update === input.update) {
      this.pending[this.pending.length - 1] = { ...input, data: { ...previous.data, ...input.data,
        ...(input.update === 'append' ? { text: (previous.data.text ?? '') + (input.data.text ?? '') } : {}) } }
    } else this.pending.push(input)
    this.bytes += Buffer.byteLength(JSON.stringify(input), 'utf8')
    if (this.bytes + this.queuedBytes >= this.maximumBytes) await this.flush()
    else if (!this.timer) this.timer = setTimeout(() => { this.timer = undefined; this.schedule() }, this.intervalMs)
  }
  private schedule(): void {
    clearTimeout(this.timer); this.timer = undefined
    const inputs = this.pending, bytes = this.bytes
    this.queuedBytes += bytes
    this.pending = []; this.bytes = 0
    if (!inputs.length) return
    this.tail = this.tail.then(() => this.append(inputs)).catch(error => { this.failure ??= error })
      .finally(() => { this.queuedBytes -= bytes })
  }
  private throwFailure(): void {
    if (this.failure !== undefined) {
      const error = this.failure; this.failure = undefined
      throw error
    }
  }
  /** Called before every control/tool/commit/terminal event and checkpoint. No successful fact overtakes display. */
  async flush(): Promise<void> {
    this.schedule()
    await this.tail
    this.throwFailure()
  }
}
