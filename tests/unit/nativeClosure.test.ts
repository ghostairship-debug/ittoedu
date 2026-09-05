import { describe, expect, it } from 'vitest'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import { publishedCourseV2Schema } from '@/shared/publishedCourseSchema'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import {
  createChartLayerItem,
  createChartNode,
  createShapeNode,
  createTableLayerItem,
  createTableNode,
} from '@/renderer/project/nativeNodeFactories'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import {
  buildPublishedCourseV2Payload,
  collectPublishedCourseAssetIds,
} from '@/renderer/export/course/buildPublishedCourse'
import {
  collectCourseProjectHealth,
  type CourseProjectHealthArchiveFiles,
} from '@/shared/courseProjectHealth'
import type {
  CourseProjectDocument,
  NativeLayerItem,
} from '@/shared/courseProjectTypes'
import type { AssetMeta } from '@/shared/contracts/media-v1'
import { getDefaultLineGeometry } from '@/shared/nativeLineGeometry'

const NOW = '2026-09-05T00:00:00.000Z'
const EMPTY_FILES: CourseProjectHealthArchiveFiles = {
  assetFiles: {},
  componentFiles: {},
}

function createImageAsset(id: string): AssetMeta {
  return {
    id,
    filename: `${id}.png`,
    mimeType: 'image/png',
    kind: 'image',
    path: `assets/${id}`,
    byteLength: 1024,
  }
}

function createBaseProject(): CourseProjectDocument {
  return createBlankCourseProject({
    id: 'native-closure-project',
    now: NOW,
    includeDefaultController: false,
    controls: 'none',
    idFactory: () => 'fixed-id',
  })
}

const VALID_INPUT_STYLE = {
  fontFamily: 'sans-serif',
  fontSize: 16,
  textColor: '#111827',
  fillColor: '#ffffff',
  fillOpacity: 1,
  borderColor: '#d1d5db',
  borderOpacity: 1,
  borderWidth: 1,
  cornerRadius: 6,
  horizontalAlign: 'left' as const,
  padding: 8,
}

describe('r12-050-native-closure Matrix Verification', () => {
  describe('1. Health check closure for Table, Chart, Input, Line, and Background', () => {
    it('produces zero health errors on a fully valid project containing all 1.2 Native types', () => {
      const project = createBaseProject()
      const bgAsset = createImageAsset('bg-asset-1')
      project.assets[bgAsset.id] = bgAsset
      project.backgroundAssetId = bgAsset.id

      // Course state for input
      project.courseState = [
        { key: 'userAnswer', valueType: 'string', defaultValue: '' },
        { key: 'userAnswerValid', valueType: 'boolean', defaultValue: false },
      ]

      const slide = project.surfaces.find((s) => s.type === 'slide')
      if (!slide || slide.type !== 'slide') throw new Error('expected slide surface')

      // 1. Table
      const table = createTableNode({
        id: 'table-layer',
        name: '合法表格',
        x: 50,
        y: 50,
      })
      const tableItem = createTableLayerItem(table, 0)

      // 2. Chart
      const chart = createChartNode({
        id: 'chart-layer',
        chartType: 'donut',
        title: '合法图表',
        x: 50,
        y: 250,
      })
      const chartItem = createChartLayerItem(chart, 1)

      // 3. Line
      const lineNode = createShapeNode('line', {
        id: 'line-layer',
        name: '合法直线',
        x: 50,
        y: 450,
        width: 200,
        height: 20,
      })
      lineNode.lineGeometry = getDefaultLineGeometry('line')
      const lineItem = sceneNodeToCourseLayerItem(lineNode, 2) as NativeLayerItem

      // 4. Input
      const inputRuleId = 'rule-input-submit'
      const inputItem: NativeLayerItem = {
        layerItemId: 'input-layer',
        label: '合法输入框',
        kind: 'native',
        order: 3,
        visible: true,
        locked: false,
        rotation: 0,
        opacity: 1,
        hitPolicy: 'auto',
        playbackInitialVisibility: 'inherit',
        frame: { mode: 'absolute', x: 50, y: 500, width: 240, height: 44 },
        content: {
          nativeType: 'input',
          data: {
            answerType: 'text',
            stateKey: 'userAnswer',
            validityKey: 'userAnswerValid',
            placeholder: '请输入答案',
            ruleFamilyRuleIds: [inputRuleId],
            style: VALID_INPUT_STYLE,
          },
        },
      }

      slide.scenes[0]!.layerItems = [tableItem, chartItem, lineItem, inputItem]
      slide.scenes[0]!.interactions = [
        {
          id: inputRuleId,
          name: '输入提交规则',
          enabled: true,
          trigger: { type: 'input.submit', nodeId: 'input-layer' },
          conditions: [],
          actions: [
            {
              id: 'step-1',
              start: 'after-previous',
              delayMs: 0,
              action: {
                type: 'course-state.set',
                key: 'userAnswerValid',
                value: true,
              },
            },
          ],
        },
      ]

      const parsed = courseProjectDocumentSchema.safeParse(project)
      expect(parsed.success).toBe(true)

      const findings = collectCourseProjectHealth(project, EMPTY_FILES)
      const errorFindings = findings.filter((f) => f.severity === 'error')
      expect(errorFindings).toEqual([])
    })

    it('pinpoints field paths for Table, Chart, Input, Line, and Background violations', () => {
      const project = createBaseProject()
      const slide = project.surfaces.find((s) => s.type === 'slide')
      if (!slide || slide.type !== 'slide') throw new Error('expected slide surface')

      // Missing background asset
      project.backgroundAssetId = 'non-existent-bg-asset'

      // Input with missing courseState keys and non-existent rule
      const malformedInput: NativeLayerItem = {
        layerItemId: 'malformed-input',
        label: '错误输入框',
        kind: 'native',
        order: 0,
        visible: true,
        locked: false,
        rotation: 0,
        opacity: 1,
        hitPolicy: 'auto',
        playbackInitialVisibility: 'inherit',
        frame: { mode: 'absolute', x: 0, y: 0, width: 200, height: 40 },
        content: {
          nativeType: 'input',
          data: {
            answerType: 'number',
            stateKey: 'missing-num-key',
            validityKey: 'missing-valid-key',
            ruleFamilyRuleIds: ['missing-rule'],
            style: VALID_INPUT_STYLE,
          },
        },
      }

      // Degenerate line (warning) and shape mismatch (error)
      const malformedLine: NativeLayerItem = {
        layerItemId: 'malformed-line',
        label: '错误折线',
        kind: 'native',
        order: 1,
        visible: true,
        locked: false,
        rotation: 0,
        opacity: 1,
        hitPolicy: 'auto',
        playbackInitialVisibility: 'inherit',
        frame: { mode: 'absolute', x: 0, y: 0, width: 100, height: 100 },
        content: {
          nativeType: 'shape',
          data: {
            shapeType: 'line',
            lineGeometry: {
              kind: 'elbow',
              start: [10, 10],
              end: [10, 10],
              axis: 'horizontal',
              position: 10,
            },
            style: {
              fillColor: '#000000',
              fillOpacity: 1,
              borderColor: '#000000',
              borderOpacity: 1,
              borderWidth: 1,
              lineStyle: 'solid',
              cornerRadius: 0,
              startArrow: 'none',
              endArrow: 'none',
            },
          },
        },
      }

      slide.scenes[0]!.layerItems = [malformedInput, malformedLine]

      const findings = collectCourseProjectHealth(project, EMPTY_FILES)
      const codes = new Set(findings.map((f) => f.code))

      expect(codes.has('background-asset-missing')).toBe(true)
      expect(codes.has('input-state-key-invalid')).toBe(true)
      expect(codes.has('input-rule-family-incomplete')).toBe(true)
      expect(codes.has('line-geometry-shape-mismatch')).toBe(true)
    })
  })

  describe('2. Published Course V2 parity and strict containment', () => {
    it('successfully publishes all 1.2 Native features into PublishedCourseV2 payload', () => {
      const project = createBaseProject()
      const bgAsset = createImageAsset('bg-shared')
      project.assets[bgAsset.id] = bgAsset
      project.backgroundAssetId = bgAsset.id

      project.courseState = [
        { key: 'val', valueType: 'string', defaultValue: '' },
        { key: 'valid', valueType: 'boolean', defaultValue: false },
      ]

      const slide = project.surfaces.find((s) => s.type === 'slide')
      if (!slide || slide.type !== 'slide') throw new Error('expected slide surface')

      const table = createTableNode({ id: 'pub-table' })
      const chart = createChartNode({ id: 'pub-chart', chartType: 'bar' })
      const line = createShapeNode('line', { id: 'pub-line' })
      line.lineGeometry = getDefaultLineGeometry('line')
      const lineItem = sceneNodeToCourseLayerItem(line, 2) as NativeLayerItem

      const inputItem: NativeLayerItem = {
        layerItemId: 'pub-input',
        label: 'Pub Input',
        kind: 'native',
        order: 3,
        visible: true,
        locked: false,
        rotation: 0,
        opacity: 1,
        hitPolicy: 'auto',
        playbackInitialVisibility: 'inherit',
        frame: { mode: 'absolute', x: 10, y: 10, width: 200, height: 40 },
        content: {
          nativeType: 'input',
          data: {
            answerType: 'text',
            stateKey: 'val',
            validityKey: 'valid',
            ruleFamilyRuleIds: ['pub-input-rule'],
            style: VALID_INPUT_STYLE,
          },
        },
      }

      slide.scenes[0]!.layerItems = [
        createTableLayerItem(table, 0),
        createChartLayerItem(chart, 1),
        lineItem,
        inputItem,
      ]

      slide.scenes[0]!.interactions = [
        {
          id: 'pub-input-rule',
          name: 'Input Rule',
          enabled: true,
          trigger: { type: 'input.submit', nodeId: 'pub-input' },
          conditions: [],
          actions: [
            {
              id: 'step-pub-1',
              start: 'after-previous',
              delayMs: 0,
              action: {
                type: 'course-state.set',
                key: 'valid',
                value: true,
              },
            },
          ],
        },
      ]

      const payload = buildPublishedCourseV2Payload({
        project,
        assetFiles: { [bgAsset.id]: new Uint8Array(1024) },
        components: {},
      })

      const parsed = publishedCourseV2Schema.parse(payload)
      expect(parsed.backgroundAssetId).toBe(bgAsset.id)

      const publishedSlide = parsed.surfaces.find((s) => s.type === 'slide')
      if (publishedSlide?.type !== 'slide') throw new Error('expected slide surface')

      const sceneLayers = publishedSlide.scenes[0]!.layerItems
      expect(sceneLayers.some((item) => item.kind === 'native' && item.content.nativeType === 'table')).toBe(true)
      expect(sceneLayers.some((item) => item.kind === 'native' && item.content.nativeType === 'chart')).toBe(true)
      expect(sceneLayers.some((item) => item.kind === 'native' && item.content.nativeType === 'input')).toBe(true)
      expect(sceneLayers.some((item) => item.kind === 'native' && item.content.nativeType === 'shape')).toBe(true)

      // Assets collected for published archive
      const assetIds = collectPublishedCourseAssetIds({ project, components: {} })
      expect(assetIds.has(bgAsset.id)).toBe(true)
    })

    it('strictly rejects out-of-bounds Native items via schema validation', () => {
      const project = createBaseProject()
      const payload = buildPublishedCourseV2Payload({
        project,
        assetFiles: {},
        components: {},
      })

      // Mutate globalLayerItems to contain a table layer -> strict rejection
      const candidate = structuredClone(payload)
      const table = createTableNode({ id: 'table-on-global' })
      const tableItem = createTableLayerItem(table, 0)
      candidate.globalLayerItems.push({
        item: {
          layerItemId: tableItem.layerItemId,
          order: tableItem.order,
          visible: tableItem.visible,
          rotation: tableItem.rotation,
          opacity: tableItem.opacity,
          hitPolicy: tableItem.hitPolicy,
          playbackInitialVisibility: tableItem.playbackInitialVisibility,
          frame: tableItem.frame,
          kind: 'native',
          content: tableItem.content,
        },
        visibility: { mode: 'all', locationIds: [] },
      })

      const parseResult = publishedCourseV2Schema.safeParse(candidate)
      expect(parseResult.success).toBe(false)
      if (!parseResult.success) {
        expect(parseResult.error.issues.some((issue) => (
          issue.message.includes('Global layer does not support native table')
        ))).toBe(true)
      }
    })
  })

  describe('3. Accessibility and metadata representation', () => {
    it('ensures Table, Chart, and Line preserve accessible text, title, and structure', () => {
      const tableNode = createTableNode({
        id: 'acc-table',
        name: '学生成绩表',
      })
      expect(tableNode.columns.length).toBeGreaterThan(0)
      expect(tableNode.rows.length).toBeGreaterThan(0)
      expect(tableNode.columns.every((c) => Boolean(c.id))).toBe(true)
      expect(tableNode.rows.every((r) => Boolean(r.id && r.cells.length === tableNode.columns.length))).toBe(true)

      const chartNode = createChartNode({
        id: 'acc-chart',
        chartType: 'donut',
        title: '学科分布统计',
      })
      expect(chartNode.title).toBe('学科分布统计')
      expect(chartNode.categories.length).toBeGreaterThan(0)
      expect(chartNode.series.length).toBe(1)
      expect(chartNode.series[0]!.points.length).toBe(chartNode.categories.length)

      const lineNode = createShapeNode('line', {
        id: 'acc-line',
        name: '流程指示线',
      })
      lineNode.lineGeometry = getDefaultLineGeometry('line')
      expect(lineNode.lineGeometry?.kind).toBe('straight')
      expect(lineNode.lineGeometry?.start).toBeDefined()
      expect(lineNode.lineGeometry?.end).toBeDefined()
    })
  })
})
