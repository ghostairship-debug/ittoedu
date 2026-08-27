import crypto from 'node:crypto'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { dialog, type BrowserWindow } from 'electron'
import type {
  BatchFileDigest,
  BatchFileRejection,
  OpenProjectFileResult,
  OpenBinaryFileResult,
  SaveBinaryFileInput,
  SaveBinaryFileResult,
  SelectedFileBatch,
  SelectedImageResult,
  SelectedMediaResult,
} from '../shared/ipcTypes'
import {
  DesktopOperationError,
  normalizeDesktopError,
  type DesktopErrorPayload,
} from './errors'
import {
  recordRecentProject,
  resolveRecentProjectPath,
} from './projectPersistence'

const MAX_PROJECT_BYTES = 256 * 1024 * 1024
const MAX_IMAGE_BYTES = 100 * 1024 * 1024
const MAX_AUDIO_BYTES = 100 * 1024 * 1024
const MAX_VIDEO_BYTES = 200 * 1024 * 1024
const MAX_COMPONENT_BYTES = 50 * 1024 * 1024
const MAX_BATCH_FILES = 100
const MAX_IMAGE_BATCH_BYTES = 256 * 1024 * 1024
const MAX_AUDIO_BATCH_BYTES = 256 * 1024 * 1024
const MAX_VIDEO_BATCH_BYTES = 256 * 1024 * 1024
const MAX_COMPONENT_BATCH_BYTES = 256 * 1024 * 1024
const MAX_HTML_BYTES = 256 * 1024 * 1024
const MAX_EXPORT_BYTES = 512 * 1024 * 1024
const MAX_PROJECT_OPEN_CONFIRMATIONS = 64

export function batchCapacityIssue(
  selectedIndex: number,
  acceptedByteLength: number,
  candidateByteLength: number,
  maximumTotalBytes: number,
): 'BATCH_FILE_COUNT_LIMIT' | 'BATCH_TOTAL_SIZE_LIMIT' | null {
  if (selectedIndex >= MAX_BATCH_FILES) return 'BATCH_FILE_COUNT_LIMIT'
  if (acceptedByteLength + candidateByteLength > maximumTotalBytes) {
    return 'BATCH_TOTAL_SIZE_LIMIT'
  }
  return null
}

const imageMimeTypes = new Map<string, string>([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.svg', 'image/svg+xml'],
])

const audioMimeTypes = new Map<string, string>([
  ['.mp3', 'audio/mpeg'],
  ['.ogg', 'audio/ogg'],
  ['.wav', 'audio/wav'],
  ['.m4a', 'audio/mp4'],
])

const videoMimeTypes = new Map<string, string>([
  ['.mp4', 'video/mp4'],
  ['.webm', 'video/webm'],
])

const approvedProjectPaths = new Set<string>()

interface ProjectOpenConfirmation {
  path: string
  recordPromise: Promise<void> | null
}

const projectOpenConfirmations = new Map<string, ProjectOpenConfirmation>()

function canonicalPath(value: string): string {
  const resolved = path.resolve(value)
  return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved
}

function rememberProjectPath(value: string): void {
  approvedProjectPaths.add(canonicalPath(value))
}

async function recordRecentProjectSafely(value: string): Promise<void> {
  await recordRecentProject(value).catch((error) => {
    console.error('更新最近工程列表失败', error)
  })
}

async function rememberSavedProject(value: string): Promise<void> {
  rememberProjectPath(value)
  await recordRecentProjectSafely(value)
}

function issueProjectOpenConfirmation(value: string): string {
  const confirmationId = crypto.randomUUID()
  projectOpenConfirmations.set(confirmationId, {
    path: path.resolve(value),
    recordPromise: null,
  })
  while (projectOpenConfirmations.size > MAX_PROJECT_OPEN_CONFIRMATIONS) {
    const oldestId = projectOpenConfirmations.keys().next().value
    if (typeof oldestId !== 'string') break
    projectOpenConfirmations.delete(oldestId)
  }
  return confirmationId
}

export async function confirmProjectOpen(confirmationId: string): Promise<void> {
  const confirmation = projectOpenConfirmations.get(confirmationId)
  if (!confirmation) {
    throw new DesktopOperationError(
      'PROJECT_OPEN_CONFIRMATION_INVALID',
      '工程打开确认失败',
      '本次工程打开确认已失效。',
      '工程仍可继续编辑；如果最近工程未更新，请重新打开一次。',
    )
  }
  confirmation.recordPromise ??= recordRecentProjectSafely(confirmation.path)
  await confirmation.recordPromise
}

function isApprovedProjectPath(value: string): boolean {
  return approvedProjectPaths.has(canonicalPath(value))
}

function sanitizeSuggestedName(value: string, extension: string): string {
  const fallback = `未命名课件${extension}`
  const baseName = path
    .basename(value)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 120)

  if (!baseName) return fallback
  return baseName.toLocaleLowerCase('en-US').endsWith(extension)
    ? baseName
    : `${baseName}${extension}`
}

function ensureExtension(filePath: string, extension: string): string {
  return filePath.toLocaleLowerCase('en-US').endsWith(extension)
    ? filePath
    : `${filePath}${extension}`
}

async function readFileWithLimit(
  filePath: string,
  limit: number,
  errorTitle: string,
  errorCode: string,
): Promise<Uint8Array> {
  let stats
  try {
    stats = await fs.stat(filePath)
  } catch (error) {
    throw new DesktopOperationError(
      errorCode,
      errorTitle,
      '无法读取所选文件。',
      '请确认文件仍然存在、未被其他程序占用，然后重试。',
      { cause: error },
    )
  }

  if (!stats.isFile()) {
    throw new DesktopOperationError(
      errorCode,
      errorTitle,
      '所选项目不是普通文件。',
      '请选择本机磁盘上的有效文件。',
    )
  }
  if (stats.size > limit) {
    throw new DesktopOperationError(
      'FILE_TOO_LARGE',
      errorTitle,
      `所选文件超过 ${Math.round(limit / 1024 / 1024)} MB 限制。`,
      '请压缩或精简文件内容后重试。',
    )
  }

  try {
    return new Uint8Array(await fs.readFile(filePath))
  } catch (error) {
    throw new DesktopOperationError(
      errorCode,
      errorTitle,
      '读取所选文件时发生错误。',
      '请确认文件可访问且没有损坏，然后重试。',
      { cause: error },
    )
  }
}

function hasZipSignature(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    ((bytes[2] === 0x03 && bytes[3] === 0x04) ||
      (bytes[2] === 0x05 && bytes[3] === 0x06) ||
      (bytes[2] === 0x07 && bytes[3] === 0x08))
  )
}

function imageMatchesMime(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === 'image/png') {
    return (
      bytes.byteLength >= 8 &&
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
        (value, index) => bytes[index] === value,
      )
    )
  }
  if (mimeType === 'image/jpeg') {
    return bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  }
  if (mimeType === 'image/gif') {
    const signature = Buffer.from(bytes.subarray(0, 6)).toString('ascii')
    return signature === 'GIF87a' || signature === 'GIF89a'
  }
  if (mimeType === 'image/webp') {
    return (
      bytes.byteLength >= 12 &&
      Buffer.from(bytes.subarray(0, 4)).toString('ascii') === 'RIFF' &&
      Buffer.from(bytes.subarray(8, 12)).toString('ascii') === 'WEBP'
    )
  }
  if (mimeType === 'image/svg+xml') {
    const prefix = Buffer.from(bytes.subarray(0, 64 * 1024))
      .toString('utf8')
      .replace(/^\uFEFF/, '')
    return /<svg(?:\s|>)/i.test(prefix)
  }
  return false
}

function mediaMatchesMime(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === 'audio/mpeg') {
    return bytes.byteLength >= 3 && (
      Buffer.from(bytes.subarray(0, 3)).toString('ascii') === 'ID3' ||
      (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
    )
  }
  if (mimeType === 'audio/ogg') {
    return bytes.byteLength >= 4 && Buffer.from(bytes.subarray(0, 4)).toString('ascii') === 'OggS'
  }
  if (mimeType === 'audio/wav') {
    return bytes.byteLength >= 12 &&
      Buffer.from(bytes.subarray(0, 4)).toString('ascii') === 'RIFF' &&
      Buffer.from(bytes.subarray(8, 12)).toString('ascii') === 'WAVE'
  }
  if (mimeType === 'audio/mp4' || mimeType === 'video/mp4') {
    return bytes.byteLength >= 12 && Buffer.from(bytes.subarray(4, 8)).toString('ascii') === 'ftyp'
  }
  if (mimeType === 'video/webm') {
    return bytes.byteLength >= 4 &&
      bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3
  }
  return false
}

function fileDigest(bytes: Uint8Array): string {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

function rejectedFile(
  filePath: string,
  error: unknown,
  fallback: DesktopErrorPayload,
): BatchFileRejection {
  const normalized = normalizeDesktopError(error, fallback)
  return {
    path: filePath,
    name: path.basename(filePath),
    ...normalized,
  }
}

interface SelectFileBatchOptions<T extends OpenBinaryFileResult> {
  title: string
  filters: Array<{ name: string; extensions: string[] }>
  maximumTotalBytes: number
  totalLimitLabel: string
  fallback: DesktopErrorPayload
  read(filePath: string): Promise<T>
}

async function selectFileBatch<T extends OpenBinaryFileResult>(
  window: BrowserWindow,
  options: SelectFileBatchOptions<T>,
): Promise<SelectedFileBatch<T & BatchFileDigest> | null> {
  const result = await dialog.showOpenDialog(window, {
    title: options.title,
    filters: options.filters,
    properties: ['openFile', 'multiSelections', 'dontAddToRecent'],
  })
  if (result.canceled || result.filePaths.length === 0) return null

  const accepted: Array<T & BatchFileDigest> = []
  const rejected: BatchFileRejection[] = []
  let acceptedByteLength = 0
  for (const [index, filePath] of result.filePaths.entries()) {
    if (
      batchCapacityIssue(index, acceptedByteLength, 0, options.maximumTotalBytes) ===
      'BATCH_FILE_COUNT_LIMIT'
    ) {
      rejected.push(rejectedFile(
        filePath,
        new DesktopOperationError(
          'BATCH_FILE_COUNT_LIMIT',
          '批量导入数量过多',
          `一次最多选择 ${MAX_BATCH_FILES} 个文件。`,
          '请分成多个批次导入。',
        ),
        options.fallback,
      ))
      continue
    }
    try {
      const file = await options.read(filePath)
      if (
        batchCapacityIssue(
          index,
          acceptedByteLength,
          file.bytes.byteLength,
          options.maximumTotalBytes,
        ) === 'BATCH_TOTAL_SIZE_LIMIT'
      ) {
        throw new DesktopOperationError(
          'BATCH_TOTAL_SIZE_LIMIT',
          '批量导入总大小超限',
          `加入“${file.name}”后会超过本批 ${options.totalLimitLabel} 限制。`,
          '请减少本次文件数量，或先压缩大文件。',
        )
      }
      acceptedByteLength += file.bytes.byteLength
      accepted.push({ ...file, sha256: fileDigest(file.bytes) })
    } catch (error) {
      rejected.push(rejectedFile(filePath, error, options.fallback))
    }
  }

  return {
    selectedCount: result.filePaths.length,
    acceptedByteLength,
    accepted,
    rejected,
  }
}

async function atomicWrite(filePath: string, data: Uint8Array | string): Promise<void> {
  const directory = path.dirname(filePath)
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${crypto.randomUUID()}.tmp`,
  )

  try {
    await fs.writeFile(temporaryPath, data, { flag: 'wx' })
    await fs.rename(temporaryPath, filePath)
  } catch (error) {
    await fs.unlink(temporaryPath).catch(() => undefined)
    throw error
  }
}

export async function openProjectFile(
  window: BrowserWindow,
): Promise<OpenProjectFileResult | null> {
  const result = await dialog.showOpenDialog(window, {
    title: '打开课件工程',
    filters: [{ name: '课件工程', extensions: ['h5lesson'] }],
    properties: ['openFile', 'dontAddToRecent'],
  })
  if (result.canceled || result.filePaths.length === 0) return null

  const filePath = result.filePaths[0]
  const bytes = await readFileWithLimit(
    filePath,
    MAX_PROJECT_BYTES,
    '工程打开失败',
    'PROJECT_READ_FAILED',
  )
  if (!hasZipSignature(bytes)) {
    throw new DesktopOperationError(
      'PROJECT_ARCHIVE_INVALID',
      '工程打开失败',
      '所选文件不是有效的课件工程，或文件已经损坏。',
      '请重新选择 .h5lesson 文件，或从备份恢复该工程。',
    )
  }

  rememberProjectPath(filePath)
  return {
    path: filePath,
    name: path.basename(filePath),
    bytes,
    confirmationId: issueProjectOpenConfirmation(filePath),
  }
}

export async function openRecentProjectFile(
  requestedPath: string,
): Promise<OpenProjectFileResult> {
  const filePath = await resolveRecentProjectPath(requestedPath)
  const bytes = await readFileWithLimit(
    filePath,
    MAX_PROJECT_BYTES,
    '最近工程打开失败',
    'PROJECT_READ_FAILED',
  )
  if (!hasZipSignature(bytes)) {
    throw new DesktopOperationError(
      'PROJECT_ARCHIVE_INVALID',
      '最近工程打开失败',
      '该文件不是有效的课件工程，或文件已经损坏。',
      '请从备份恢复该工程，或将它从最近工程列表中移除。',
    )
  }

  rememberProjectPath(filePath)
  return {
    path: filePath,
    name: path.basename(filePath),
    bytes,
    confirmationId: issueProjectOpenConfirmation(filePath),
  }
}

export async function saveProjectFile(
  window: BrowserWindow,
  input: SaveBinaryFileInput,
): Promise<SaveBinaryFileResult | null> {
  if (input.bytes.byteLength > MAX_PROJECT_BYTES) {
    throw new DesktopOperationError(
      'PROJECT_TOO_LARGE',
      '工程保存失败',
      '课件工程超过 256 MB 保存限制。',
      '请删除未使用的大图片或组件资源后重试。',
    )
  }
  if (!hasZipSignature(input.bytes)) {
    throw new DesktopOperationError(
      'PROJECT_ARCHIVE_INVALID',
      '工程保存失败',
      '待保存的工程数据不是有效的工程包。',
      '请取消本次操作，重新打开工程后再试。',
    )
  }

  let targetPath =
    input.path &&
    path.extname(input.path).toLocaleLowerCase('en-US') === '.h5lesson' &&
    isApprovedProjectPath(input.path)
      ? input.path
      : undefined

  if (!targetPath) {
    const result = await dialog.showSaveDialog(window, {
      title: '保存课件工程',
      defaultPath: sanitizeSuggestedName(input.suggestedName, '.h5lesson'),
      filters: [{ name: '课件工程', extensions: ['h5lesson'] }],
      properties: ['showOverwriteConfirmation', 'dontAddToRecent'],
    })
    if (result.canceled || !result.filePath) return null
    targetPath = ensureExtension(result.filePath, '.h5lesson')
  }

  try {
    await atomicWrite(targetPath, input.bytes)
  } catch (error) {
    throw new DesktopOperationError(
      'PROJECT_SAVE_FAILED',
      '工程保存失败',
      '课件工程未能写入所选位置。',
      '请确认文件未被占用并选择有足够空间的位置后重试。',
      { cause: error },
    )
  }

  await rememberSavedProject(targetPath)
  return { path: targetPath }
}

async function readImageSelection(filePath: string): Promise<SelectedImageResult> {
  const mimeType = imageMimeTypes.get(path.extname(filePath).toLocaleLowerCase('en-US'))
  if (!mimeType) {
    throw new DesktopOperationError(
      'IMAGE_TYPE_UNSUPPORTED',
      '图片导入失败',
      '所选图片类型不受支持。',
      '请选择 PNG、JPEG、WebP、GIF 或 SVG 图片。',
    )
  }

  const bytes = await readFileWithLimit(
    filePath,
    MAX_IMAGE_BYTES,
    '图片读取失败',
    'IMAGE_READ_FAILED',
  )
  if (!imageMatchesMime(bytes, mimeType)) {
    throw new DesktopOperationError(
      'IMAGE_CONTENT_INVALID',
      '图片导入失败',
      '图片内容与文件扩展名不匹配，或文件已经损坏。',
      '请使用图片软件重新导出后再试。',
    )
  }

  return { path: filePath, name: path.basename(filePath), mimeType, bytes }
}

export async function selectImageFile(
  window: BrowserWindow,
): Promise<SelectedImageResult | null> {
  const result = await dialog.showOpenDialog(window, {
    title: '选择图片',
    filters: [
      { name: '支持的图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'] },
    ],
    properties: ['openFile', 'dontAddToRecent'],
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return readImageSelection(result.filePaths[0])
}

export function selectImageFiles(
  window: BrowserWindow,
): Promise<SelectedFileBatch<SelectedImageResult & BatchFileDigest> | null> {
  return selectFileBatch(window, {
    title: '批量选择图片',
    filters: [
      { name: '支持的图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'] },
    ],
    maximumTotalBytes: MAX_IMAGE_BATCH_BYTES,
    totalLimitLabel: '256 MB',
    fallback: {
      code: 'IMAGE_READ_FAILED',
      title: '图片导入失败',
      message: '无法读取所选图片。',
      suggestion: '请确认图片格式正确并重试。',
    },
    read: readImageSelection,
  })
}

async function readMediaSelection(
  filePath: string,
  kind: 'audio' | 'video',
): Promise<SelectedMediaResult> {
  const audio = kind === 'audio'
  const mimeTypes = audio ? audioMimeTypes : videoMimeTypes
  const label = audio ? '声音' : '视频'
  const mimeType = mimeTypes.get(path.extname(filePath).toLocaleLowerCase('en-US'))
  if (!mimeType) {
    throw new DesktopOperationError(
      `${kind.toUpperCase()}_TYPE_UNSUPPORTED`,
      `${label}导入失败`,
      `所选${label}类型不受支持。`,
      audio ? '请选择 MP3、OGG、WAV 或 M4A。' : '请选择 MP4 或 WebM。',
    )
  }
  const bytes = await readFileWithLimit(
    filePath,
    audio ? MAX_AUDIO_BYTES : MAX_VIDEO_BYTES,
    `${label}读取失败`,
    `${kind.toUpperCase()}_READ_FAILED`,
  )
  if (!mediaMatchesMime(bytes, mimeType)) {
    throw new DesktopOperationError(
      `${kind.toUpperCase()}_CONTENT_INVALID`,
      `${label}导入失败`,
      `${label}内容与扩展名不匹配，或文件已经损坏。`,
      `请重新编码为受支持的${label}格式后再试。`,
    )
  }
  return { path: filePath, name: path.basename(filePath), mimeType, bytes }
}

async function selectMediaFile(
  window: BrowserWindow,
  kind: 'audio' | 'video',
): Promise<SelectedMediaResult | null> {
  const audio = kind === 'audio'
  const extensions = audio ? ['mp3', 'ogg', 'wav', 'm4a'] : ['mp4', 'webm']
  const label = audio ? '声音' : '视频'
  const result = await dialog.showOpenDialog(window, {
    title: `选择${label}`,
    filters: [{ name: `支持的${label}`, extensions }],
    properties: ['openFile', 'dontAddToRecent'],
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return readMediaSelection(result.filePaths[0], kind)
}

export function selectAudioFile(window: BrowserWindow): Promise<SelectedMediaResult | null> {
  return selectMediaFile(window, 'audio')
}

export function selectVideoFile(window: BrowserWindow): Promise<SelectedMediaResult | null> {
  return selectMediaFile(window, 'video')
}

function selectMediaFiles(
  window: BrowserWindow,
  kind: 'audio' | 'video',
): Promise<SelectedFileBatch<SelectedMediaResult & BatchFileDigest> | null> {
  const audio = kind === 'audio'
  const label = audio ? '声音' : '视频'
  return selectFileBatch(window, {
    title: `批量选择${label}`,
    filters: [{
      name: `支持的${label}`,
      extensions: audio ? ['mp3', 'ogg', 'wav', 'm4a'] : ['mp4', 'webm'],
    }],
    maximumTotalBytes: audio ? MAX_AUDIO_BATCH_BYTES : MAX_VIDEO_BATCH_BYTES,
    totalLimitLabel: '256 MB',
    fallback: {
      code: `${kind.toUpperCase()}_READ_FAILED`,
      title: `${label}导入失败`,
      message: `无法读取所选${label}。`,
      suggestion: audio
        ? '请确认声音格式正确并重试。'
        : '请确认视频格式正确并重试。',
    },
    read: (filePath) => readMediaSelection(filePath, kind),
  })
}

export function selectAudioFiles(
  window: BrowserWindow,
): Promise<SelectedFileBatch<SelectedMediaResult & BatchFileDigest> | null> {
  return selectMediaFiles(window, 'audio')
}

export function selectVideoFiles(
  window: BrowserWindow,
): Promise<SelectedFileBatch<SelectedMediaResult & BatchFileDigest> | null> {
  return selectMediaFiles(window, 'video')
}

async function readComponentSelection(filePath: string): Promise<OpenBinaryFileResult> {
  const bytes = await readFileWithLimit(
    filePath,
    MAX_COMPONENT_BYTES,
    '组件导入失败',
    'COMPONENT_READ_FAILED',
  )
  if (!hasZipSignature(bytes)) {
    throw new DesktopOperationError(
      'COMPONENT_ARCHIVE_INVALID',
      '组件导入失败',
      '所选文件不是有效的组件包，或文件已经损坏。',
      '请让组件作者重新生成 .h5component 文件后再试。',
    )
  }

  return { path: filePath, name: path.basename(filePath), bytes }
}

export async function selectComponentFile(
  window: BrowserWindow,
): Promise<OpenBinaryFileResult | null> {
  const result = await dialog.showOpenDialog(window, {
    title: '导入互动组件',
    filters: [{ name: '课件互动组件', extensions: ['h5component'] }],
    properties: ['openFile', 'dontAddToRecent'],
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return readComponentSelection(result.filePaths[0])
}

export function selectComponentFiles(
  window: BrowserWindow,
): Promise<SelectedFileBatch<OpenBinaryFileResult & BatchFileDigest> | null> {
  return selectFileBatch(window, {
    title: '批量导入互动组件',
    filters: [{ name: '课件互动组件', extensions: ['h5component'] }],
    maximumTotalBytes: MAX_COMPONENT_BATCH_BYTES,
    totalLimitLabel: '256 MB',
    fallback: {
      code: 'COMPONENT_READ_FAILED',
      title: '组件导入失败',
      message: '无法读取所选组件包。',
      suggestion: '请确认 .h5component 文件有效并重试。',
    },
    read: readComponentSelection,
  })
}

export async function writeHtmlFile(
  window: BrowserWindow,
  suggestedName: string,
  html: string,
): Promise<{ path: string } | null> {
  if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
    throw new DesktopOperationError(
      'HTML_TOO_LARGE',
      'HTML 导出失败',
      '导出内容超过 256 MB 限制。',
      '请删除未使用的大图片或组件资源后重试。',
    )
  }

  const result = await dialog.showSaveDialog(window, {
    title: '导出单 HTML 课件',
    defaultPath: sanitizeSuggestedName(suggestedName, '.html'),
    filters: [{ name: 'HTML 课件', extensions: ['html'] }],
    properties: ['showOverwriteConfirmation', 'dontAddToRecent'],
  })
  if (result.canceled || !result.filePath) return null

  try {
    const targetPath = ensureExtension(result.filePath, '.html')
    await atomicWrite(targetPath, html)
    return { path: targetPath }
  } catch (error) {
    throw new DesktopOperationError(
      'HTML_EXPORT_FAILED',
      'HTML 导出失败',
      '课件未能写入所选位置。',
      '请确认文件未被占用，并选择有足够空间的位置后重试。',
      { cause: error },
    )
  }
}

export async function writeWebPackageFile(
  window: BrowserWindow,
  suggestedName: string,
  bytes: Uint8Array,
): Promise<{ path: string } | null> {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_EXPORT_BYTES) {
    throw new DesktopOperationError(
      'WEB_PACKAGE_SIZE_INVALID',
      '网页包导出失败',
      bytes.byteLength === 0
        ? '导出的网页包为空。'
        : '导出的网页包超过 512 MB 限制。',
      '请减少页面数量或压缩大图片后重试。',
    )
  }
  if (!hasZipSignature(bytes)) {
    throw new DesktopOperationError(
      'WEB_PACKAGE_ARCHIVE_INVALID',
      '网页包导出失败',
      '待保存的数据不是有效的 ZIP 网页包。',
      '请重新执行导出；如果问题持续出现，请重新启动编辑器。',
    )
  }

  const result = await dialog.showSaveDialog(window, {
    title: '导出网页课件包',
    defaultPath: sanitizeSuggestedName(suggestedName, '.zip'),
    filters: [{ name: '网页课件包', extensions: ['zip'] }],
    properties: ['showOverwriteConfirmation', 'dontAddToRecent'],
  })
  if (result.canceled || !result.filePath) return null

  const targetPath = ensureExtension(result.filePath, '.zip')
  try {
    await atomicWrite(targetPath, bytes)
    return { path: targetPath }
  } catch (error) {
    throw new DesktopOperationError(
      'WEB_PACKAGE_EXPORT_FAILED',
      '网页包导出失败',
      '网页课件包未能写入所选位置。',
      '请确认文件未被占用，并选择有足够空间的位置后重试。',
      { cause: error },
    )
  }
}

export async function peekProjectArchiveFile(
  filePath: string,
): Promise<OpenBinaryFileResult | null> {
  const resolved = path.resolve(filePath)
  if (
    !path.isAbsolute(resolved) ||
    path.extname(resolved).toLocaleLowerCase('en-US') !== '.h5lesson'
  ) return null
  try {
    const bytes = await readFileWithLimit(
      resolved,
      MAX_PROJECT_BYTES,
      '工程预检失败',
      'PROJECT_PEEK_FAILED',
    )
    if (!hasZipSignature(bytes)) return null
    return { path: resolved, name: path.basename(resolved), bytes }
  } catch {
    return null
  }
}

export async function writeBinaryExportFile(
  window: BrowserWindow,
  suggestedName: string,
  extension: 'pptx' | 'pdf' | 'json' | 'docx',
  bytes: Uint8Array,
): Promise<{ path: string } | null> {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_EXPORT_BYTES) {
    throw new DesktopOperationError(
      'EXPORT_SIZE_INVALID',
      '文件导出失败',
      bytes.byteLength === 0 ? '导出文件为空。' : '导出文件超过 512 MB 限制。',
      '请减少页面数量或压缩大图片后重试。',
    )
  }
  const labels = {
    pptx: 'PowerPoint 演示文稿',
    pdf: 'PDF 文档',
    json: 'JSON 报告',
    docx: 'Word 讲义',
  } as const
  const result = await dialog.showSaveDialog(window, {
    title: `导出${labels[extension]}`,
    defaultPath: sanitizeSuggestedName(suggestedName, `.${extension}`),
    filters: [{ name: labels[extension], extensions: [extension] }],
    properties: ['showOverwriteConfirmation', 'dontAddToRecent'],
  })
  if (result.canceled || !result.filePath) return null
  const targetPath = ensureExtension(result.filePath, `.${extension}`)
  try {
    await atomicWrite(targetPath, bytes)
    return { path: targetPath }
  } catch (error) {
    throw new DesktopOperationError(
      'BINARY_EXPORT_FAILED',
      '文件导出失败',
      `${labels[extension]}未能写入所选位置。`,
      '请确认文件未被占用，并选择有足够空间的位置后重试。',
      { cause: error },
    )
  }
}
