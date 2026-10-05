import type { PublishedCourseCredit } from '../../../shared/publishedCourseTypes'
import type { ComponentAsset } from '../../../shared/contracts/component-platform/project'

/** Current formal assets carry provenance separately from their delivery address. */
export function collectComponentAssetCredits(assets: Readonly<Record<string, Pick<ComponentAsset, 'id' | 'source'>>>): PublishedCourseCredit[] {
  return Object.values(assets).flatMap(asset => {
    const source = asset.source
    if (!source?.attribution) return []
    return [{ assetId: asset.id, kind: source.kind, attribution: source.attribution,
      ...(source.title ? { title: source.title } : {}), ...(source.author ? { author: source.author } : {}),
      ...(source.url ? { url: source.url } : {}), ...(source.license ? { license: { ...source.license } } : {}),
    }]
  }).sort((left, right) => left.assetId.localeCompare(right.assetId))
}

/** One readable credit line: attribution, licence and source page. */
export function courseCreditLine(credit: PublishedCourseCredit): string {
  const license = credit.license ? `（${credit.license.id}${credit.license.url ? ` ${credit.license.url}` : ''}）` : ''
  return `${credit.attribution}${license}${credit.url ? ` 出处：${credit.url}` : ''}`
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => `&#${character.charCodeAt(0)};`)

/** The closing "素材来源" page of a printed course; empty without credits. */
export function courseCreditsPrintSection(credits: readonly PublishedCourseCredit[] | undefined): string {
  if (!credits?.length) return ''
  const items = credits.map(credit => `<li>${escapeHtml(courseCreditLine(credit))}</li>`).join('')
  return '<section class="page course-credits" style="display:block;break-before:page;page-break-before:always;padding:0.6in;'
    + 'font:12pt/1.6 \'Microsoft YaHei\',sans-serif;color:#1f2937"><h2 style="margin:0 0 12pt;font-size:18pt">素材来源</h2>'
    + `<ol style="margin:0;padding-left:1.5em">${items}</ol></section>`
}

/** Appends the credits page to a complete print document. */
export function withCourseCreditsPage(html: string, credits: readonly PublishedCourseCredit[] | undefined): string {
  const section = courseCreditsPrintSection(credits)
  if (!section) return html
  const end = html.lastIndexOf('</body>')
  return end < 0 ? `${html}${section}` : `${html.slice(0, end)}${section}${html.slice(end)}`
}
