import { parentPort } from 'node:worker_threads'
import { extractHtmlResources } from './extractHtmlResources'
import type { ExtractHtmlResourcesInput } from './types'

parentPort!.on('message', (input: ExtractHtmlResourcesInput) => {
  try { parentPort!.postMessage({ ok: true, result: extractHtmlResources(input) }) }
  catch (error) {
    parentPort!.postMessage({ ok: false, error: error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack } : { message: String(error) } })
  }
})
