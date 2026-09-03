import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentManifestV4 } from '@/shared/componentTypes'
import type { AssetMeta, ExternalComponentNode } from '@/shared/projectTypes'
import { ComponentPropertiesEditor } from '@/renderer/ui/ComponentPropertiesEditor'
import { ComponentsTab } from '@/renderer/ui/ComponentsTab'
import {
  FontFamilyPicker,
  PropertyDraftBoundary,
  RangeField,
  TextContentTextarea,
} from '@/renderer/ui/properties/PropertyControls'
import {
  selectActiveScene,
  useEditorStore,
} from '@/renderer/store/editorStore'

function activeHistory() {
  const state = useEditorStore.getState()
  const backend = state.slideBackend
  if (!backend) throw new Error('expected active slideBackend')
  return backend.getSession().history
}

const manifest: ComponentManifestV4 = {
  schemaVersion: 4,
  runtimeApiVersion: 4,
  id: 'com.example.editor',
  name: '属性组件',
  version: '4.0.0',
  entry: 'runtime.js',
  defaultSize: { width: 400, height: 240 },
  minSize: { width: 100, height: 80 },
  preserveAspectRatio: false,
  assets: {},
  defaultProps: {},
  supportedScopes: ['scene', 'global'],
  renderMode: 'phaser',
  editor: {
    properties: [
      { key: 'title', label: '标题', type: 'text' },
      { key: 'details', label: '说明', type: 'textarea' },
      { key: 'count', label: '数量', type: 'number', min: 0, max: 10 },
      { key: 'enabled', label: '启用', type: 'boolean' },
      { key: 'accent', label: '颜色', type: 'color' },
      {
        key: 'layout',
        label: '布局',
        type: 'select',
        options: [
          { value: 'story', label: '故事' },
          { value: 'quiz', label: '测验' },
        ],
      },
      { key: 'coverAssetId', label: '封面图片', type: 'image' },
    ],
    pages: [
      {
        id: 'main',
        label: '主页',
        propertyKeys: ['title', 'count', 'enabled', 'accent', 'layout', 'coverAssetId'],
      },
      { id: 'detail', label: '详情页', propertyKeys: ['details'] },
    ],
    defaultPageId: 'main',
    previewPageProp: 'editor.previewPageId',
  },
  variants: [{ id: 'quiz', label: '测验版', props: { layout: 'quiz' } }],
  presets: [{ id: 'ready', label: '即用', props: { title: '预设标题' } }],
}

const asset: AssetMeta = {
  id: 'asset-cover',
  filename: '封面.png',
  mimeType: 'image/png',
  kind: 'image',
  path: 'assets/cover.png',
  byteLength: 10,
}

const baseNode: ExternalComponentNode = {
  id: 'component-1',
  name: '属性组件',
  type: 'external-component',
  x: 0,
  y: 0,
  width: 400,
  height: 240,
  rotation: 0,
  opacity: 1,
  visible: true,
  playbackInitialVisibility: 'inherit',
  locked: false,
  component: { packageId: manifest.id, version: manifest.version },
  props: {
    title: '旧标题',
    details: '旧说明',
    count: 1,
    enabled: false,
    accent: '#112233',
    layout: 'story',
  },
}

const nestedManifest: ComponentManifestV4 = {
  schemaVersion: 4,
  runtimeApiVersion: 4,
  supportedScopes: ['scene', 'global'],
  renderMode: 'dom',
  id: 'com.example.editor-nested',
  name: '嵌套内容属性组件',
  version: '4.0.0',
  entry: 'runtime.js',
  defaultSize: { width: 400, height: 240 },
  minSize: { width: 100, height: 80 },
  preserveAspectRatio: false,
  assets: {},
  defaultProps: {
    content: {
      title: '默认标题',
      actions: { start: '开始' },
      details: { hint: '第一行\n第二行' },
    },
  },
  editor: {
    properties: [
      {
        key: 'content.actions.start',
        label: '开始按钮',
        description: '显式覆盖的按钮文案',
        type: 'text',
        maxLength: 12,
      },
      { key: 'content.title', label: '主标题', type: 'text' },
    ],
  },
  presets: [{
    id: 'ready',
    label: '即用',
    props: { content: { title: '预设标题' } },
  }],
}

const nestedNode: ExternalComponentNode = {
  ...baseNode,
  id: 'component-nested',
  name: nestedManifest.name,
  component: { packageId: nestedManifest.id, version: nestedManifest.version },
  props: { content: { title: '实例标题' } },
}

function Harness() {
  const [node, setNode] = useState(baseNode)
  return (
    <>
      <ComponentPropertiesEditor
        manifest={manifest}
        node={node}
        assets={{ [asset.id]: asset }}
        onChange={(props) => setNode((current) => ({ ...current, props }))}
      />
      <output data-testid="props-value">{JSON.stringify(node.props)}</output>
    </>
  )
}

function NestedContentHarness() {
  const [node, setNode] = useState(nestedNode)
  return (
    <>
      <ComponentPropertiesEditor
        manifest={nestedManifest}
        node={node}
        assets={{}}
        onChange={(props) => setNode((current) => ({ ...current, props }))}
      />
      <output data-testid="nested-props-value">{JSON.stringify(node.props)}</output>
    </>
  )
}

afterEach(cleanup)

describe('ComponentPropertiesEditor', () => {
  it('edits every supported property type and switches internal preview pages', () => {
    render(<Harness />)

    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '新标题' } })
    fireEvent.change(screen.getByLabelText('数量'), { target: { value: '5' } })
    fireEvent.click(screen.getByLabelText('启用'))
    fireEvent.change(screen.getByLabelText('颜色'), { target: { value: '#abcdef' } })
    fireEvent.change(screen.getByLabelText('布局'), { target: { value: 'quiz' } })
    fireEvent.change(screen.getByLabelText('封面图片'), {
      target: { value: 'asset-cover' },
    })

    expect(screen.getByTestId('props-value').textContent).toContain('"title":"新标题"')
    expect(screen.getByTestId('props-value').textContent).toContain('"count":5')
    expect(screen.getByTestId('props-value').textContent).toContain('"enabled":true')
    expect(screen.getByTestId('props-value').textContent).toContain('"accent":"#abcdef"')
    expect(screen.getByTestId('props-value').textContent).toContain('"coverAssetId":"asset-cover"')

    fireEvent.change(screen.getByLabelText('编辑预览页面'), {
      target: { value: 'detail' },
    })
    expect(screen.queryByLabelText('标题')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('说明'), { target: { value: '新说明' } })
    expect(screen.getByTestId('props-value').textContent).toContain('"details":"新说明"')
    expect(screen.getByTestId('props-value').textContent).toContain(
      '"editor":{"previewPageId":"detail"}',
    )
  })

  it('applies variants and presets as complete prop updates', () => {
    render(<Harness />)

    fireEvent.change(screen.getByLabelText('组件变体'), { target: { value: 'quiz' } })
    expect(screen.getByTestId('props-value').textContent).toContain('"layout":"quiz"')

    fireEvent.change(screen.getByLabelText('应用组件预设'), {
      target: { value: 'ready' },
    })
    expect(screen.getByTestId('props-value').textContent).toContain('"title":"预设标题"')
  })

  it('auto-renders and persists every nested content string with explicit overrides', () => {
    render(<NestedContentHarness />)

    const editor = screen.getByTestId('component-properties-editor')
    const textControls = within(editor).getAllByRole('textbox')
    expect(textControls.map((control) => control.getAttribute('id'))).toEqual([
      'component-prop-component-nested-content-actions-start',
      'component-prop-component-nested-content-title',
      'component-prop-component-nested-content-details-hint',
    ])
    expect(screen.getAllByLabelText('主标题')).toHaveLength(1)
    expect(screen.getByLabelText('主标题')).toHaveValue('实例标题')
    expect(screen.getByRole('textbox', { name: /开始按钮/ })).toHaveValue('开始')
    expect(screen.getByRole('textbox', { name: /开始按钮/ })).toHaveAttribute('maxlength', '12')
    expect(screen.getByText('显式覆盖的按钮文案')).toBeInTheDocument()
    expect(screen.getByLabelText('details / hint').tagName).toBe('TEXTAREA')

    fireEvent.change(screen.getByRole('textbox', { name: /开始按钮/ }), {
      target: { value: '立即开始' },
    })
    expect(screen.getByTestId('nested-props-value').textContent).toContain(
      '"actions":{"start":"立即开始"}',
    )
    expect(screen.getByLabelText('主标题')).toHaveValue('实例标题')
    expect(screen.getByLabelText('details / hint')).toHaveValue('第一行\n第二行')
  })
})

describe('ComponentsTab component presets', () => {
  it('shows presets as independent add choices and applies their props', () => {
    useEditorStore.getState().createNewProject()
    useEditorStore.setState({ editorMode: 'professional' })
    useEditorStore.getState().importComponentPackage({
      manifest,
      runtimeSource: 'window.CoursewareComponent.define({id:"com.example.editor",runtimeApiVersion:4,create:function(){return{destroy:function(){}}}})',
      files: {},
    })
    const originalGetContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = () => null
    try {
      const historyLengthBeforeInsert = activeHistory().past.length
      render(<ComponentsTab />)
      fireEvent.click(within(screen.getByLabelText('属性组件预设')).getByRole('button', { name: '即用' }))

      const node = selectActiveScene(useEditorStore.getState()).nodes[0]
      expect(node).toMatchObject({
        type: 'external-component',
        name: '属性组件 · 即用',
        props: { title: '预设标题' },
      })
      expect(activeHistory().past).toHaveLength(historyLengthBeforeInsert + 1)
      useEditorStore.getState().undo()
      expect(selectActiveScene(useEditorStore.getState()).nodes).toHaveLength(0)
    } finally {
      HTMLCanvasElement.prototype.getContext = originalGetContext
    }
  })

  it('keeps nested-content presets available for scene component instances', () => {
    useEditorStore.getState().createNewProject()
    useEditorStore.setState({ editorMode: 'professional' })
    useEditorStore.getState().importComponentPackage({
      manifest: nestedManifest,
      runtimeSource: 'window.CoursewareComponent.define({id:"com.example.editor-nested",runtimeApiVersion:4,create:function(){return{destroy:function(){}}}})',
      files: {},
    })
    const originalGetContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = () => null
    try {
      render(<ComponentsTab />)
      fireEvent.click(within(screen.getByLabelText('嵌套内容属性组件预设')).getByRole('button', { name: '即用' }))

      const node = selectActiveScene(useEditorStore.getState()).nodes[0]
      expect(node).toMatchObject({
        type: 'external-component',
        name: '嵌套内容属性组件 · 即用',
        props: {
          content: {
            title: '预设标题',
            actions: { start: '开始' },
            details: { hint: '第一行\n第二行' },
          },
        },
      })
    } finally {
      HTMLCanvasElement.prototype.getContext = originalGetContext
    }
  })
})

describe('target-bound property drafts', () => {
  it('rejects same-value stale range pointer and blur terminals without retargeting callbacks', () => {
    const changeA = vi.fn()
    const changeB = vi.fn()
    const staleA = vi.fn()
    const staleB = vi.fn()
    const renderRange = (bindingKey: string) => (
      <PropertyDraftBoundary
        bindingKey={bindingKey}
        onStale={bindingKey === 'A' ? staleA : staleB}
      >
        <RangeField
          label="同值范围目标"
          value={50}
          min={0}
          max={100}
          onChange={bindingKey === 'A' ? changeA : changeB}
        />
      </PropertyDraftBoundary>
    )
    const view = render(renderRange('A'))
    const input = screen.getByRole('slider', { name: '同值范围目标' })

    fireEvent.pointerDown(input)
    fireEvent.change(input, { target: { value: '75' } })
    view.rerender(renderRange('B'))
    expect(input).toHaveAttribute('aria-invalid', 'true')
    fireEvent.pointerUp(input)
    expect(staleB).toHaveBeenCalledTimes(1)
    expect(input).not.toHaveAttribute('aria-invalid')
    expect(changeA).not.toHaveBeenCalled()
    expect(changeB).not.toHaveBeenCalled()

    fireEvent.pointerDown(input)
    fireEvent.change(input, { target: { value: '80' } })
    view.rerender(renderRange('A'))
    expect(input).toHaveAttribute('aria-invalid', 'true')
    fireEvent.blur(input)
    expect(staleA).toHaveBeenCalledTimes(1)
    expect(input).not.toHaveAttribute('aria-invalid')
    expect(changeA).not.toHaveBeenCalled()
    expect(changeB).not.toHaveBeenCalled()
  })

  it('rejects clean and dirty stale text terminals without retargeting callbacks', () => {
    const onBeginA = vi.fn()
    const onChangeA = vi.fn()
    const onCommitA = vi.fn()
    const onCancelA = vi.fn()
    const onStaleA = vi.fn()
    const onBeginB = vi.fn()
    const onChangeB = vi.fn()
    const onCommitB = vi.fn()
    const onCancelB = vi.fn()
    const onStaleB = vi.fn()
    const renderText = (bindingKey: string, value: string) => (
      <PropertyDraftBoundary
        bindingKey={bindingKey}
        onStale={bindingKey === 'A' ? onStaleA : onStaleB}
      >
        <TextContentTextarea
          label="文字草稿"
          value={value}
          onBegin={bindingKey === 'A' ? onBeginA : onBeginB}
          onChange={bindingKey === 'A' ? onChangeA : onChangeB}
          onCommit={bindingKey === 'A' ? onCommitA : onCommitB}
          onCancel={bindingKey === 'A' ? onCancelA : onCancelB}
        />
      </PropertyDraftBoundary>
    )
    const view = render(renderText('A', 'alpha'))
    const input = screen.getByLabelText('文字草稿')

    fireEvent.focus(input)
    expect(onBeginA).toHaveBeenCalledTimes(1)
    view.rerender(renderText('B', 'bravo'))
    expect(input).toHaveAttribute('aria-invalid', 'true')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onStaleB).toHaveBeenCalledTimes(1)
    expect(onCommitA).not.toHaveBeenCalled()
    expect(onCancelA).not.toHaveBeenCalled()
    expect(onCommitB).not.toHaveBeenCalled()
    expect(onCancelB).not.toHaveBeenCalled()
    expect(input).toHaveValue('bravo')

    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'bravo draft' } })
    expect(onChangeB).toHaveBeenLastCalledWith('bravo draft')
    view.rerender(renderText('A', 'alpha'))
    fireEvent.change(input, { target: { value: 'bravo' } })
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
    expect(onStaleA).toHaveBeenCalledTimes(1)
    expect(onCommitB).not.toHaveBeenCalled()
    expect(onCommitA).not.toHaveBeenCalled()
    expect(input).toHaveValue('alpha')
  })

  it('buffers text IME input and commits the final value once after a composing blur', async () => {
    const onBegin = vi.fn()
    const onChange = vi.fn()
    const onCommit = vi.fn()
    const onCancel = vi.fn()
    const onCompositionChange = vi.fn()
    render(
      <PropertyDraftBoundary bindingKey="A" onStale={vi.fn()}>
        <TextContentTextarea
          label="IME 文字"
          value=""
          onBegin={onBegin}
          onChange={onChange}
          onCommit={onCommit}
          onCancel={onCancel}
          onCompositionChange={onCompositionChange}
        />
      </PropertyDraftBoundary>,
    )
    const input = screen.getByLabelText('IME 文字')
    fireEvent.focus(input)
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: '中' } })
    fireEvent.change(input, { target: { value: '中文' } })
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true, isComposing: true })
    fireEvent.blur(input)
    expect(onChange).not.toHaveBeenCalled()
    expect(onCommit).not.toHaveBeenCalled()

    fireEvent.compositionEnd(input, { data: '文' })
    await Promise.resolve()
    await Promise.resolve()
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenLastCalledWith('中文')
    expect(onCompositionChange.mock.calls).toEqual([[true], [false]])
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('commits a text IME draft once when composition ends immediately before blur', async () => {
    const onChange = vi.fn()
    const onCommit = vi.fn()
    const onCompositionChange = vi.fn()
    render(
      <PropertyDraftBoundary bindingKey="A" onStale={vi.fn()}>
        <TextContentTextarea
          label="IME 结束后失焦"
          value=""
          onBegin={vi.fn()}
          onChange={onChange}
          onCommit={onCommit}
          onCancel={vi.fn()}
          onCompositionChange={onCompositionChange}
        />
      </PropertyDraftBoundary>,
    )
    const input = screen.getByLabelText('IME 结束后失焦')
    fireEvent.focus(input)
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: '中文' } })
    fireEvent.compositionEnd(input, { data: '文' })
    fireEvent.blur(input)

    await Promise.resolve()
    await Promise.resolve()
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenLastCalledWith('中文')
    expect(onCompositionChange.mock.calls).toEqual([[true], [false]])
    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it('clears a same-value stale text session before the next target begins editing', () => {
    const beginA = vi.fn()
    const beginB = vi.fn()
    const staleB = vi.fn()
    const renderText = (bindingKey: string) => (
      <PropertyDraftBoundary
        bindingKey={bindingKey}
        onStale={bindingKey === 'B' ? staleB : vi.fn()}
      >
        <TextContentTextarea
          label="同值文字目标"
          value="same"
          onBegin={bindingKey === 'A' ? beginA : beginB}
          onChange={vi.fn()}
          onCommit={vi.fn()}
          onCancel={vi.fn()}
        />
      </PropertyDraftBoundary>
    )
    const view = render(renderText('A'))
    const input = screen.getByLabelText('同值文字目标')
    fireEvent.focus(input)
    view.rerender(renderText('B'))
    expect(input).toHaveAttribute('aria-invalid', 'true')

    fireEvent.blur(input)
    expect(staleB).toHaveBeenCalledTimes(1)
    expect(input).not.toHaveAttribute('aria-invalid')
    fireEvent.focus(input)
    expect(beginA).toHaveBeenCalledTimes(1)
    expect(beginB).toHaveBeenCalledTimes(1)
  })

  it('terminates live text edits exactly once on Escape and Ctrl+Enter', () => {
    const onCommit = vi.fn()
    const onCancel = vi.fn()
    render(
      <PropertyDraftBoundary bindingKey="A" onStale={vi.fn()}>
        <TextContentTextarea
          label="文字终止键"
          value="alpha"
          onBegin={vi.fn()}
          onChange={vi.fn()}
          onCommit={onCommit}
          onCancel={onCancel}
        />
      </PropertyDraftBoundary>,
    )
    const input = screen.getByLabelText('文字终止键')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'cancel me' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    fireEvent.blur(input)
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onCommit).not.toHaveBeenCalled()

    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'commit me' } })
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
    fireEvent.blur(input)
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it('does not auto-commit a typed common font and rejects a stale font blur', () => {
    const commitA = vi.fn()
    const commitB = vi.fn()
    const staleA = vi.fn()
    const staleB = vi.fn()
    const renderFont = (bindingKey: string, value: string) => (
      <PropertyDraftBoundary
        bindingKey={bindingKey}
        onStale={bindingKey === 'A' ? staleA : staleB}
      >
        <FontFamilyPicker
          value={value}
          onCommit={bindingKey === 'A' ? commitA : commitB}
        />
      </PropertyDraftBoundary>
    )
    const view = render(renderFont('A', 'Arial'))
    const input = screen.getByRole('combobox', { name: '字体' })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'Verdana' } })
    expect(commitA).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(commitA).not.toHaveBeenCalled()
    expect(input).toHaveValue('Arial')

    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'Custom A' } })
    view.rerender(renderFont('B', 'SimSun'))
    expect(input).toHaveAttribute('aria-invalid', 'true')
    fireEvent.blur(input)
    expect(staleB).toHaveBeenCalledTimes(1)
    expect(commitA).not.toHaveBeenCalled()
    expect(commitB).not.toHaveBeenCalled()
    expect(input).toHaveValue('SimSun')

    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'KaiTi' } })
    fireEvent.blur(input)
    expect(commitB).toHaveBeenCalledTimes(1)
    expect(commitB).toHaveBeenLastCalledWith('KaiTi')
  })

  it('commits only the final font IME value after composition ends', () => {
    const onCommit = vi.fn()
    render(
      <PropertyDraftBoundary bindingKey="A" onStale={vi.fn()}>
        <FontFamilyPicker value="Arial" onCommit={onCommit} />
      </PropertyDraftBoundary>,
    )
    const input = screen.getByRole('combobox', { name: '字体' })
    fireEvent.focus(input)
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: '思' } })
    fireEvent.change(input, { target: { value: '思源黑体' } })
    fireEvent.blur(input)
    expect(onCommit).not.toHaveBeenCalled()
    fireEvent.compositionEnd(input, { data: '体' })
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenLastCalledWith('思源黑体')
  })
})
