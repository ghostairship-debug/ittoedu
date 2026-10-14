import type { BundledFontFamilyDescriptor } from './bundledFontManifest'

export interface BundledFontOutputManifest {
  schemaVersion: 1
  families: Array<{ family: string; faces: Array<{ file: string; path: string }> }>
}

/** Final filenames come from the same descriptor owner that emits the font CSS. */
export function bundledFontOutputManifest(descriptors: readonly BundledFontFamilyDescriptor[],
  assets: readonly { fileName: string; names: readonly string[]; originalFileNames: readonly string[] }[]): BundledFontOutputManifest {
  return { schemaVersion: 1, families: descriptors.map(family => ({ family: family.family, faces: family.faces.map(face => {
    const asset = assets.find(asset => asset.names.includes(face.file) || asset.originalFileNames.some(name => name.replaceAll('\\', '/').endsWith(`/${face.file}`)))
    if (!asset) throw new Error(`内置字体构建输出缺失：${face.file}`)
    return { file: face.file, path: asset.fileName }
  }) })) }
}
