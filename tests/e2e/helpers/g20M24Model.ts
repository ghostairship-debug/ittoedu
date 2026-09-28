import { createServer, type ServerResponse } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createBlankCourseProject } from '../../../src/core/course/createCourseProject'
import { CourseV9Driver } from '../../../src/core/drivers/CourseV9Driver'
import { createTextNode } from '../../../src/core/tools/nativeNodeFactories'
import { sceneNodeToCourseLayerItem } from '../../../src/shared/courseProjectModel'
import { courseProjectDocumentSchema } from '../../../src/shared/courseProjectSchema'
import { modelToolWireName } from '../../../src/main/workbench/providers/OpenAIChatProvider'
import { answerG20VisionCapabilityProbe } from '../../helpers/g20CapabilityProbeFixture'
import sharp from 'sharp'

export const G20_M24_MODELS = {
  direct: 'fixture-m24-direct',
  chat: 'fixture-m24-chat',
  vision: 'fixture-m24-vision',
} as const

export const G20_M24_PAGES = [
  { id: 'm24-page-red', sceneId: 'm24-scene-red', label: '红色目标页', color: '#b91c1c', rgb: [185, 28, 28] as const, textId: 'm24-text-red' },
  { id: 'm24-page-green', sceneId: 'm24-scene-green', label: '绿色目标页', color: '#166534', rgb: [22, 101, 52] as const, textId: 'm24-text-green' },
  { id: 'm24-page-blue', sceneId: 'm24-scene-blue', label: '蓝色目标页', color: '#1d4ed8', rgb: [29, 78, 216] as const, textId: 'm24-text-blue' },
] as const

export type G20M24ObservationMode = 'direct' | 'fallback' | 'stale'

export interface G20M24ObservationRound {
  id: string
  mode: G20M24ObservationMode
  targetLabel: string
  conversationModel: string
  held: boolean
  completed: boolean
  error?: string
  frozenDocumentTarget?: string
  children?: Array<{ target: string; label: string; kind: string }>
  observation?: Record<string, any>
  imageReceipt?: { model: string; targetLabel: string; pixelCounts: Record<string, number>; width: number; height: number; pngPath: string }
  visualRequest?: { model: string; targetLabel: string; pixelCounts: Record<string, number>; width: number; height: number; pngPath: string }
  staleToolResult?: unknown
  release(): void
  waitUntilHeld(): Promise<void>
}

type RequestMessage = { role?: string; content?: unknown; tool_call_id?: string }
type ChatRequest = { model?: string; messages?: RequestMessage[]; tools?: Array<{ function?: { name?: string } }> }

const event = (model: string, delta: unknown, finish: string | null) =>
  `data: ${JSON.stringify({ id: `m24-${model}`, model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`

function sendText(response: ServerResponse, model: string, content: string) {
  response.end(event(model, { role: 'assistant', content }, 'stop') + 'data: [DONE]\n\n')
}

function sendTool(response: ServerResponse, request: ChatRequest, model: string, name: string, args: unknown, id: string) {
  const wire = modelToolWireName(name)
  if (!request.tools?.some(item => item.function?.name === wire)) throw new Error(`Real tool ${name} is missing from the model request`)
  response.end(event(model, { role: 'assistant', tool_calls: [{ index: 0, id, type: 'function',
    function: { name: wire, arguments: JSON.stringify(args) } }] }, 'tool_calls') + 'data: [DONE]\n\n')
}

function parseToolResult(request: ChatRequest, callId: string): any {
  const message = request.messages?.find(item => item.role === 'tool' && item.tool_call_id === callId)
  if (typeof message?.content !== 'string') throw new Error(`Missing tool result ${callId}`)
  return JSON.parse(message.content)
}

async function inspectImagePart(request: ChatRequest, targetLabel: string, imagePath: string) {
  const messages = request.messages ?? []
  const user = [...messages].reverse().find(message => message.role === 'user' && Array.isArray(message.content)
    && (message.content as any[]).some(part => part?.type === 'image_url'))
  const content = user?.content as any[] | undefined
  const imageUrl = content?.find(part => part?.type === 'image_url')?.image_url?.url
  if (typeof imageUrl !== 'string' || !imageUrl.startsWith('data:image/png;base64,')) throw new Error('Model JSON did not contain a PNG image_url part')
  const bytes = Buffer.from(imageUrl.slice('data:image/png;base64,'.length), 'base64')
  writeFileSync(imagePath, bytes)
  const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  if (info.width < 1280 || info.height < 720 || info.channels !== 3) throw new Error(`Unexpected observation PNG ${info.width}x${info.height}x${info.channels}`)
  const pixelCounts: Record<string, number> = {}
  for (const page of G20_M24_PAGES) pixelCounts[page.label] = 0
  for (let offset = 0; offset < data.length; offset += info.channels) {
    for (const page of G20_M24_PAGES) {
      const rgb = page.rgb
      if (Math.abs(data[offset]! - rgb[0]) <= 2 && Math.abs(data[offset + 1]! - rgb[1]) <= 2 && Math.abs(data[offset + 2]! - rgb[2]) <= 2)
        pixelCounts[page.label] = pixelCounts[page.label]! + 1
    }
  }
  const expected = pixelCounts[targetLabel] ?? 0
  const largestOther = Math.max(0, ...Object.entries(pixelCounts).filter(([label]) => label !== targetLabel).map(([, count]) => count))
  if (expected < 20_000 || expected < largestOther * 3) throw new Error(`PNG pixels do not identify ${targetLabel}: ${JSON.stringify(pixelCounts)}`)
  return { model: request.model ?? '', targetLabel, pixelCounts, width: info.width, height: info.height, pngPath: imagePath }
}

/** Three distinct Course V9 slide locations; each Published render has a machine-checkable background. */
export function createG20M24ObservationModel() {
  const project = createBlankCourseProject({ id: 'm24-observe-project', title: 'M24 观察验收', includeDefaultController: false, controls: 'none' })
  const surface = project.surfaces[0]
  if (surface?.type !== 'slide') throw new Error('Expected the default Slide surface')
  const templateScene = surface.scenes[0]!
  const locations = G20_M24_PAGES.map(page => ({ id: page.id, label: page.label, kind: 'slide-scene' as const,
    surfaceId: surface.id, sceneId: page.sceneId }))
  surface.scenes = G20_M24_PAGES.map(page => {
    const item = sceneNodeToCourseLayerItem(createTextNode({ id: page.textId, text: `${page.label} 标题`,
      x: 120, y: 120, width: 520, height: 96, style: { overflow: 'fixed', fontSize: 36 } }))
    item.order = 1
    item.label = `${page.label} 标题`
    const sceneId = page.sceneId
    return { ...structuredClone(templateScene), id: sceneId, name: page.label, backgroundColor: page.color,
      backgroundAssetId: null, layerItems: [item], presentation: { initialStateId: `${sceneId}-initial`,
        thumbnailStateId: `${sceneId}-initial`, states: [{ id: `${sceneId}-initial`, name: '初始', layerItemOverrides: {} }] },
      interactions: [] }
  })
  project.locations = locations
  project.startLocationId = locations[0]!.id
  const valid = courseProjectDocumentSchema.parse(project)
  return { kind: 'course-v9' as const, project: valid, resources: { assets: {}, components: {} } }
}

export function serializeG20M24ObservationModel() {
  return new CourseV9Driver().serialize(createG20M24ObservationModel())
}

/** Local HTTP/SSE fake; it validates the exact image JSON part and never edits the document. */
export async function startG20M24ModelServer(evidenceDirectory: string) {
  mkdirSync(evidenceDirectory, { recursive: true })
  const requests: ChatRequest[] = []
  let active: { round: G20M24ObservationRound; step: number; heldPromise: Promise<void>; releaseHold: () => void; resolveHeld: () => void } | undefined
  const server = createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/v1/models') {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ data: Object.values(G20_M24_MODELS).map(id => ({ id })) }))
      return
    }
    try {
      if (request.method !== 'POST' || request.url !== '/v1/chat/completions') throw new Error(`Unexpected local route ${request.method} ${request.url}`)
      let raw = ''; for await (const chunk of request) raw += chunk.toString()
      const data = JSON.parse(raw) as ChatRequest
      requests.push(data)
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })

      const probeAnswer = await answerG20VisionCapabilityProbe(data)
      if (probeAnswer !== null) { sendText(response, data.model ?? 'fixture-probe', probeAnswer); return }
      const run = active
      if (!run) throw new Error(`No armed M24 observe round for ${data.model ?? 'unknown model'}`)
      const { round } = run

      if (round.mode === 'fallback' && data.model === G20_M24_MODELS.vision) {
        const image = await inspectImagePart(data, round.targetLabel, `${evidenceDirectory}/${round.id}-vision-request.png`)
        round.visualRequest = image
        sendText(response, data.model, `真实画面的背景对应${round.targetLabel}。`)
        return
      }
      if (data.model !== round.conversationModel) throw new Error(`Unexpected conversation model ${data.model}; expected ${round.conversationModel}`)
      const step = run.step++
      if (step === 0) {
        const prefix = '本次固定文档与权限（切换界面不改变它们）：'
        const frozen = data.messages?.find(message => typeof message.content === 'string' && message.content.startsWith(prefix))
        if (!frozen) throw new Error('The real Engine request omitted its frozen document grant')
        const references = JSON.parse(String(frozen.content).slice(prefix.length))
        if (!Array.isArray(references) || references.length !== 1 || typeof references[0]?.target !== 'string')
          throw new Error('The real Engine request did not freeze one authorized Course V9 document')
        round.frozenDocumentTarget = references[0].target
        sendTool(response, data, data.model ?? '', 'listChildren', { target: round.frozenDocumentTarget }, `${round.id}-children`)
        return
      }
      if (step === 1) {
        const children = parseToolResult(data, `${round.id}-children`)
        if (children?.kind !== 'read' || !Array.isArray(children.data)) throw new Error(`listChildren failed: ${JSON.stringify(children)}`)
        round.children = children.data.filter((item: any) => item?.kind === 'course-location' && typeof item.target === 'string')
        const target = round.children?.find(item => item.label === round.targetLabel)
        if (!target) throw new Error(`Target page ${round.targetLabel} was absent from actual listChildren output`)
        if (round.held) throw new Error('Round was already held')
        round.held = true; run.resolveHeld()
        await run.heldPromise
        sendTool(response, data, data.model ?? '', 'view.observe', { target: target.target }, `${round.id}-observe`)
        return
      }
      if (step === 2) {
        const result = parseToolResult(data, `${round.id}-observe`)
        round.observation = result?.kind === 'read' ? result.data : undefined
        if (round.mode === 'stale') {
          round.staleToolResult = result
          if (result?.kind !== 'error') throw new Error(`Expected stale handle rejection, received ${JSON.stringify(result)}`)
          if ((data.messages ?? []).some(message => message.role === 'user' && Array.isArray(message.content)
            && (message.content as any[]).some(part => part?.type === 'image_url'))) throw new Error('A stale observation image crossed into model messages')
          round.completed = true
          sendText(response, data.model ?? '', `${round.id} 已拒绝过期观察，没有发送旧图。`)
          return
        }
        if (result?.kind !== 'read' || result.data?.identity?.locationId !== G20_M24_PAGES.find(page => page.label === round.targetLabel)?.id)
          throw new Error(`Observation receipt has the wrong identity: ${JSON.stringify(result)}`)
        if (result.data?.source !== 'isolated-published') throw new Error(`Expected safe isolated capture, received ${result.data?.source}`)
        if (round.mode === 'direct') {
          round.imageReceipt = await inspectImagePart(data, round.targetLabel, `${evidenceDirectory}/${round.id}-conversation-request.png`)
          round.completed = true
          sendText(response, data.model ?? '', `${round.id} 已收到${round.targetLabel}的真实 PNG。`)
          return
        }
        if (round.mode === 'fallback') {
          if ((data.messages ?? []).some(message => message.role === 'user' && Array.isArray(message.content)
            && (message.content as any[]).some(part => part?.type === 'image_url'))) throw new Error('Vision fallback conversation unexpectedly received the raw image')
          if (!round.visualRequest || !(data.messages ?? []).some(message => typeof message.content === 'string'
            && message.content.includes('视觉模型已分析真实画面') && message.content.includes(round.targetLabel)))
            throw new Error('Conversation did not receive the separate vision result and target provenance')
          round.completed = true
          sendText(response, data.model ?? '', `${round.id} 已收到独立视觉分析及${round.targetLabel}来源。`)
          return
        }
      }
      throw new Error(`Unexpected M24 model request step ${step}`)
    } catch (error) {
      if (active) active.round.error = error instanceof Error ? error.stack ?? error.message : String(error)
      if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: { message: error instanceof Error ? error.message : String(error) } }))
    }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
  return {
    endpoint, requests,
    arm(id: string, mode: G20M24ObservationMode, targetLabel: string, conversationModel: string) {
      if (active && !active.round.completed && !active.round.error) throw new Error('Previous observation round has not completed')
      let releaseHold!: () => void, resolveHeld!: () => void
      const heldPromise = new Promise<void>(resolve => { releaseHold = resolve })
      const heldSignal = new Promise<void>(resolve => { resolveHeld = resolve })
      const round: G20M24ObservationRound = { id, mode, targetLabel, conversationModel, held: false, completed: false,
        release: releaseHold, waitUntilHeld: () => heldSignal }
      active = { round, step: 0, heldPromise, releaseHold, resolveHeld }
      return round
    },
    async close() {
      active?.releaseHold()
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    },
  }
}
