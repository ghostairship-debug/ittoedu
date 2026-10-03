/**
 * 素材来源记录，与 C 子线 CourseAssetMeta.source 同形（kind、title、url、author、license.id/url、attribution）。
 * 正式类型合入后改为直接使用它。没有 attribution 表示无需署名。
 */
export type AssetSourceKind = 'user-material' | 'model-svg' | 'open-library' | 'image-model' | 'asset-library'

export interface AssetSourceRecord {
  kind: AssetSourceKind
  title?: string
  /** 来源页。 */
  url?: string
  author?: string
  /** id 是授权简称，例如 “CC BY 4.0”“CC0 1.0”“公有领域”。 */
  license?: { id: string; url?: string }
  /** 软件生成的署名：标题、作者、来源、授权。 */
  attribution?: string
}
