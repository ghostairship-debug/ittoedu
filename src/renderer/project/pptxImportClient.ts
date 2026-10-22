import type { PptxImportBuildInput, PptxImportBuildResult } from '../../shared/workbench/pptxImport'
type Input = Omit<Extract<PptxImportBuildInput, { mode: 'course' }>, 'requestId'> | Omit<Extract<PptxImportBuildInput, { mode: 'draft' }>, 'requestId'>

async function build(input: Input, signal?: AbortSignal): Promise<PptxImportBuildResult> {
  const api = window.desktopAPI
  if (!api?.buildPptxImport) throw new Error('PPTX 隔离转换服务不可用，请重新打开应用')
  signal?.throwIfAborted()
  const requestId = crypto.randomUUID()
  const abort = () => { void api.cancelPptxImport?.({ requestId }).catch(() => undefined) }
  signal?.addEventListener('abort', abort, { once: true })
  try {
    signal?.throwIfAborted()
    const result = await api.buildPptxImport({ ...input, requestId })
    signal?.throwIfAborted()
    if (result.mode !== input.mode) throw new Error('PPTX 转换结果模式与请求不一致')
    return result
  } finally { signal?.removeEventListener('abort', abort) }
}
export async function preparePptxCourseOffThread(bytes: Uint8Array, filename: string, signal?: AbortSignal) {
  const result = await build({ mode: 'course', bytes, filename }, signal)
  if (result.mode !== 'course') throw new Error('PPTX 转换没有产生工程')
  return result.course
}
export async function parsePptxImportOffThread(bytes: Uint8Array, filename: string, canvas: { width: number; height: number }, signal?: AbortSignal) {
  const result = await build({ mode: 'draft', bytes, filename, canvas }, signal)
  if (result.mode !== 'draft') throw new Error('PPTX 转换没有产生页面草稿')
  return result.draft
}
