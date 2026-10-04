import type { AssetSource } from '../../../shared/contracts/media-v1'

/** 默认只采用 CC0、公有领域、CC BY 与图库自身的宽松授权；CC BY-SA 须教师同意；NC、ND 与授权不明一律排除。 */
export type OpenLicenseCode = 'cc0' | 'pd' | 'by' | 'by-sa' | 'pixabay'

export interface OpenLicense {
  code: OpenLicenseCode
  /** 授权简称，例如 “CC BY 4.0”“CC0 1.0”“公有领域”。 */
  id: string
  url?: string
  /** 软件是否生成署名进入署名清单。 */
  attributionRequired: boolean
}

/** Pixabay Content License：不强制署名，但照常生成署名进入署名清单。 */
export const pixabayLicense: OpenLicense = { code: 'pixabay', id: 'Pixabay Content License',
  url: 'https://pixabay.com/service/license-summary/', attributionRequired: true }

export interface LicensePolicy { allowShareAlike: boolean }

const CC = 'https://creativecommons.org'

/** Openverse 的 license 过滤参数；返回结果仍逐条经下面的归一化确认。 */
export function openverseLicenseFilter(policy: LicensePolicy): string {
  return ['cc0', 'pdm', 'by', ...(policy.allowShareAlike ? ['by-sa'] : [])].join(',')
}

function versionOf(value: unknown): string | undefined {
  const text = typeof value === 'number' ? value.toFixed(1) : typeof value === 'string' ? value.trim() : ''
  return /^\d{1,2}\.\d$/.test(text) ? text : undefined
}

/** 授权链接只取创作共用官方站点的地址。 */
function officialUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.hostname !== 'creativecommons.org') return undefined
    url.protocol = 'https:'
    return url.href
  } catch { return undefined }
}

function ccLicense(code: 'by' | 'by-sa', version: string | undefined, apiUrl: unknown): OpenLicense {
  const name = code === 'by' ? 'CC BY' : 'CC BY-SA'
  const url = officialUrl(apiUrl) ?? (version ? `${CC}/licenses/${code}/${version}/` : undefined)
  return { code, id: version ? `${name} ${version}` : name, ...(url ? { url } : {}), attributionRequired: true }
}

const cc0: OpenLicense = { code: 'cc0', id: 'CC0 1.0', url: `${CC}/publicdomain/zero/1.0/`, attributionRequired: false }

/** Openverse 的 license 代码（cc0、pdm、by、by-sa、by-nc……）；不予采用时返回 null。 */
export function openverseLicense(code: unknown, version: unknown, apiUrl: unknown, policy: LicensePolicy): OpenLicense | null {
  const value = typeof code === 'string' ? code.trim().toLowerCase() : ''
  if (value === 'cc0') return cc0
  if (value === 'pdm') return { code: 'pd', id: '公有领域', url: `${CC}/publicdomain/mark/1.0/`, attributionRequired: false }
  if (value === 'by') return ccLicense('by', versionOf(version), apiUrl)
  if (value === 'by-sa' && policy.allowShareAlike) return ccLicense('by-sa', versionOf(version), apiUrl)
  return null
}

/** Wikimedia Commons extmetadata 的 License 键（如 cc-by-sa-4.0、pd-old）与 LicenseShortName（如 “CC BY-SA 4.0”）。 */
export function commonsLicense(input: { key?: unknown; shortName?: unknown; url?: unknown }, policy: LicensePolicy): OpenLicense | null {
  const text = [input.key, input.shortName].filter((part): part is string => typeof part === 'string').join(' ').trim().toLowerCase()
  if (!text) return null
  // 非商用、禁止演绎先排除，避免被后面的 cc by 匹配。
  if (/\b(?:nc|nd)\b|non-?commercial|no-?deriv/.test(text)) return null
  if (/\bcc0\b|cc[- ]zero/.test(text)) return cc0
  const version = versionOf(/\b(\d{1,2}\.\d)\b/.exec(text)?.[1])
  if (/\bcc[- ]by[- ]sa\b/.test(text)) return policy.allowShareAlike ? ccLicense('by-sa', version, input.url) : null
  if (/\bcc[- ]by\b/.test(text)) return ccLicense('by', version, input.url)
  if (/^pd(?:\b|-)|public[- ]domain|\bpdm\b/.test(text)) return { code: 'pd', id: '公有领域', attributionRequired: false }
  return null
}

export interface OpenLibraryWork {
  title?: string
  author?: string
  /** 原始站点名称与来源页。 */
  sourceName: string
  pageUrl: string
  license: OpenLicense
}

/** 署名：标题、作者、来源、授权。 */
export function attributionText(work: OpenLibraryWork): string {
  return [
    ...(work.title ? [`“${work.title}”`] : []),
    ...(work.author ? [`作者：${work.author}`] : []),
    `来源：${work.sourceName}（${work.pageUrl}）`,
    `授权：${work.license.id}${work.license.url ? `（${work.license.url}）` : ''}`,
  ].join('，')
}

/** 随图片保存的来源记录；CC0 与公有领域无需署名，不生成 attribution。 */
export function openLibrarySource(work: OpenLibraryWork): AssetSource {
  return {
    kind: 'open-library',
    ...(work.title ? { title: work.title } : {}),
    url: work.pageUrl,
    ...(work.author ? { author: work.author } : {}),
    license: { id: work.license.id, ...(work.license.url ? { url: work.license.url } : {}) },
    ...(work.license.attributionRequired ? { attribution: attributionText(work) } : {}),
  }
}

const hiddenCharacters = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤⁦-⁩﻿]/g

/** 第三方文字进入模型与署名前：去控制字符与方向控制符、合并空白、限长。 */
export function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.replace(hiddenCharacters, ' ').replace(/\s+/g, ' ').trim()
  if (!text) return undefined
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/** Commons 的 Artist、ImageDescription 是 HTML 片段，只取文字。 */
export function htmlText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<[^>]*>/g, ' ')
    .replace(/&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|([a-z]+));/gi, (whole, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
      if (name) return entities[name.toLowerCase()] ?? whole
      const code = dec ? Number.parseInt(dec, 10) : Number.parseInt(hex!, 16)
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    })
  return cleanText(text, max)
}

/** 只接受不含凭据的 http(s) 地址；协议相对地址补成 https。 */
export function httpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  try {
    const url = new URL(value.startsWith('//') ? `https:${value}` : value)
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? url.href : undefined
  } catch { return undefined }
}
