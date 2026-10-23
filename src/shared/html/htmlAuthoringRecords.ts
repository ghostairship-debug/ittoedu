import type { ComponentAuthorRecord } from '../contracts/component-platform/runtime'
import { componentAuthorRecordsSchema } from '../contracts/component-platform/schema'
import { createDomAuthoring, domAuthoringFactorySource } from '../../components/web/authoringDom'
import { createNestedDomAuthoring } from '../../components/web/nestedAuthoringDom'
import { createAuthoringFrameGeometry } from '../../components/web/authoringFrame'
import { decorateHtmlFrameAuthoring, type HtmlFrameSources } from './htmlFrameAuthoring'
import { indexHtmlElements, scanHtmlSource, type HtmlSourceToken } from './htmlSourceScanner'

export const HTML_AUTHORING_DATA_ID = 'cw-html-authoring-records'
export const HTML_AUTHORING_CONSUMER_ID = 'cw-html-authoring-consumer'
export type HtmlAuthoringRecords = Record<string, ComponentAuthorRecord>

function softwareRegions(source: string, tokens?: () => readonly HtmlSourceToken[]) {
  if (!source.includes(HTML_AUTHORING_DATA_ID) && !source.includes(HTML_AUTHORING_CONSUMER_ID) && !source.includes('cw-html-frame-bootstrap')) return []
  return indexHtmlElements(source, tokens?.() ?? scanHtmlSource(source).tokens).elements.filter(element =>
    element.name === 'script' && [HTML_AUTHORING_DATA_ID, HTML_AUTHORING_CONSUMER_ID, 'cw-html-frame-bootstrap'].includes(element.id ?? '')
    && element.endTag)
}

function authoringData(source: string, allRegions = softwareRegions(source)) {
  const regions = allRegions.filter(element => element.id === HTML_AUTHORING_DATA_ID)
  if (regions.length === 0) return undefined
  if (regions.length !== 1) throw new Error('HTML 作者数据区重复，请在源码中保留一份。')
  const region = regions[0]!
  return JSON.parse(source.slice(region.content.start, region.content.end))
}

function recordsFromData(value: ReturnType<typeof JSON.parse>): HtmlAuthoringRecords {
  if (value === undefined) return {}
  if (value?.version !== 1 || !value.records || typeof value.records !== 'object' || Array.isArray(value.records)) {
    throw new Error('HTML 作者数据区格式不完整；原数据保留。')
  }
  return componentAuthorRecordsSchema.parse(value.records)
}

function sourcesFromData(value: ReturnType<typeof JSON.parse>): HtmlFrameSources {
  const sources = value?.sources
  if (!sources) return {}
  if (typeof sources !== 'object' || Array.isArray(sources) || Object.values(sources).some(source => !source || typeof source !== 'object'
    || typeof (source as { html?: unknown }).html !== 'string' || typeof (source as { base?: unknown }).base !== 'string')) throw new Error('HTML 子页面源数据格式不完整；原数据保留。')
  return sources
}

export interface HtmlAuthoringAnalysis {
  readonly source: string
  readonly authoringRecords: HtmlAuthoringRecords
  readonly frameSources: HtmlFrameSources
}

/** A caller-owned pure analysis; no global cache or document/runtime state. */
export function analyzeHtmlAuthoringRecords(source: string, tokens?: () => readonly HtmlSourceToken[]): HtmlAuthoringAnalysis {
  const regions = softwareRegions(source, tokens)
  let parsed = false, value: ReturnType<typeof JSON.parse>, clean: string | undefined
  let records: HtmlAuthoringRecords | undefined, sources: HtmlFrameSources | undefined
  const data = () => { if (!parsed) { value = authoringData(source, regions); parsed = true }; return value }
  return {
    get source() {
      if (clean === undefined) {
        clean = source
        for (const region of [...regions].sort((a, b) => b.full.start - a.full.start)) {
          clean = clean.slice(0, region.full.start) + clean.slice(region.full.end)
        }
      }
      return clean
    },
    get authoringRecords() { return records ??= recordsFromData(data()) },
    get frameSources() { return sources ??= sourcesFromData(data()) },
  }
}

/** The software wrapper is source owned by the existing HTML Session, never a sidecar. */
export function readHtmlAuthoringRecords(source: string): HtmlAuthoringRecords {
  return analyzeHtmlAuthoringRecords(source).authoringRecords
}

export function readHtmlFrameSources(source: string): HtmlFrameSources {
  if (!source.includes(HTML_AUTHORING_DATA_ID)) return {}
  return analyzeHtmlAuthoringRecords(source).frameSources
}

/** Import removes software wrapper regions before handing records to the H5 consumer. */
export function extractHtmlAuthoringRecords(source: string): HtmlAuthoringAnalysis {
  const analysis = analyzeHtmlAuthoringRecords(source)
  return { authoringRecords: analysis.authoringRecords, frameSources: analysis.frameSources, source: analysis.source }
}

export function patchHtmlAuthoringRecords(source: string, records: HtmlAuthoringRecords, options: { sources?: HtmlFrameSources; tokens?: () => readonly HtmlSourceToken[] } = {},
  changes?: Array<{ from: number; to: number; inserted: number }>): string {
  // The caller may already have scanned this immutable source. Keep those
  // lexical facts local to the operation, including validation of old data.
  let scanned: readonly HtmlSourceToken[] | undefined
  const tokens = options.tokens ?? (() => scanned ??= scanHtmlSource(source).tokens)
  const regions = softwareRegions(source, tokens), previous = authoringData(source, regions)
  recordsFromData(previous)
  const sources = { ...sourcesFromData(previous), ...options.sources }
  const json = JSON.stringify({ version: 1, records: componentAuthorRecordsSchema.parse(records), ...(Object.keys(sources).length ? { sources } : {}) }).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
  const consumer = `(()=>{const w=window;const data=JSON.parse(document.getElementById('${HTML_AUTHORING_DATA_ID}').textContent);const bridge=w.__cwHtmlFrameAuthoring;w.__cwHtmlAuthoringConsumer?.dispose();w.__cwHtmlAuthoringRecords=data.records;bridge?.setRecords(data.records);bridge?.setSources(data.sources??{});w.__cwHtmlAuthoringConsumer=(${createNestedDomAuthoring.toString()})(document.documentElement,${domAuthoringFactorySource()},{records:()=>w.__cwHtmlAuthoringRecords,shadowRoot:host=>bridge?.shadowRoot(host),resourceReference:value=>bridge?.resourceReference(value),resolveResource:value=>bridge?.resolveResource(value),matchesResource:(value,live)=>bridge?.matchesResource(value,live)??false},(${createAuthoringFrameGeometry.toString()}));})();`
    .replace(/<\/script/gi, '<\\/script')
  let clean = source
  for (const region of regions.sort((a, b) => b.full.start - a.full.start)) {
    clean = clean.slice(0, region.full.start) + clean.slice(region.full.end)
    changes?.push({ from: region.full.start, to: region.full.end, inserted: 0 })
  }
  let decorated = decorateHtmlFrameAuthoring(clean, undefined, { sources }, changes, regions.length ? undefined : tokens())
  const decoratedTokens = scanHtmlSource(decorated).tokens
  const bootstrap = softwareRegions(decorated, () => decoratedTokens).find(region => region.id === 'cw-html-frame-bootstrap')!
  const data = `<script id="${HTML_AUTHORING_DATA_ID}" type="application/json">${json}</script>`
  const bodyClose = decoratedTokens.filter(token => token.kind === 'end-tag' && token.name === 'body').at(-1)
  decorated = decorated.slice(0, bootstrap.full.start) + data + decorated.slice(bootstrap.full.start)
  changes?.push({ from: bootstrap.full.start, to: bootstrap.full.start, inserted: data.length })
  const wrapper = `<script id="${HTML_AUTHORING_CONSUMER_ID}">${consumer}</script>`
  const at = bodyClose ? bodyClose.span.start + (bodyClose.span.start >= bootstrap.full.start ? data.length : 0) : decorated.length
  changes?.push({ from: at, to: at, inserted: wrapper.length })
  return decorated.slice(0, at) + wrapper + decorated.slice(at)
}
