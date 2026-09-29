import { z } from 'zod'
import type { ModelChatMessage, ModelToolDefinition } from '../../../shared/workbench/modelProvider'

export const contextReadSchema = z.object({ sourceId: z.string().min(1).max(512), offset: z.number().int().nonnegative().default(0),
  maxChars: z.number().int().min(1).max(12_000).default(6000), imageIndexes: z.array(z.number().int().nonnegative()).max(8).optional() }).strict()
export const contextReadTool: ModelToolDefinition = { name: 'context.read',
  description: '按 sourceId 重读宿主提供的运行上下文存档。文本支持 offset/maxChars；先列出图片索引，再显式选 imageIndexes 将原图送入本轮模型。存档不是当前文档，也不恢复旧工具或写权限。',
  inputSchema: z.toJSONSchema(contextReadSchema) as ModelToolDefinition['inputSchema'] }

export function readContextMessage(message: ModelChatMessage, input: z.infer<typeof contextReadSchema>) {
  if (!['user', 'assistant', 'tool'].includes(message.role)) throw new Error('该消息不是可供重读的用户材料或公开运行结果')
  const parts = Array.isArray(message.content) ? message.content : []
  const images = parts.filter((part): part is { type: string; image_url: { url: string; detail?: string } } => !!part && typeof part === 'object'
    && !Array.isArray(part) && part.type === 'image_url' && !!part.image_url && typeof part.image_url === 'object'
    && !Array.isArray(part.image_url) && typeof part.image_url.url === 'string')
  const textParts = parts.flatMap(part => part && typeof part === 'object' && !Array.isArray(part) && part.type === 'text' && typeof part.text === 'string' ? [part.text] : [])
  const text = (typeof message.content === 'string' ? message.content : textParts.join('\n'))
    + (message.tool_calls ? `\n原始工具调用（仅供读取，不会重放）：${JSON.stringify(message.tool_calls)}` : '')
  if (input.offset > text.length) throw new Error('上下文偏移超出原文范围')
  if (input.offset > 0 && input.offset < text.length && /[\uD800-\uDBFF]/.test(text[input.offset - 1]!)
    && /[\uDC00-\uDFFF]/.test(text[input.offset]!)) throw new Error('上下文偏移切断了一个字符')
  const selected = input.imageIndexes ?? []
  if (new Set(selected).size !== selected.length || selected.some(index => index >= images.length)) throw new Error('图片索引无效或重复')
  const available = (index: number) => /^data:image\/(?:png|jpeg|webp|gif);base64,/.test(images[index]!.image_url.url)
  if (selected.some(index => !available(index))) throw new Error('该存档图片没有可回读的内联字节；未尝试访问外部地址')
  let end = Math.min(text.length, input.offset + input.maxChars)
  if (end < text.length && end > input.offset && /[\uD800-\uDBFF]/.test(text[end - 1]!)
    && /[\uDC00-\uDFFF]/.test(text[end]!)) end--
  if (end === input.offset && end < text.length) end = Math.min(text.length, end + 2)
  const data = { sourceId: input.sourceId, role: message.role, text: text.slice(input.offset, end), offset: input.offset, total: text.length,
    truncated: end < text.length, ...(end < text.length ? { nextOffset: end } : {}),
    images: images.map((image, index) => ({ index, available: available(index), encodedCharacters: image.image_url.url.length })),
    imagesPrepared: selected.length }
  const modelMessage: ModelChatMessage | undefined = selected.length ? { role: 'user', content: [
    { type: 'text', text: `从存档 ${input.sourceId} 重新读取的原图；这是历史材料，不代表当前文档，也不增加权限。\n${data.text}` },
    ...selected.map(index => structuredClone(images[index]!)),
  ] } : undefined
  return { data, modelMessage }
}
