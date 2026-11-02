/** Only these fixed messages may cross the desktop boundary to the user. */
export const WORD_PREVIEW_MESSAGES = {
  network: 'Word 排版环境下载失败，请检查网络连接后重新载入。',
  integrity: 'Word 排版环境校验失败，未运行下载内容；请重新载入重试。',
  component: '此设备尚无可用的 Word 排版环境；自动准备支持 Windows x64，请检查安装包是否完整。',
  extraction: 'Word 排版环境展开失败，请检查可用空间后重新载入。',
  conversion: 'Word 分页预览未完成，请检查文稿是否可正常打开后重试。',
  invalid_document: '此预览入口需要有效的 DOCX 原件，请检查文稿后重试。',
} as const

export type WordPreviewErrorCode = keyof typeof WORD_PREVIEW_MESSAGES
export class WordPreviewError extends Error {
  constructor(readonly code: WordPreviewErrorCode) {
    super(WORD_PREVIEW_MESSAGES[code])
    this.name = 'WordPreviewError'
  }
}

/** Cancellation must retain the original reason; unexpected errors stay private. */
export function throwWordPreviewError(signal: AbortSignal | undefined, code: WordPreviewErrorCode): never {
  signal?.throwIfAborted()
  throw new WordPreviewError(code)
}
