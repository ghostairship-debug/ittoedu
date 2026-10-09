/** Current Project V10 bytes have one native extension. The previous filename remains readable. */
export const NATIVE_PROJECT_EXTENSION = '.glx'
export const NATIVE_PROJECT_OPEN_EXTENSIONS = ['glx', 'h5lesson'] as const

export function isNativeProjectFilename(filename: string): boolean {
  return /\.(?:glx|h5lesson)$/i.test(filename)
}

export function nativeProjectStem(filename: string): string {
  return filename.replace(/\.(?:glx|h5lesson)$/i, '')
}

/** New files and Save As use .glx; opening or saving an existing file does not rename it. */
export function nativeProjectFilename(filename: string): string {
  return nativeProjectStem(filename) + NATIVE_PROJECT_EXTENSION
}
