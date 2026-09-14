import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { courseProjectDocumentSchema } from '../../src/shared/courseProjectSchema'
import { COMMON_TASK_SET, CORE_TASK_IDS, R18_COMMON_TASKS, taskInstruction } from '../fixtures/r18CommonTasks/definitions'
import { createR18Materials, createR18TaskInput, resolveR18VariantTargets } from '../fixtures/r18CommonTasks/fixtures'

describe('R18 frozen common-task definitions (not AI task success)', () => {
  it('freezes all 60 independent tasks, 20 core tasks and required carrier domains', () => {
    const counts = { D: 10, T: 6, I: 8, L: 6, S: 6, A: 5, C: 5, B: 4, N: 3, M: 3, Q: 4 }
    const expectedIds = Object.entries(counts).flatMap(([family, n]) => Array.from({ length: n }, (_, i) => `${family}${String(i + 1).padStart(2, '0')}`))
    expect(R18_COMMON_TASKS.map(t => t.id)).toEqual(expectedIds)
    expect(new Set(expectedIds).size).toBe(COMMON_TASK_SET.denominator)
    expect(R18_COMMON_TASKS.filter(t => t.core).map(t => t.id).sort()).toEqual([...CORE_TASK_IDS].sort())
    const required: Record<string, string[]> = {
      D01: ['slide-base', 'slide-state', 'flow-body', 'flow-overlay', 'spatial-world', 'slide-shared', 'global'],
      D06: ['slide-base', 'slide-state', 'flow-overlay', 'spatial-world', 'slide-shared', 'global'],
      T01: ['slide-base', 'slide-state', 'flow-body', 'flow-overlay', 'spatial-world', 'global'],
      I01: ['slide-base', 'slide-state', 'flow-overlay', 'spatial-world', 'slide-shared', 'global'],
      I02: ['slide-base', 'slide-state', 'flow-body', 'flow-overlay', 'spatial-world', 'global'],
      I04: ['slide-base', 'slide-state', 'flow-body', 'flow-overlay', 'spatial-world', 'global'],
      L04: ['slide-base', 'slide-state'], L06: ['flow-body', 'flow-overlay'],
      S01: ['slide-base', 'slide-state', 'slide-shared', 'flow-body', 'spatial-world'],
      S03: ['slide-base', 'slide-state', 'slide-shared', 'flow-body', 'spatial-world'], S06: ['spatial-world'],
      A01: ['slide-base', 'slide-state', 'flow-overlay', 'spatial-world', 'global'],
      A02: ['slide-base', 'slide-state', 'flow-overlay', 'spatial-world', 'global'],
      C01: ['slide-base', 'slide-state', 'flow-body', 'flow-overlay', 'spatial-world'],
      C03: ['slide-base', 'slide-state', 'flow-body', 'flow-overlay', 'spatial-world'],
      B01: ['slide-base', 'slide-state'], N02: ['slide-base', 'slide-state'],
      M01: ['slide-base', 'slide-state', 'flow-body', 'flow-overlay', 'spatial-world', 'global'],
      Q01: ['slide-base', 'slide-state', 'flow-body', 'flow-overlay', 'spatial-world'],
      Q04: ['slide-base', 'slide-state', 'flow-body', 'spatial-world'],
    }
    for (const [id, carriers] of Object.entries(required)) {
      const actual = new Set(R18_COMMON_TASKS.find(t => t.id === id)!.variants.map(v => v.carrier))
      for (const carrier of carriers) expect(actual.has(carrier as typeof R18_COMMON_TASKS[number]['variants'][number]['carrier']), `${id}/${carrier}`).toBe(true)
    }
    for (const t of R18_COMMON_TASKS) {
      expect(t.launch.entry).toBe('in-app-course-chat')
      expect(t.expected.length).toBeGreaterThan(0)
      expect(t.preserve.length).toBeGreaterThan(0)
      expect(new Set(t.variants.map(v => v.id)).size).toBe(t.variants.length)
      expect(t.version).toBe(t.batch === 'B1' ? '1.8' : '1.9')
      for (const v of t.variants) expect(taskInstruction(t, v)).toContain(t.instruction)
    }
    const i01 = R18_COMMON_TASKS.find(t => t.id === 'I01')!
    expect(i01.instruction).toBe('帮我将这个形状替换为卡通小狗图片')
    expect(i01.variants.filter(v => v.fixture === 'slide-heavy-original-copy').map(v => v.session)).toEqual(['new', 'continuous'])
    expect(COMMON_TASK_SET.profile.model).toBe('gpt-5.6-luna')
    expect(COMMON_TASK_SET.profile.reasoningEffort).toBe('medium')
    for (const id of ['C01', 'C02', 'C03', 'C04', 'C05']) expect(R18_COMMON_TASKS.find(t => t.id === id)!.prerequisites.join(' ')).toContain('missing-product-leaf')
  })

  it('generates every required input variant as strict V9 and resolves every frozen target', async () => {
    for (const task of R18_COMMON_TASKS) for (const variant of task.variants) {
      try {
        const input = await createR18TaskInput(task, variant)
        expect(courseProjectDocumentSchema.safeParse(input.project).success).toBe(true)
        expect(resolveR18VariantTargets(input.project, variant).length).toBeGreaterThan(0)
        for (const asset of Object.values(input.project.assets)) {
          if (input.intentionallyMissingAssetIds.includes(asset.id)) expect(input.assetFiles[asset.id]).toBeUndefined()
          else expect(input.assetFiles[asset.id]?.byteLength).toBe(asset.byteLength)
        }
      } catch (error) {
        throw new Error(`${task.id}/${variant.id}: ${String(error)}`, { cause: error })
      }
    }
  }, 60_000)

  it('provides meaningful decodable image inputs and real media containers, without claiming visual quality', async () => {
    const materials = await createR18Materials()
    const original = await sharp(materials['parabola-red.png']).metadata()
    const large = await sharp(materials['large-diagram.png']).metadata()
    expect([original.width, original.height, original.hasAlpha]).toEqual([800, 450, true])
    expect([large.width, large.height, large.hasAlpha]).toEqual([3200, 1800, true])
    await sharp(materials['parabola-red.png']).raw().toBuffer()
    expect(new TextDecoder().decode(materials['tone.wav']!.slice(0, 4))).toBe('RIFF')
    for (const name of ['motion.webm', 'motion-blue.webm']) expect([...materials[name]!.slice(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3])
  })
})
