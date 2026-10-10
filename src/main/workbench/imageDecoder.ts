import type sharp from 'sharp'
import { diagnosticLog } from '../diagnosticLog'
import { DesktopOperationError } from '../errors'

export class ImageDecoderUnavailableError extends DesktopOperationError {
  constructor(cause: unknown) {
    super('image-decoder-unavailable', '图片操作未完成', '本机图片处理模块暂时无法加载，本次图片操作未完成。',
      '请导出本地诊断并保留本次错误信息；模块恢复后可重试。已有作品和原文件保持不变。', { cause })
    this.name = 'ImageDecoderUnavailableError'
  }
}

/** Native image processing is loaded only by an image operation, never by Main's import graph.
 * Successful loads use Node's module cache; a failed require remains retryable on the next explicit operation.
 */
export function getImageDecoder(): typeof sharp {
  try { return require('sharp') as typeof sharp }
  catch (cause) {
    const error = new ImageDecoderUnavailableError(cause)
    // Keep the original loader cause for this operation and focused startup stderr; default logs remain sanitized.
    try {
      console.error('图片处理模块加载失败', cause)
      void diagnosticLog.append({ source: 'main', message: `${error.message}\n${cause instanceof Error ? cause.message : String(cause)}`, stack: error.stack,
        details: { nativeModule: 'sharp', code: (cause as NodeJS.ErrnoException | null)?.code } }).catch(() => undefined)
    } catch { /* Diagnostics cannot replace the original operation failure. */ }
    throw error
  }
}
