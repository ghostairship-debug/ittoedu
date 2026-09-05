import { describe, expect, it } from 'vitest'
import type {
  PublishedComponentLayerItem,
  PublishedNativeLayerItem,
  PublishedRuntimeLayerItem,
} from '@/shared/publishedCourseTypes'
import type { NativeRenderInput } from '@/shared/contracts/native-v1/types'
import type { RuntimeAuthoringTargetUpdate } from '@/shared/runtimeTypes'
import {
  applyPublishedSlideAuthoringItemPatch,
  mapRuntimeAuthoringTargetsToLayer,
  mergePublishedAuthoringFrame,
  publishedComponentAuthoringNode,
  validatePublishedSlideAuthoringIdentity,
  type PublishedSlideAuthoringIdentity,
  type PublishedSlideComponentAuthoringNode,
} from '@/player/surfaces/slide/publishedSlideAuthoringPatch'

function publishedComponent(): PublishedComponentLayerItem {
  return {
    kind: 'component',
    layerItemId: 'component-one',
    frame: { mode: 'absolute', x: 100, y: 80, width: 400, height: 180 },
    order: 1,
    visible: true,
    rotation: 0,
    opacity: 1,
    hitPolicy: 'auto',
    playbackInitialVisibility: 'inherit',
    component: { packageId: 'com.example.locked', version: '4.0.0' },
    props: { title: '标题' },
  }
}

function componentHost(locked: boolean): PublishedSlideComponentAuthoringNode {
  return {
    id: 'component-one',
    name: '组件',
    type: 'external-component',
    x: 100,
    y: 80,
    width: 400,
    height: 180,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked,
    playbackInitialVisibility: 'inherit',
    component: { packageId: 'com.example.locked', version: '4.0.0' },
    props: { title: '标题' },
  }
}

function publishedText(): PublishedNativeLayerItem {
  return {
    kind: 'native',
    layerItemId: 'text-one',
    frame: { mode: 'absolute', x: 40, y: 40, width: 240, height: 48 },
    order: 1,
    visible: true,
    rotation: 0,
    opacity: 1,
    hitPolicy: 'auto',
    playbackInitialVisibility: 'inherit',
    content: {
      nativeType: 'text',
      data: {
        text: '原文',
        runs: [],
        style: {
          fontFamily: 'sans-serif',
          fontSize: 18,
          color: '#172033',
          bold: false,
          italic: false,
          underline: false,
          strike: false,
          emphasis: false,
          highlightColor: null,
          align: 'left',
          verticalAlign: 'top',
          writingMode: 'horizontal',
          lineSpacing: 1.2,
          letterSpacing: 0,
          padding: 0,
          overflow: 'fixed',
          backgroundColor: '#ffffff',
          backgroundOpacity: 0,
          cornerRadius: 0,
        },
      },
    },
  }
}

function textRenderInput(text: string): NativeRenderInput {
  return {
    id: 'text-one',
    name: 'text-one',
    type: 'text',
    x: 48,
    y: 52,
    width: 240,
    height: 48,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    playbackInitialVisibility: 'inherit',
    text,
    runs: [],
    style: {
      fontFamily: 'sans-serif',
      fontSize: 18,
      color: '#172033',
      bold: false,
      italic: false,
      underline: false,
      strike: false,
      emphasis: false,
      highlightColor: null,
      align: 'left',
      verticalAlign: 'top',
      writingMode: 'horizontal',
      lineSpacing: 1.2,
      letterSpacing: 0,
      padding: 0,
      overflow: 'fixed',
      backgroundColor: '#ffffff',
      backgroundOpacity: 0,
      cornerRadius: 0,
    },
  }
}

function identity(
  itemId: string,
  extras: Partial<PublishedSlideAuthoringIdentity> = {},
): PublishedSlideAuthoringIdentity {
  return {
    target: { kind: 'native-node', scope: 'scene', nodeId: itemId },
    revision: 4,
    generation: 1,
    owner: 'scene',
    itemId,
    ...extras,
  }
}

describe('Published Slide authoring patch', () => {
  it('keeps the transient lock and suppresses component authoring targets', () => {
    const merged = mergePublishedAuthoringFrame(publishedComponent(), componentHost(true))
    expect(merged.ok).toBe(true)
    if (!merged.ok || merged.item.kind !== 'component') return

    expect(publishedComponentAuthoringNode(merged.item)).toMatchObject({
      locked: true,
      visible: false,
    })
  })

  it('merges Native render input without reconstructing an authoring node', () => {
    const merged = mergePublishedAuthoringFrame(publishedText(), textRenderInput('改写'))
    expect(merged.ok).toBe(true)
    if (!merged.ok || merged.item.kind !== 'native') return
    expect(merged.item.content.nativeType).toBe('text')
    expect(merged.item.content.data).toMatchObject({ text: '改写' })
    expect(merged.item.frame).toMatchObject({ x: 48, y: 52 })
  })

  it('adds the stable Runtime layer owner while mapping host-local targets', () => {
    const item: PublishedRuntimeLayerItem = {
      kind: 'runtime',
      layerItemId: 'runtime-layer-one',
      frame: { mode: 'absolute', x: 100, y: 80, width: 640, height: 360 },
      order: 2,
      visible: true,
      rotation: 0,
      opacity: 1,
      hitPolicy: 'auto',
      playbackInitialVisibility: 'inherit',
      runtime: {
        protocol: 'canvas-runtime',
        runtimeApiVersion: 2,
        enabled: true,
        renderMode: 'dom',
        code: { encoding: 'base64-utf16le', data: '' },
        content: { values: { title: '标题' }, metadata: {} },
        assets: {},
        nodeBindings: {},
      },
    }
    const update: RuntimeAuthoringTargetUpdate = {
      revision: 1,
      scope: 'scene',
      sceneId: 'scene-one',
      targets: [{
        targetId: 'registered:1',
        scope: 'scene',
        sceneId: 'scene-one',
        kind: 'text',
        key: 'title',
        layer: 'overlay',
        source: 'registered',
        bounds: { x: 0, y: 0, width: 320, height: 180 },
      }],
    }

    expect(mapRuntimeAuthoringTargetsToLayer(update, item).targets[0])
      .toMatchObject({
        targetId: 'registered:1',
        nodeId: 'runtime-layer-one',
        bounds: { x: 100, y: 80, width: 160, height: 90 },
      })
  })

  it('rejects stale revision and generation with zero merge', () => {
    const current = publishedText()
    const captured = identity('text-one')
    expect(validatePublishedSlideAuthoringIdentity({
      captured: { ...captured, revision: 3 },
      current: captured,
      item: current,
    })).toMatchObject({ ok: false, code: 'stale-revision' })
    expect(validatePublishedSlideAuthoringIdentity({
      captured: { ...captured, generation: 0 },
      current: captured,
      item: current,
    })).toMatchObject({ ok: false, code: 'stale-revision' })

    const stale = applyPublishedSlideAuthoringItemPatch({
      current,
      next: textRenderInput('不该写入'),
      captured: { ...captured, revision: 3 },
      currentIdentity: captured,
    })
    expect(stale).toMatchObject({ ok: false, code: 'stale-revision' })
    expect(current.content.data).toMatchObject({ text: '原文' })
  })

  it('rejects owner and missing item identity before writing', () => {
    const current = publishedText()
    const captured = identity('text-one')
    expect(applyPublishedSlideAuthoringItemPatch({
      current,
      next: textRenderInput('不该写入'),
      captured: { ...captured, owner: 'global' },
      currentIdentity: captured,
    })).toMatchObject({ ok: false, code: 'target-mismatch' })
    expect(applyPublishedSlideAuthoringItemPatch({
      current: null,
      next: textRenderInput('不该写入'),
      captured,
      currentIdentity: captured,
    })).toMatchObject({ ok: false, code: 'target-not-found' })
    expect(current.content.data).toMatchObject({ text: '原文' })
  })

  it('applies a current identity patch onto the Published item', () => {
    const current = publishedText()
    const captured = identity('text-one')
    const applied = applyPublishedSlideAuthoringItemPatch({
      current,
      next: textRenderInput('已写入'),
      captured,
      currentIdentity: captured,
    })
    expect(applied.ok).toBe(true)
    if (!applied.ok || applied.item.kind !== 'native') return
    expect(applied.item.content.data).toMatchObject({ text: '已写入' })
  })

  it('merges and applies patches for Table, Chart, and Input', () => {
    // 1. Table
    const tableItem: PublishedNativeLayerItem = {
      kind: 'native',
      layerItemId: 'table-1',
      frame: { mode: 'absolute', x: 20, y: 20, width: 300, height: 180 },
      order: 1,
      visible: true,
      rotation: 0,
      opacity: 1,
      hitPolicy: 'auto',
      playbackInitialVisibility: 'inherit',
      content: {
        nativeType: 'table',
        data: {
          columns: [{ id: 'c1', width: 100 }, { id: 'c2', width: 100 }],
          rows: [
            { id: 'r1', height: 40, cells: [{ id: 'cell-1', columnId: 'c1', text: '原值' }, { id: 'cell-2', columnId: 'c2', text: 'B' }] },
          ],
          headerRowCount: 1,
          style: {
            fillColor: '#ffffff',
            fillOpacity: 1,
            borderColor: '#e5e7eb',
            borderOpacity: 1,
            borderWidth: 1,
            lineStyle: 'solid',
            textColor: '#111827',
            fontFamily: 'sans-serif',
            fontSize: 14,
            horizontalAlign: 'left',
            verticalAlign: 'middle',
            cellPadding: 8,
          },
        },
      },
    }

    const tableInput: NativeRenderInput = {
      id: 'table-1',
      name: 'table-1',
      type: 'table',
      x: 30,
      y: 35,
      width: 320,
      height: 190,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      playbackInitialVisibility: 'inherit',
      columns: [{ id: 'c1', width: 100 }, { id: 'c2', width: 100 }],
      rows: [
        { id: 'r1', height: 40, cells: [{ id: 'cell-1', columnId: 'c1', text: '已更新' }, { id: 'cell-2', columnId: 'c2', text: 'B' }] },
      ],
      headerRowCount: 1,
      style: {
        fillColor: '#ffffff',
        fillOpacity: 1,
        borderColor: '#e5e7eb',
        borderOpacity: 1,
        borderWidth: 1,
        lineStyle: 'solid',
        textColor: '#111827',
        fontFamily: 'sans-serif',
        fontSize: 14,
        horizontalAlign: 'left',
        verticalAlign: 'middle',
        cellPadding: 8,
      },
    }

    const tableMerged = applyPublishedSlideAuthoringItemPatch({
      current: tableItem,
      next: tableInput,
      captured: identity('table-1'),
      currentIdentity: identity('table-1'),
    })
    expect(tableMerged.ok).toBe(true)
    if (tableMerged.ok && tableMerged.item.kind === 'native') {
      expect(tableMerged.item.frame).toMatchObject({ x: 30, y: 35, width: 320, height: 190 })
      expect(tableMerged.item.content.nativeType).toBe('table')
      expect((tableMerged.item.content.data as any).rows[0].cells[0].text).toBe('已更新')
    }

    // 2. Chart
    const chartItem: PublishedNativeLayerItem = {
      kind: 'native',
      layerItemId: 'chart-1',
      frame: { mode: 'absolute', x: 20, y: 20, width: 400, height: 260 },
      order: 2,
      visible: true,
      rotation: 0,
      opacity: 1,
      hitPolicy: 'auto',
      playbackInitialVisibility: 'inherit',
      content: {
        nativeType: 'chart',
        data: {
          chartType: 'bar',
          title: '原标题',
          categories: [{ id: 'cat-1', label: '一' }],
          series: [{ id: 's-1', name: '系列1', color: '#3b82f6', points: [{ id: 'p-1', categoryId: 'cat-1', value: 10 }] }],
          style: {
            backgroundColor: '#ffffff',
            backgroundOpacity: 1,
            fontFamily: 'sans-serif',
            fontSize: 12,
            textColor: '#111827',
            showLegend: true,
            legendPosition: 'top',
            showDataLabels: false,
            showCategoryAxis: true,
            showValueAxis: true,
            showGridLines: true,
          },
        },
      },
    }

    const chartInput: NativeRenderInput = {
      id: 'chart-1',
      name: 'chart-1',
      type: 'chart',
      x: 25,
      y: 25,
      width: 420,
      height: 280,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      playbackInitialVisibility: 'inherit',
      chartType: 'bar',
      title: '新图表标题',
      categories: [{ id: 'cat-1', label: '一' }],
      series: [{ id: 's-1', name: '系列1', color: '#3b82f6', points: [{ id: 'p-1', categoryId: 'cat-1', value: 20 }] }],
      style: {
        backgroundColor: '#ffffff',
        backgroundOpacity: 1,
        fontFamily: 'sans-serif',
        fontSize: 12,
        textColor: '#111827',
        showLegend: true,
        legendPosition: 'top',
        showDataLabels: false,
        showCategoryAxis: true,
        showValueAxis: true,
        showGridLines: true,
      },
    }

    const chartMerged = applyPublishedSlideAuthoringItemPatch({
      current: chartItem,
      next: chartInput,
      captured: identity('chart-1'),
      currentIdentity: identity('chart-1'),
    })
    expect(chartMerged.ok).toBe(true)
    if (chartMerged.ok && chartMerged.item.kind === 'native') {
      expect(chartMerged.item.frame).toMatchObject({ x: 25, y: 25, width: 420, height: 280 })
      expect((chartMerged.item.content.data as any).title).toBe('新图表标题')
    }

    // 3. Input
    const inputItem: PublishedNativeLayerItem = {
      kind: 'native',
      layerItemId: 'input-1',
      frame: { mode: 'absolute', x: 40, y: 40, width: 240, height: 48 },
      order: 3,
      visible: true,
      rotation: 0,
      opacity: 1,
      hitPolicy: 'auto',
      playbackInitialVisibility: 'inherit',
      content: {
        nativeType: 'input',
        data: {
          answerType: 'text',
          stateKey: 'userAnswer',
          validityKey: 'userAnswerValid',
          placeholder: '请输入',
          ruleFamilyRuleIds: ['rule-1'],
          style: {
            fontFamily: 'sans-serif',
            fontSize: 16,
            textColor: '#111827',
            fillColor: '#ffffff',
            fillOpacity: 1,
            borderColor: '#d1d5db',
            borderOpacity: 1,
            borderWidth: 1,
            cornerRadius: 6,
            horizontalAlign: 'left',
            padding: 8,
          },
        },
      },
    }

    const inputInput: NativeRenderInput = {
      id: 'input-1',
      name: 'input-1',
      type: 'input',
      x: 50,
      y: 50,
      width: 260,
      height: 52,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      playbackInitialVisibility: 'inherit',
      answerType: 'number',
      stateKey: 'userAnswer',
      validityKey: 'userAnswerValid',
      placeholder: '请输入数字',
      ruleFamilyRuleIds: ['rule-1'],
      style: {
        fontFamily: 'sans-serif',
        fontSize: 16,
        textColor: '#111827',
        fillColor: '#ffffff',
        fillOpacity: 1,
        borderColor: '#d1d5db',
        borderOpacity: 1,
        borderWidth: 1,
        cornerRadius: 6,
        horizontalAlign: 'left',
        padding: 8,
      },
    }

    const inputMerged = applyPublishedSlideAuthoringItemPatch({
      current: inputItem,
      next: inputInput,
      captured: identity('input-1'),
      currentIdentity: identity('input-1'),
    })
    expect(inputMerged.ok).toBe(true)
    if (inputMerged.ok && inputMerged.item.kind === 'native') {
      expect(inputMerged.item.frame).toMatchObject({ x: 50, y: 50, width: 260, height: 52 })
      expect((inputMerged.item.content.data as any).answerType).toBe('number')
      expect((inputMerged.item.content.data as any).placeholder).toBe('请输入数字')
    }
  })

  it('rejects invalid incremental patch transitions, mismatched node types, and stale identity for Table, Chart, and Input', () => {
    // 1. Cannot change native type (Chart -> Table or Table -> Chart)
    const chartItem: PublishedNativeLayerItem = {
      kind: 'native',
      layerItemId: 'node-x',
      frame: { mode: 'absolute', x: 0, y: 0, width: 200, height: 200 },
      order: 1,
      visible: true,
      rotation: 0,
      opacity: 1,
      hitPolicy: 'auto',
      playbackInitialVisibility: 'inherit',
      content: {
        nativeType: 'chart',
        data: {
          chartType: 'bar',
          title: 'T',
          categories: [],
          series: [],
          style: {
            backgroundColor: '#ffffff',
            backgroundOpacity: 1,
            fontFamily: 'sans-serif',
            fontSize: 12,
            textColor: '#000000',
            showLegend: false,
            legendPosition: 'top',
            showDataLabels: false,
            showCategoryAxis: false,
            showValueAxis: false,
            showGridLines: false,
          },
        },
      },
    }

    const tableInput: NativeRenderInput = {
      id: 'node-x',
      name: 'node-x',
      type: 'table',
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      playbackInitialVisibility: 'inherit',
      columns: [],
      rows: [],
      headerRowCount: 0,
      style: {
        fillColor: '#ffffff',
        fillOpacity: 1,
        borderColor: '#000000',
        borderOpacity: 1,
        borderWidth: 1,
        lineStyle: 'solid',
        textColor: '#000000',
        fontFamily: 'sans-serif',
        fontSize: 12,
        horizontalAlign: 'left',
        verticalAlign: 'middle',
        cellPadding: 4,
      },
    }

    const mismatchedType = applyPublishedSlideAuthoringItemPatch({
      current: chartItem,
      next: tableInput,
      captured: identity('node-x'),
      currentIdentity: identity('node-x'),
    })
    expect(mismatchedType).toMatchObject({ ok: false, code: 'target-mismatch' })

    // 2. Cannot change carrier kind (Native -> Component)
    const mismatchedKind = applyPublishedSlideAuthoringItemPatch({
      current: chartItem,
      next: {
        id: 'node-x',
        name: 'node-x',
        type: 'external-component',
        x: 0,
        y: 0,
        width: 200,
        height: 200,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        playbackInitialVisibility: 'inherit',
        component: { packageId: 'test.pkg', version: '1.0.0' },
        props: {},
      },
      captured: identity('node-x'),
      currentIdentity: identity('node-x'),
    })
    expect(mismatchedKind).toMatchObject({ ok: false, code: 'target-mismatch' })

    // 3. Rejects stale revision for Table / Chart
    const staleTable = applyPublishedSlideAuthoringItemPatch({
      current: chartItem,
      next: {
        id: 'node-x',
        name: 'node-x',
        type: 'chart',
        x: 10,
        y: 10,
        width: 200,
        height: 200,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        playbackInitialVisibility: 'inherit',
        chartType: 'pie',
        title: 'Updated',
        categories: [],
        series: [{ id: 's', name: 'S', color: '#f00', points: [] }],
        style: {
          backgroundColor: '#fff',
          backgroundOpacity: 1,
          fontFamily: 'sans-serif',
          fontSize: 12,
          textColor: '#000',
          showLegend: true,
          legendPosition: 'right',
          showDataLabels: true,
        },
      },
      captured: { ...identity('node-x'), revision: 2 },
      currentIdentity: identity('node-x'),
    })
    expect(staleTable).toMatchObject({ ok: false, code: 'stale-revision' })

    // 4. Rejects mismatched target ID
    const mismatchedTargetId = applyPublishedSlideAuthoringItemPatch({
      current: chartItem,
      next: {
        id: 'node-different',
        name: 'node-different',
        type: 'chart',
        x: 0,
        y: 0,
        width: 200,
        height: 200,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        playbackInitialVisibility: 'inherit',
        chartType: 'pie',
        title: 'T',
        categories: [],
        series: [{ id: 's', name: 'S', color: '#f00', points: [] }],
        style: {
          backgroundColor: '#fff',
          backgroundOpacity: 1,
          fontFamily: 'sans-serif',
          fontSize: 12,
          textColor: '#000',
          showLegend: false,
          legendPosition: 'top',
          showDataLabels: false,
        },
      },
      captured: identity('node-x'),
      currentIdentity: identity('node-x'),
    })
    expect(mismatchedTargetId).toMatchObject({ ok: false, code: 'target-mismatch' })

    // 5. Rejects missing item in host
    const missingTarget = applyPublishedSlideAuthoringItemPatch({
      current: null,
      next: tableInput,
      captured: identity('node-x'),
      currentIdentity: identity('node-x'),
    })
    expect(missingTarget).toMatchObject({ ok: false, code: 'target-not-found' })
  })
})
