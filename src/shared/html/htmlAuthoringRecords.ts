import type { ComponentAuthorRecord } from '../contracts/component-platform/runtime'
import { componentAuthorRecordsSchema } from '../contracts/component-platform/schema'
import { createDomAuthoring } from '../../components/web/authoringDom'
import { indexHtmlElements, scanHtmlSource } from './htmlSourceScanner'

export const HTML_AUTHORING_DATA_ID = 'cw-html-authoring-records'
export const HTML_AUTHORING_CONSUMER_ID = 'cw-html-authoring-consumer'
export type HtmlAuthoringRecords = Record<string, ComponentAuthorRecord>

function softwareRegions(source: string) {
  return indexHtmlElements(source, scanHtmlSource(source).tokens).elements.filter(element =>
    element.name === 'script' && [HTML_AUTHORING_DATA_ID, HTML_AUTHORING_CONSUMER_ID].includes(element.id ?? '')
    && element.endTag)
}

/** The software wrapper is source owned by the existing HTML Session, never a sidecar. */
export function readHtmlAuthoringRecords(source: string): HtmlAuthoringRecords {
  const regions = softwareRegions(source).filter(element => element.id === HTML_AUTHORING_DATA_ID)
  if (regions.length === 0) return {}
  if (regions.length !== 1) throw new Error('HTML 作者数据区重复，请在源码中保留一份。')
  const region = regions[0]!
  const value = JSON.parse(source.slice(region.content.start, region.content.end))
  if (value?.version !== 1 || !value.records || typeof value.records !== 'object' || Array.isArray(value.records)) {
    throw new Error('HTML 作者数据区格式不完整；原数据保留。')
  }
  return componentAuthorRecordsSchema.parse(value.records)
}

/** Import removes both wrapper regions before handing the records to the H5 consumer. */
export function extractHtmlAuthoringRecords(source: string): { source: string; authoringRecords: HtmlAuthoringRecords } {
  const authoringRecords = readHtmlAuthoringRecords(source)
  for (const region of softwareRegions(source).sort((a, b) => b.full.start - a.full.start)) {
    source = source.slice(0, region.full.start) + source.slice(region.full.end)
  }
  return { source, authoringRecords }
}

export function patchHtmlAuthoringRecords(source: string, records: HtmlAuthoringRecords): string {
  const regions = softwareRegions(source)
  const data = regions.find(region => region.id === HTML_AUTHORING_DATA_ID)
  const json = JSON.stringify({ version: 1, records: componentAuthorRecordsSchema.parse(records) }).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
  if (data && regions.some(region => region.id === HTML_AUTHORING_CONSUMER_ID)) {
    // Changing one record keeps every author-authored byte and the installed consumer intact.
    return source.slice(0, data.content.start) + json + source.slice(data.content.end)
  }
  const clean = extractHtmlAuthoringRecords(source).source
  const consumer = `(()=>{const w=window;w.__cwHtmlAuthoringConsumer?.dispose();w.__cwHtmlAuthoringRecords=JSON.parse(document.getElementById('${HTML_AUTHORING_DATA_ID}').textContent).records;w.__cwHtmlAuthoringConsumer=(${createDomAuthoring.toString()})(document.documentElement,{records:()=>w.__cwHtmlAuthoringRecords});})();`
    .replace(/<\/script/gi, '<\\/script')
  const wrapper = `<script id="${HTML_AUTHORING_DATA_ID}" type="application/json">${json}</script><script id="${HTML_AUTHORING_CONSUMER_ID}">${consumer}</script>`
  const close = /<\/body\s*>/i.exec(clean)
  const at = close?.index ?? clean.length
  return clean.slice(0, at) + wrapper + clean.slice(at)
}
