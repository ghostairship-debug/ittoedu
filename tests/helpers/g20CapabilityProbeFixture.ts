import sharp from 'sharp'

const colors = [
  ['red', [220, 38, 38]], ['green', [22, 163, 74]], ['blue', [37, 99, 235]],
  ['yellow', [234, 179, 8]], ['purple', [147, 51, 234]], ['orange', [234, 88, 12]],
] as const

/** Answers the product's randomized vision challenge from its actual PNG bytes. Returns null for ordinary model requests. */
export async function answerG20VisionCapabilityProbe(body: unknown): Promise<string | null> {
  const messages = (body as any)?.messages
  const content = Array.isArray(messages) ? messages[0]?.content : undefined
  if (!Array.isArray(content) || !content.some(part => part?.type === 'text' && String(part.text).includes('从左到右的三格颜色与形状'))) return null
  const image = content.find(part => part?.type === 'image_url')?.image_url?.url
  if (typeof image !== 'string' || !image.startsWith('data:image/png;base64,')) return null
  const { data, info } = await sharp(Buffer.from(image.slice(image.indexOf(',') + 1), 'base64')).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  if (info.width !== 360 || info.height !== 120 || info.channels !== 3) throw new Error('unexpected capability challenge dimensions')
  const answer: string[] = []
  for (let cell = 0; cell < 3; cell++) {
    const counts = colors.map(() => 0)
    for (let y = 0; y < info.height; y++) for (let x = cell * 120; x < (cell + 1) * 120; x++) {
      const offset = (y * info.width + x) * info.channels
      for (let index = 0; index < colors.length; index++) {
        const target = colors[index]![1]
        if (Math.abs(data[offset]! - target[0]) < 16 && Math.abs(data[offset + 1]! - target[1]) < 16 && Math.abs(data[offset + 2]! - target[2]) < 16) counts[index]!++
      }
    }
    const count = Math.max(...counts), color = colors[counts.indexOf(count)]![0]
    const shape = count > 4200 ? 'square' : count > 3300 ? 'circle' : 'triangle'
    answer.push(`${color}-${shape}`)
  }
  return answer.join('|')
}
