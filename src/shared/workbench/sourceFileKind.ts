import { isNativeProjectFilename } from '../nativeProjectFile'
import type { DocumentKind } from './document'

/** Source files share the existing TextDriver; structured/binary formats keep their own importers. */
export function sourceFileKind(filename: string): DocumentKind {
  const extension = /(?:^|[\\/])[^\\/]*?(\.[^.\\/]+)$/.exec(filename)?.[1]?.toLowerCase() ?? ''
  if (extension === '.md' || extension === '.markdown') return 'markdown'
  if (isNativeProjectFilename(filename)) return 'course-v10'
  if (/^\.(?:pdf|docx?|pptx?|xlsx?|odt|ods|odp|rtf|zip|7z|rar|gz|tar|png|jpe?g|webp|gif|bmp|ico|avif|mp3|mp4|wav|ogg|webm|mov|ttf|otf|woff2?|exe|dll|so|wasm|sqlite3?|db|bin)$/i.test(extension)) {
    throw new Error('该格式需要相应的文档、素材或二进制入口，不能按 UTF-8 源文编辑')
  }
  return 'text'
}
