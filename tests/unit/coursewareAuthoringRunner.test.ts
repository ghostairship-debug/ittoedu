// @vitest-environment node

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { link, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { createTextNode } from '@/renderer/project/nativeNodeFactories'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { createCourseProjectArchive } from '@/renderer/project/courseProjectArchive'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import {
  canonicalDeliveryFingerprint,
  runCoursewareAuthoringCli,
} from '../../scripts/run-courseware-authoring'

const execFileAsync = promisify(execFile)
const root = path.resolve(__dirname, '..', '..')
const tsx = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const runner = path.join(root, 'scripts', 'run-courseware-authoring.ts')
let temporaryRoot = ''

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function duplicateFirstZipMember(bytes: Uint8Array): Uint8Array {
  const value = Buffer.from(bytes)
  const eocd = value.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (eocd < 0) throw new Error('fixture ZIP has no EOCD')
  const centralOffset = value.readUInt32LE(eocd + 16)
  if (value.readUInt32LE(centralOffset) !== 0x02014b50) throw new Error('fixture ZIP has no central member')
  const centralSize = 46 + value.readUInt16LE(centralOffset + 28) +
    value.readUInt16LE(centralOffset + 30) + value.readUInt16LE(centralOffset + 32)
  const duplicate = Buffer.from(value.subarray(centralOffset, centralOffset + centralSize))
  const originalCentral = value.subarray(centralOffset, eocd)
  const suffix = Buffer.from(value.subarray(eocd))
  const entries = suffix.readUInt16LE(10)
  suffix.writeUInt16LE(entries + 1, 8)
  suffix.writeUInt16LE(entries + 1, 10)
  suffix.writeUInt32LE(originalCentral.byteLength + duplicate.byteLength, 12)
  return Buffer.concat([
    value.subarray(0, centralOffset),
    originalCentral,
    duplicate,
    suffix,
  ])
}

function orphanFirstLocalZipMember(bytes: Uint8Array): Uint8Array {
  const value = Buffer.from(bytes)
  const eocd = value.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  const centralOffset = value.readUInt32LE(eocd + 16)
  const nameLength = value.readUInt16LE(26)
  const extraLength = value.readUInt16LE(28)
  const compressedSize = value.readUInt32LE(18)
  const localEnd = 30 + nameLength + extraLength + compressedSize
  const orphan = Buffer.from(value.subarray(0, localEnd))
  const centralAndEocd = Buffer.from(value.subarray(centralOffset))
  const shiftedEocd = centralAndEocd.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  centralAndEocd.writeUInt32LE(centralOffset + orphan.byteLength, shiftedEocd + 16)
  return Buffer.concat([value.subarray(0, centralOffset), orphan, centralAndEocd])
}

async function writeJson(filename: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filename), { recursive: true })
  await writeFile(filename, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

afterEach(async () => {
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true })
})

describe('trusted courseware authoring runner', () => {
  it('canonicalizes only format-owned timestamps and rejects semantic delivery changes', () => {
    const webFirst = zipSync({
      'index.html': strToU8('<main>lesson</main>'),
      'player.js': strToU8('console.info("player")'),
    }, { mtime: new Date('2026-08-13T00:00:00Z') })
    const webSecond = zipSync({
      'player.js': strToU8('console.info("player")'),
      'index.html': strToU8('<main>lesson</main>'),
    }, { mtime: new Date('2026-08-14T00:00:00Z') })
    expect(canonicalDeliveryFingerprint('webPackage', webFirst)).toEqual(
      canonicalDeliveryFingerprint('webPackage', webSecond),
    )
    const webTampered = zipSync({
      'index.html': strToU8('<main>tampered</main>'),
      'player.js': strToU8('console.info("player")'),
    }, { mtime: new Date('2026-08-14T00:00:00Z') })
    expect(canonicalDeliveryFingerprint('webPackage', webTampered).sha256)
      .not.toBe(canonicalDeliveryFingerprint('webPackage', webFirst).sha256)
    expect(() => canonicalDeliveryFingerprint('webPackage', duplicateFirstZipMember(webFirst)))
      .toThrow(/duplicate normalized member/)
    expect(() => canonicalDeliveryFingerprint('webPackage', orphanFirstLocalZipMember(webFirst)))
      .toThrow(/local headers and central directory/)

    const pdf = (date: string, content: string) => Buffer.from(
      `%PDF-1.4\n1 0 obj\n<</Creator (Chromium)\n/Producer (Skia/PDF m150)\n` +
      `/CreationDate (${date})\n/ModDate (${date})>>\nendobj\n${content}\n%%EOF`,
      'latin1',
    )
    const pdfFirst = pdf("D:20260813132755+00'00'", 'semantic-body')
    const pdfSecond = pdf("D:20260814112809+00'00'", 'semantic-body')
    expect(canonicalDeliveryFingerprint('pdf', pdfFirst)).toEqual(
      canonicalDeliveryFingerprint('pdf', pdfSecond),
    )
    expect(canonicalDeliveryFingerprint('pdf', pdfSecond.subarray(0, -5)).sha256)
      .not.toBe(canonicalDeliveryFingerprint('pdf', pdfFirst).sha256)

    const core = (date: string) => strToU8(
      `<cp:coreProperties><dcterms:created>${date}</dcterms:created>` +
      `<dcterms:modified>${date}</dcterms:modified><dc:title>Lesson</dc:title></cp:coreProperties>`,
    )
    const pptx = (date: string, slide: string) => zipSync({
      'docProps/core.xml': core(date),
      'ppt/slides/slide1.xml': strToU8(slide),
    }, { mtime: new Date(date) })
    const pptxFirst = pptx('2026-08-13T00:00:00Z', '<slide>lesson</slide>')
    const pptxSecond = pptx('2026-08-14T00:00:00Z', '<slide>lesson</slide>')
    expect(canonicalDeliveryFingerprint('pptx', pptxFirst)).toEqual(
      canonicalDeliveryFingerprint('pptx', pptxSecond),
    )
    expect(canonicalDeliveryFingerprint('pptx', pptx('2026-08-14T00:00:00Z', '<slide>tampered</slide>')).sha256)
      .not.toBe(canonicalDeliveryFingerprint('pptx', pptxFirst).sha256)
  })

  it('rejects output aliases and wrong extensions before launching Electron', async () => {
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'courseware-authoring-paths-'))
    const caseRoot = path.join(temporaryRoot, 'external case')
    const inventoryPath = path.join(caseRoot, 'implementation', 'authoring-inventory.json')
    await writeJson(inventoryPath, {
      schemaVersion: 2,
      caseId: 'path-safety',
      projectPath: 'project/path-safety.h5lesson',
    })
    const baseArgs = [
      '--case-dir', caseRoot,
      '--editor-root', root,
      '--delivery-html', 'evidence/delivery.html',
      '--delivery-web-package', 'evidence/delivery.zip',
      '--delivery-pdf', 'evidence/delivery.pdf',
      '--delivery-pptx', 'evidence/delivery.pptx',
    ]
    const inventoryBefore = await readFile(inventoryPath)
    const hardlinkReport = path.join(caseRoot, 'evidence', 'hardlink-report.json')
    await mkdir(path.dirname(hardlinkReport), { recursive: true })
    await link(inventoryPath, hardlinkReport)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      for (const { unsafeArgs, expectedError } of [
        {
          unsafeArgs: ['--report', 'implementation/authoring-inventory.json'],
          expectedError: '--report must not alias or overwrite --inventory',
        },
        {
          unsafeArgs: ['--report', 'evidence/hardlink-report.json'],
          expectedError: '--report must not alias or overwrite --inventory',
        },
        {
          unsafeArgs: ['--report', 'evidence/session.json', '--delivery-html', 'project/path-safety.h5lesson'],
          expectedError: '--delivery-html must use .html or .htm',
        },
        {
          unsafeArgs: ['--report', 'evidence/session.txt'],
          expectedError: '--report must use .json',
        },
      ]) {
        stderr.mockClear()
        await expect(runCoursewareAuthoringCli([...baseArgs, ...unsafeArgs])).resolves.toBe(2)
        expect(stderr.mock.calls.map(([chunk]) => String(chunk)).join('')).toContain(expectedError)
        expect(await readFile(inventoryPath)).toEqual(inventoryBefore)
      }
    } finally {
      stderr.mockRestore()
    }
  })

  it.skipIf(!existsSync(path.join(root, 'dist-renderer', 'index.html')))(
    'runs a real native text Editor round trip from an external cwd and rejects a forged receipt',
    async () => {
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'courseware-authoring-test-'))
    const caseRoot = path.join(temporaryRoot, 'external case #1')
    await mkdir(path.join(caseRoot, 'implementation'), { recursive: true })
    await mkdir(path.join(caseRoot, 'project'), { recursive: true })
    await mkdir(path.join(caseRoot, 'evidence'), { recursive: true })
    const contract = Buffer.from('trusted authoring test contract\n')
    const presentation = Buffer.from('trusted authoring test presentation\n')
    const plan = Buffer.from('trusted authoring test plan\n')
    await writeFile(path.join(caseRoot, '01-courseware-contract.md'), contract)
    await writeFile(path.join(caseRoot, '02-presentation-script.md'), presentation)
    await writeFile(path.join(caseRoot, '03-development-plan.md'), plan)

    const project = createBlankCourseProject({
      id: 'project_authoring_runner',
      title: '可信编辑会话',
      now: '2026-08-13T00:00:00.000Z',
      includeDefaultController: false,
      controls: 'none',
    })
    const surface = project.surfaces[0]
    if (!surface || surface.type !== 'slide') throw new Error('expected a Slide surface')
    const scene = surface.scenes[0]!
    const location = project.locations[0]
    scene.id = 'scene_authoring_runner'
    scene.name = '真实编辑'
    if (location?.kind === 'slide-scene') {
      location.id = scene.id
      location.sceneId = scene.id
      location.label = scene.name
    }
    project.startLocationId = scene.id
    const node = createTextNode({
      id: 'node_authoring_title',
      name: '可编辑标题',
      text: '真实编辑前标题',
      x: 240,
      y: 240,
      width: 800,
      height: 160,
      style: { fontSize: 52, color: '#172033', backgroundColor: '#ffffff', backgroundOpacity: 1 },
    })
    scene.layerItems = [sceneNodeToCourseLayerItem(node, 0)]
    const archive = createCourseProjectArchive({
      project: courseProjectDocumentSchema.parse(project),
      assetFiles: {},
      componentFiles: {},
    }, {
      mtime: '2026-08-13T00:00:00.000Z',
    })
    const projectPath = path.join(caseRoot, 'project', 'authoring-runner-case.h5lesson')
    await writeFile(projectPath, archive)
    const capabilityBytes = await readFile(path.join(root, 'artifacts', 'ai-capabilities', 'index.json'))
    const inventory = {
      schemaVersion: 2,
      caseId: 'authoring-runner-case',
      projectPath: 'project/authoring-runner-case.h5lesson',
      generatedFrom: {
        coursewareContractSha256: sha256(contract),
        presentationScriptSha256: sha256(presentation),
        capabilityIndexSha256: sha256(capabilityBytes),
        developmentPlanSha256: sha256(plan),
      },
      globalEntities: [],
      scenes: [{
        sceneId: scene.id,
        ownership: 'native-owned',
        entities: [{
          id: 'title',
          label: '标题',
          kind: 'text',
          sourceRef: 'CNT-001',
          intent: '编辑标题',
          authoringEntry: '画布选择后编辑',
          expectedOutcome: '保存重开与Player/HTML一致',
          authoringOutcomeId: 'AUTH-001',
          binding: `native:scene:${scene.id}:${node.id}:text`,
          editability: 'canvas-distinct',
          requiredForAcceptance: true,
        }],
      }],
    }
    await writeJson(path.join(caseRoot, 'implementation', 'authoring-inventory.json'), inventory)
    const baseArgs = [
      tsx, '--tsconfig', path.join(root, 'tsconfig.json'), runner,
      '--case-dir', caseRoot,
      '--editor-root', root,
      '--delivery-html', 'delivery/lesson.html',
      '--delivery-web-package', 'delivery/lesson-web.zip',
      '--delivery-pdf', 'delivery/lesson.pdf',
      '--delivery-pptx', 'delivery/lesson.pptx',
      '--report', 'evidence/authoring-session-report.json',
    ]
    const generated = await execFileAsync(process.execPath, [...baseArgs, '--write-delivery-html'], {
      cwd: os.tmpdir(),
      encoding: 'utf8',
      timeout: 180_000,
      env: { ...process.env, COURSEWARE_E2E_BACKGROUND: '1' },
    })
    expect(JSON.parse(generated.stdout)).toMatchObject({ status: 'passed', errors: [] })
    const receiptPath = path.join(caseRoot, 'evidence', 'authoring-session-report.json')
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8')) as Record<string, unknown>
    expect(receipt).toMatchObject({
      schemaVersion: 1,
      receiptType: 'editor-authoring-session-v1',
      caseId: 'authoring-runner-case',
      exporter: {
        deliveryMatches: true,
        deliveries: {
          html: { matches: true },
          webPackage: { matches: true },
          pdf: { matches: true },
          pptx: { matches: true },
        },
      },
      errors: [],
      entities: [{
        inventoryEntityId: 'title',
        status: 'passed',
        canvasSelectionVerified: true,
        saved: true,
        reopened: true,
        player: { changed: true },
        html: { changed: true },
      }],
    })

    receipt.runnerSha256 = '0'.repeat(64)
    ;(receipt.entities as Array<Record<string, unknown>>)[0]!.probeValue = 'forged persisted probe'
    await writeJson(receiptPath, receipt)
    await expect(execFileAsync(process.execPath, [...baseArgs, '--verify-report'], {
      cwd: os.tmpdir(),
      encoding: 'utf8',
      timeout: 180_000,
      env: { ...process.env, COURSEWARE_E2E_BACKGROUND: '1' },
    })).rejects.toMatchObject({ code: 1 })

    scene.presentation = {
      initialStateId: 'state_override',
      thumbnailStateId: 'state_override',
      states: [{
        id: 'state_override',
        name: '状态文本覆盖',
        layerItemOverrides: {
          [node.id]: { visible: true, nativeData: { text: '覆盖了持久绑定的文本' } },
        },
      }],
    }
    const overriddenArchive = createCourseProjectArchive({
      project: courseProjectDocumentSchema.parse(project),
      assetFiles: {},
      componentFiles: {},
    }, {
      mtime: '2026-08-13T00:00:00.000Z',
    })
    await writeFile(projectPath, overriddenArchive)
    await expect(execFileAsync(process.execPath, baseArgs, {
      cwd: os.tmpdir(),
      encoding: 'utf8',
      timeout: 15_000,
      env: { ...process.env, COURSEWARE_E2E_BACKGROUND: '1' },
    })).rejects.toMatchObject({
      code: 2,
      stderr: expect.stringContaining('observation state overrides the bound field instead of observing it'),
    })
  }, 360_000)
})
