import { UserFacingError } from '../../../shared/errors'

export type ArchiveKind = 'project' | 'component'

function archiveError(kind: ArchiveKind, message: string): UserFacingError {
  if (kind === 'component') {
    return new UserFacingError(
      '组件包无效',
      message,
      '请确认文件来自可信来源，并重新导出 .h5component 组件包。',
    )
  }

  return new UserFacingError(
    '工程文件损坏',
    message,
    '请重新选择有效的 .h5lesson 工程文件，或从备份恢复。',
  )
}

/**
 * ZIP entries always use forward slashes. Rejecting rather than normalising
 * suspicious names is important: otherwise two different entries can collapse
 * onto the same path after validation.
 */
export function assertSafeArchivePath(
  path: string,
  kind: ArchiveKind,
  options: { allowDirectory?: boolean } = {},
): string {
  if (path.length === 0 || path.includes('\0') || /[\u0001-\u001f\u007f]/.test(path)) {
    throw archiveError(kind, '压缩包中包含无效的空路径或控制字符。')
  }

  if (
    path.includes('\\') ||
    path.startsWith('/') ||
    path.startsWith('//') ||
    /^[a-zA-Z]:/.test(path) ||
    path.includes(':')
  ) {
    throw archiveError(kind, `压缩包中包含不安全的绝对路径：“${path}”。`)
  }

  const isDirectory = path.endsWith('/')
  if (isDirectory && !options.allowDirectory) {
    throw archiveError(kind, `需要文件的位置却出现了目录：“${path}”。`)
  }

  const pathWithoutTrailingSlash = isDirectory ? path.slice(0, -1) : path
  const segments = pathWithoutTrailingSlash.split('/')
  if (
    pathWithoutTrailingSlash.length === 0 ||
    segments.some(
      (segment) =>
        segment === '' ||
        segment === '.' ||
        segment === '..' ||
        segment === '__proto__' ||
        segment === 'prototype' ||
        segment === 'constructor',
    )
  ) {
    throw archiveError(kind, `压缩包中包含路径穿越或无效路径：“${path}”。`)
  }

  return path
}

export function isArchiveDirectory(path: string): boolean {
  return path.endsWith('/')
}

export function componentPackageKey(packageId: string, version: string): string {
  return `${packageId}@${version}`
}

export function componentArchiveRoot(packageId: string, version: string): string {
  return `components/${componentPackageKey(packageId, version)}`
}
