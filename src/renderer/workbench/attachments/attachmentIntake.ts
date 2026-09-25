import type { AttachmentSnapshot } from '../../../shared/workbench/attachments'
export type IntakeState = 'queued' | 'reading' | 'preparing' | 'failed' | 'cancelled'
export interface IntakeJob {
  id: string; name: string; state: IntakeState; progress?: number; error?: string
  authorizationId?: string
  run(signal: AbortSignal, progress: (loaded: number, total: number) => void, requestId: string): Promise<AttachmentSnapshot>
}
/** FileReader keeps memory screenshots path-free and provides real byte progress/cancellation. */
export function readAttachmentFile(file: File, signal: AbortSignal, progress: (loaded: number, total: number) => void): Promise<Uint8Array> {
  if (file.size > 32 * 1024 * 1024) return Promise.reject(new Error(`${file.name} 超过 32 MiB 接收上限`))
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const reader = new FileReader(), cancel = () => reader.abort()
    signal.addEventListener('abort', cancel, { once: true })
    const finish = () => signal.removeEventListener('abort', cancel)
    reader.onprogress = event => progress(event.loaded, event.lengthComputable ? event.total : file.size)
    reader.onerror = () => { finish(); reject(new Error('文件读取失败，请重试')) }
    reader.onabort = () => { finish(); reject(new Error('附件处理已取消')) }
    reader.onload = () => { finish(); if (signal.aborted) reject(new Error('附件处理已取消')); else { progress(file.size, file.size); resolve(new Uint8Array(reader.result as ArrayBuffer)) } }
    reader.readAsArrayBuffer(file)
  })
}
