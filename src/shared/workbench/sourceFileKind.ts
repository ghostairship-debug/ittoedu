import { isNativeProjectFilename } from '../nativeProjectFile'
import type { DocumentKind } from './document'

export type FileOpenKind = 'project' | 'document' | 'media' | 'presentation' | 'word' | 'external' | 'blocked'
export interface FileCapabilities {
  /** The default action shared by the file tree and launch arguments. */
  openKind: FileOpenKind
  /** AI and human source editing use the same driver eligibility. */
  sourceKind: DocumentKind | null
  /** Source scripts may be edited but must never be passed to their OS execution association. */
  externalOpenAllowed: boolean
}

const executableExtensions = new Set('exe com scr msi msp msix msixbundle appx appxbundle cpl jar apk appimage pkg deb rpm lnk url webloc'.split(' '))
const scriptExtensions = new Set('bat cmd ps1 psm1 psd1 vbs vbe js jse mjs cjs wsf wsh sh bash zsh fish py pyw pl rb php lua reg scpt command desktop'.split(' '))
const mediaExtensions = new Set('pdf png jpg jpeg webp avif gif svg'.split(' '))
const binaryExtensions = new Set('doc docx docm dot dotx dotm ppt pptx pptm pps ppsx ppsm pot potx potm xls xlsx xlsm xlsb xlt xltx xltm odt ods odp rtf zip 7z rar gz tgz bz2 tbz2 xz lz lzma zst tar cab iso img dmg bmp ico tif tiff heic heif psd mp3 mp4 m4a m4v wav ogg flac aac opus wma avi webm mov mkv ttf otf eot woff woff2 wasm sqlite sqlite3 db bin dat dll sys drv so dylib node class pyc pyo o obj a lib pdb lockb'.split(' '))

/** Unknown and extensionless files are candidates only; TextDriver validates their actual bytes. */
export function fileCapabilities(filename: string): FileCapabilities {
  if (isNativeProjectFilename(filename)) return { openKind: 'project', sourceKind: 'course-v10', externalOpenAllowed: true }
  const extension = /(?:^|[\\/])[^\\/]*?\.([^.\\/]+)$/.exec(filename)?.[1]?.toLowerCase() ?? ''
  if (extension === 'md' || extension === 'markdown') return { openKind: 'document', sourceKind: 'markdown', externalOpenAllowed: true }
  if (executableExtensions.has(extension)) return { openKind: 'blocked', sourceKind: null, externalOpenAllowed: false }
  // SVG remains editable source for AI while its default human surface is the existing image preview.
  if (mediaExtensions.has(extension)) return { openKind: 'media', sourceKind: extension === 'svg' ? 'text' : null, externalOpenAllowed: true }
  if (extension === 'pptx') return { openKind: 'presentation', sourceKind: null, externalOpenAllowed: true }
  if (extension === 'docx') return { openKind: 'word', sourceKind: null, externalOpenAllowed: true }
  if (binaryExtensions.has(extension)) return { openKind: 'external', sourceKind: null, externalOpenAllowed: true }
  return { openKind: 'document', sourceKind: 'text', externalOpenAllowed: !scriptExtensions.has(extension) }
}

/** Source files share TextDriver; structured/binary formats keep their own importers. */
export function sourceFileKind(filename: string): DocumentKind {
  const capability = fileCapabilities(filename)
  if (capability.sourceKind) return capability.sourceKind
  if (capability.openKind === 'blocked') throw new Error('可执行文件或系统快捷方式不能在果铃中打开或运行')
  throw new Error('该格式需要相应的文档、素材或二进制入口，不能按 UTF-8 源文编辑')
}
