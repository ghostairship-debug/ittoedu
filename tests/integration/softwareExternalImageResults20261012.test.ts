// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { committedFact } from '../../src/core/tools/modelToolResult'
import { ConversationStore } from '../../src/main/workbench/conversations/ConversationStore'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { ImageGenerationService } from '../../src/main/workbench/images/ImageGenerationService'
import { ImageResultsDesktopService } from '../../src/main/workbench/images/ImageResultsDesktopService'
import { imageProvenance } from '../../src/main/workbench/images/imageRoute'
import { residentMcpFixture, callTool, type ResidentToolReply } from '../helpers/residentMcpFixture'
import type { ImageModelSelection } from '../../src/shared/workbench/images'
import type { ToolResult } from '../../src/shared/workbench/tools'

const evidence = path.resolve('output/repair-external-image-results')
const selection: ImageModelSelection = { imageModel: 'controlled-png-no-network', connection: {
  id: 'fixture', revision: 1, provider: 'openai', protocol: 'chatgpt-responses', baseURL: 'https://chatgpt.com/backend-api/codex',
  accountId: 'fixture', auth: { kind: 'oauth', credentialRef: 'unused' }, billing: { kind: 'unknown' },
  capabilities: { tools: 'unknown', vision: 'unknown', stream: 'unknown', reasoning: 'unknown' },
} }
type Client = Awaited<ReturnType<Awaited<ReturnType<typeof residentMcpFixture>>['connect']>>
function read<T>(reply: ResidentToolReply): T {
  expect(reply.isError, JSON.stringify(reply.structuredContent)).toBe(false)
  const result = reply.structuredContent.result as ToolResult
  if (result.kind !== 'read') throw new Error(JSON.stringify(result))
  return result.data as T
}

it('cold external image results recover only the owned job application from actual MCP outputRef receipts without any generation or document replay', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'software-external-image-results-'))
  const workspace = path.join(root, 'workspace'); await fs.mkdir(workspace)
  const documents = new DocumentHostService(path.join(root, 'documents'))
  const initial = await documents.internalAPI.create({ kind: 'course-v10', project: createBlankCourseProjectV10('外部图片回执'), resources: { assets: {}, components: {} } }, 'source.glx')
  await documents.internalAPI.save(initial.documentId, path.join(workspace, 'source.glx'))
  const bytes = new Uint8Array(await sharp({ create: { width: 32, height: 24, channels: 4, background: '#237dab' } }).png().toBuffer())
  let requests = 0
  // Only provider output is controlled. The actual image owner, MCP events and canonical writer remain active.
  const imageProvider = { generate: async (request: Parameters<ConstructorParameters<typeof ImageGenerationService>[0]['provider']['generate']>[0], references: Parameters<ConstructorParameters<typeof ImageGenerationService>[0]['provider']['generate']>[1]) => {
    requests++
    return { status: 'completed' as const, images: [{ bytes, mimeType: 'image/png', filename: 'ready.png' }], provenance: imageProvenance(request, references) }
  } }
  const imagesDirectory = path.join(root, 'images'), eventsDirectory = path.join(root, 'events'), imageActionsDirectory = path.join(root, 'image-actions')
  const images = new ImageGenerationService({ directory: imagesDirectory, provider: imageProvider })
  const events = new ExecutionEventStore({ directory: eventsDirectory, inlineBytes: 1 })
  documents.tools.configureHostServices({ images: { selection: () => selection, run: images.run.bind(images), read: images.read.bind(images),
    stop: images.stop.bind(images), readResource: images.readResource.bind(images), readReadyResourceFromJob: images.readReadyResourceFromJob.bind(images) } })
  const mcp = await residentMcpFixture({ host: documents, directory: root, workspaceRoot: workspace, settings: { permission: 'workspace' }, appendEvent: event => events.append(event) })
  let results: ImageResultsDesktopService | undefined
  try {
    const client = await mcp.connect('F21 image owner')
    const surface = async (actualClient: Client) => {
      const opened = read<{ target: string }>(await callTool(actualClient, 'file.open', { path: 'source.glx' }))
      const children = read<{ target: string; kind: string }[]>(await callTool(actualClient, 'listChildren', { target: opened.target }))
      return children.find(child => child.kind === 'course-surface')!.target
    }
    const generate = async (actualClient: Client, prompt: string) => {
      const result = await callTool(actualClient, 'image.generate', { prompt, application: { mode: 'insert', target: await surface(actualClient) } })
      const data = read<{ job: string; status: string; application: { status: string } }>(result)
      expect(data).toMatchObject({ status: 'ready', application: { status: 'applied' } })
      const receipt = committedFact('image.generate', result.structuredContent.result as ToolResult)
      expect(receipt).toBeTruthy()
      return { data, receipt: receipt!, raw: result.structuredContent.result as ToolResult, job: await images.read(data.job) }
    }
    const first = await generate(client, '本任务第一张自动插入')
    const sameRunOtherJob = await generate(client, '同任务另一张自动插入')
    expect(sameRunOtherJob.job.runId).toBe(first.job.runId); expect(sameRunOtherJob.job.jobId).not.toBe(first.job.jobId)
    const status = await callTool(client, 'image.status', { job: first.job.jobId })
    expect(committedFact('image.status', status.structuredContent.result as ToolResult)?.operationId).toBe(first.receipt.operationId)
    const otherClient = await mcp.connect('F21 image owner')
    const otherRun = await generate(otherClient, '另一外部任务自动插入')
    expect(otherRun.job.runId).not.toBe(first.job.runId)
    const conversation = (await mcp.conversations.listConversations('space')).find(value => value.runIndex.externalRunIds.includes(first.job.runId))!
    expect(conversation.runIndex.externalRunIds).toContain(otherRun.job.runId)
    const sourceProjection = await events.snapshot(conversation.conversationId)
    const firstOutput = sourceProjection.items.find(item => item.type === 'tool' && item.runId === first.job.runId && item.data.toolName === 'image.generate'
      && item.data.operationId === first.receipt.operationId)!
    expect(firstOutput.data.output).toBeUndefined(); expect(firstOutput.data.outputRef).toBeTruthy()
    expect(sourceProjection.items.some(item => item.type === 'document.commit' && item.runId === first.job.runId && item.data.operationId === first.receipt.operationId)).toBe(true)
    const storedOutput = JSON.parse(Buffer.from(await events.readBlob(conversation.conversationId, firstOutput.data.outputRef!)).toString('utf8')) as ToolResult
    const actualReceipt = committedFact('image.generate', storedOutput)!
    // MCP model replies trim applied values; the event store keeps the original canonical receipt.
    expect(actualReceipt).toMatchObject(first.receipt)
    // Negative scope input uses a real different-job receipt but a deliberately wrong run/job pairing.
    // It must not be mistaken for the first job's application, even though both runs belong to this conversation.
    if (otherRun.raw.kind !== 'read') throw new Error('Expected actual external image read')
    const wrongRun = { ...otherRun.raw, data: { ...(otherRun.raw.data as Record<string, unknown>), job: first.job.jobId } }
    await events.append({ eventId: randomUUID(), conversationId: conversation.conversationId, runId: otherRun.job.runId,
      taskId: otherRun.job.jobId, itemId: 'controlled-negative-foreign-run', time: Date.now(), source: 'external-mcp', type: 'tool', update: 'snapshot',
      data: { toolName: 'image.generate', status: 'completed', output: JSON.stringify(wrongRun) } })
    const beforeRead = await documents.internalAPI.read(initial.documentId)
    expect(beforeRead.undoDepth).toBe(3); expect(requests).toBe(3)
    const coldConversations = new ConversationStore({ directory: path.join(root, 'conversations') })
    const coldEvents = new ExecutionEventStore({ directory: eventsDirectory, inlineBytes: 1 })
    const coldImages = new ImageGenerationService({ directory: imagesDirectory, provider: imageProvider })
    const runs = new ExecutionRunStore(path.join(root, 'empty-builtin-runs'))
    expect(await runs.read(first.job.runId)).toBeNull()
    results = new ImageResultsDesktopService({ directory: imageActionsDirectory, images: coldImages, documents,
      execution: { conversations: coldConversations, runs, events: coldEvents, appendExternalEvent: async input => { await coldEvents.append(input) } }, selection: () => selection })
    const owner = { workspaceId: 'space', conversationId: conversation.conversationId, runId: first.job.runId, jobId: first.job.jobId }
    const cold = await results.read(owner)
    expect(cold.source).toBe('external-mcp'); expect(cold.applications).toHaveLength(1)
    expect(cold.applications[0]).toEqual({ actionId: first.receipt.operationId, documentId: initial.documentId, result: actualReceipt })
    expect((await results.read(owner)).applications).toEqual(cold.applications)
    const preview = await results.preview({ ...owner, resourceId: first.job.resources[0].resourceId })
    expect((await sharp(preview.bytes).metadata())).toMatchObject({ width: 32, height: 24 })
    await expect(results.read({ ...owner, runId: otherRun.job.runId })).rejects.toThrow('身份不一致')
    const wrongConversation = await coldConversations.createConversation({ workspaceId: 'space', title: '无此图片授权的会话' })
    await expect(results.read({ ...owner, conversationId: wrongConversation.conversationId })).rejects.toThrow('不属于')
    expect((await documents.internalAPI.read(initial.documentId)).revision).toBe(beforeRead.revision)
    expect((await documents.internalAPI.read(initial.documentId)).undoDepth).toBe(3); expect(requests).toBe(3)
    // Read and preview consume existing records; no new application action ledger is created.
    await expect(fs.readdir(imageActionsDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
    await fs.mkdir(evidence, { recursive: true })
    await fs.writeFile(path.join(evidence, 'external-cold-read.json'), JSON.stringify({ cold, owner, firstOutput, actualReceipt, modelReplyReceipt: first.receipt,
      otherSameRunJob: { job: sameRunOtherJob.job.jobId, receipt: sameRunOtherJob.receipt }, otherRun: { job: otherRun.job.jobId, runId: otherRun.job.runId, receipt: otherRun.receipt },
      sourceOutputRef: firstOutput.data.outputRef, revisionBeforeRead: beforeRead.revision, undoDepth: beforeRead.undoDepth, requests }, null, 2), 'utf8')
  } finally {
    await results?.flush(); results?.dispose(); await mcp.close()
    const resolved = path.resolve(root)
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Fixture cleanup escaped temp directory')
    await fs.rm(resolved, { recursive: true, force: true })
  }
})
