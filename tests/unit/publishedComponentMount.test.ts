import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ComponentAuthoringTargetUpdate,
  ComponentPackageData,
} from '../../src/shared/componentTypes'
import type {
  PublishedCourseComponent,
} from '../../src/shared/publishedCourseTypes'
import type { ExternalComponentNode } from '../../src/shared/projectTypes'
import {
  findComponentPackageSource,
  mountPublishedComponent,
} from '../../src/player/surfaces/publishedComponentMount'
import { ComponentRegistry } from '../../src/player/ComponentRegistry'

function encodeUtf16LeBase64(source: string): { encoding: 'base64-utf16le'; data: string } {
  const bytes = new Uint8Array(source.length * 2)
  for (let i = 0; i < source.length; i++) {
    const code = source.charCodeAt(i)
    bytes[i * 2] = code & 0xff
    bytes[i * 2 + 1] = code >>> 8
  }
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return { encoding: 'base64-utf16le', data: btoa(binary) }
}

const RUNTIME_CODE = `
window.CoursewareComponent.define({
  id: 'counter-component',
  runtimeApiVersion: 4,
  create(context) {
    const button = document.createElement('button')
    button.className = 'interactive-counter-btn'
    button.textContent = (context.props.label || 'Counter') + ': ' + (context.props.count || 0)
    button.addEventListener('click', () => {
      context.emit('counter:click', { count: (context.props.count || 0) + 1 })
    })
    context.dom.root.appendChild(button)
    return {
      setMode(mode) {
        button.dataset.mode = mode
      },
      resize(w, h) {
        button.style.width = w + 'px'
        button.style.height = h + 'px'
      },
      updateProps(props) {
        button.textContent = (props.label || 'Counter') + ': ' + (props.count || 0)
      },
      destroy() {
        button.remove()
      },
    }
  },
})
`

const AUTHORING_RUNTIME_CODE = `
window.CoursewareComponent.define({
  id: 'authoring-component',
  runtimeApiVersion: 4,
  create(context) {
    var width = context.width
    var probe = window.__publishedDomAuthoringProbe = {
      hasEditor: !!context.editor,
      destroys: 0
    }
    context.editor.registerTextRegion({
      key: 'label',
      getBounds: function () {
        return { x: 10, y: 12, width: width / 2, height: 24 }
      }
    })
    return {
      setMode(mode) { probe.mode = mode },
      resize(nextWidth) {
        width = nextWidth
        context.editor.invalidate()
      },
      updateProps(props) { probe.props = props },
      destroy() { probe.destroys += 1 },
    }
  },
})
`

const CAPTURE_RUNTIME_CODE = `
window.CoursewareComponent.define({
  id: 'counter-component',
  runtimeApiVersion: 4,
  create(context) {
    var probe = window.__publishedCaptureComponentProbe = {
      waited: false,
      prepares: 0,
      suspends: 0,
      resumes: 0,
      destroys: 0
    }
    context.capture.waitUntil(Promise.resolve().then(function () {
      probe.waited = true
    }))
    var content = document.createElement('div')
    content.dataset.captureComponentContent = 'true'
    context.dom.root.appendChild(content)
    return {
      setMode(mode) { probe.mode = mode },
      prepareCapture() { probe.prepares += 1 },
      suspend() { probe.suspends += 1 },
      resume() { probe.resumes += 1 },
      destroy() {
        probe.destroys += 1
        content.remove()
      },
    }
  },
})
`

function authoringNode(
  overrides: Partial<ExternalComponentNode> = {},
): ExternalComponentNode {
  return {
    id: 'authoring-instance',
    name: '可编辑组件',
    type: 'external-component',
    x: 100,
    y: 80,
    width: 200,
    height: 60,
    rotation: 0,
    opacity: 1,
    visible: true,
    playbackInitialVisibility: 'inherit',
    locked: false,
    component: { packageId: 'authoring-component', version: '1.0.0' },
    props: { label: '初始文字' },
    ...overrides,
  }
}

async function flushAuthoringTargets(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('publishedComponentMount helper', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('mounts and runs a Component API 4 DOM component from PublishedCourseComponent', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)

    const publishedComp: PublishedCourseComponent = {
      id: 'counter-component',
      name: '计数器',
      version: '1.0.0',
      contentSha256: 'dummy-sha',
      apiVersion: 4,
      scopes: ['scene', 'global'],
      renderMode: 'dom',
      code: encodeUtf16LeBase64(RUNTIME_CODE),
      assets: {},
    }

    const registry = new ComponentRegistry()
    const emittedEvents: any[] = []
    const handle = mountPublishedComponent(container, {
      container,
      componentId: 'counter-component',
      version: '1.0.0',
      instanceId: 'inst-1',
      width: 200,
      height: 60,
      props: { label: '点击次数', count: 5 },
      components: { 'counter-component@1.0.0': publishedComp },
      registry,
      interactive: true,
      emit: (eventName, payload) => {
        emittedEvents.push({ eventName, payload })
      },
    })

    expect(handle.ok).toBe(true)
    expect(handle.instanceId).toBe('inst-1')
    expect(handle.componentId).toBe('counter-component')

    const mountEl = container.querySelector<HTMLElement>('.published-component-mount')
    expect(mountEl).not.toBeNull()
    const shadow = mountEl?.shadowRoot
    expect(shadow).not.toBeNull()

    const button = shadow?.querySelector<HTMLButtonElement>('.interactive-counter-btn')
    expect(button).not.toBeNull()
    expect(button?.textContent).toBe('点击次数: 5')

    // Click interactive button
    button?.click()
    expect(emittedEvents).toEqual([{ eventName: 'counter:click', payload: { count: 6 } }])

    // Update props
    handle.updateProps({ label: '已更新', count: 10 })
    expect(button?.textContent).toBe('已更新: 10')

    // Destroy
    handle.destroy()
    expect(container.querySelector('.published-component-mount')).toBeNull()
  })

  it('mounts a component from ComponentPackageData in authoring mode', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)

    const packageData: ComponentPackageData = {
      manifest: {
        schemaVersion: 4,
        runtimeApiVersion: 4,
        id: 'counter-component',
        name: '计数器',
        version: '1.0.0',
        entry: 'runtime.js',
        defaultSize: { width: 200, height: 60 },
        minSize: { width: 100, height: 40 },
        preserveAspectRatio: false,
        supportedScopes: ['scene', 'global'],
        renderMode: 'dom',
        defaultProps: { label: '默认', count: 0 },
        assets: {},
      },
      runtimeSource: RUNTIME_CODE,
      files: {},
      metadata: {
        packageId: 'counter-component',
        version: '1.0.0',
        contentSha256: 'dummy',
        embeddedAt: '2026-08-18',
        sourceTrust: 'built-in',
      },
    } as unknown as ComponentPackageData

    const registry = new ComponentRegistry()
    const handle = mountPublishedComponent(container, {
      container,
      componentId: 'counter-component',
      version: '1.0.0',
      instanceId: 'inst-edit',
      width: 150,
      height: 50,
      props: { label: '编辑态', count: 3 },
      components: { 'counter-component': packageData },
      registry,
      mode: 'edit',
      interactive: false,
    })

    expect(handle.ok).toBe(true)
    const mountEl = container.querySelector<HTMLElement>('.published-component-mount')
    const shadow = mountEl?.shadowRoot
    const button = shadow?.querySelector<HTMLButtonElement>('.interactive-counter-btn')
    expect(button?.dataset.mode).toBe('edit')
    expect(button?.textContent).toBe('编辑态: 3')

    handle.destroy()
  })

  it('wires DOM authoring targets through resize, props, node updates and teardown', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const packageData: ComponentPackageData = {
      manifest: {
        schemaVersion: 4,
        runtimeApiVersion: 4,
        id: 'authoring-component',
        name: '可编辑组件',
        version: '1.0.0',
        entry: 'runtime.js',
        defaultSize: { width: 200, height: 60 },
        minSize: { width: 100, height: 30 },
        preserveAspectRatio: false,
        supportedScopes: ['scene'],
        renderMode: 'dom',
        assets: {},
        defaultProps: { label: '默认文字' },
        editor: {
          properties: [{ key: 'label', label: '文字', type: 'text' }],
        },
      },
      runtimeSource: AUTHORING_RUNTIME_CODE,
      files: {},
    }
    const node = authoringNode()
    const updates: Array<Readonly<ComponentAuthoringTargetUpdate>> = []
    const handle = mountPublishedComponent(container, {
      container,
      componentId: 'authoring-component',
      version: '1.0.0',
      instanceId: node.id,
      width: node.width,
      height: node.height,
      props: node.props,
      components: { 'authoring-component': packageData },
      mode: 'edit',
      scope: 'scene',
      sceneId: 'scene-one',
      authoring: {
        node,
        onTargetsChanged: (update) => updates.push(update),
      },
    })

    await flushAuthoringTargets()
    expect(handle.ok).toBe(true)
    expect(Reflect.get(window, '__publishedDomAuthoringProbe')).toMatchObject({
      hasEditor: true,
      mode: 'edit',
    })
    expect(updates.at(-1)).toMatchObject({
      scope: 'scene',
      sceneId: 'scene-one',
      nodeId: node.id,
      targets: [{ key: 'label', bounds: { x: 110, y: 92, width: 100, height: 24 } }],
    })

    handle.resize(300, 60)
    await flushAuthoringTargets()
    expect(updates.at(-1)?.targets[0]?.bounds.width).toBe(150)

    handle.updateProps({ label: 7 })
    await flushAuthoringTargets()
    expect(updates.at(-1)?.targets).toEqual([])

    const moved = authoringNode({ x: 400, props: { label: '恢复文字' } })
    handle.updateAuthoringNode(moved)
    await flushAuthoringTargets()
    expect(updates.at(-1)?.targets[0]?.bounds.x).toBe(410)

    handle.destroy()
    expect(updates.at(-1)?.targets).toEqual([])
    expect(Reflect.get(window, '__publishedDomAuthoringProbe')).toMatchObject({ destroys: 1 })
  })

  it('renders a fallback image with resolved URL when package is missing and fallback asset exists', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)

    const handle = mountPublishedComponent(container, {
      container,
      componentId: 'missing-pkg',
      version: '1.0.0',
      instanceId: 'inst-fallback',
      width: 200,
      height: 100,
      staticFallbackAssetId: 'fallback-img-1',
      resolveAsset: (id) => (id === 'fallback-img-1' ? 'https://example.test/fallback.png' : undefined),
    })

    expect(handle.ok).toBe(false)
    const fallbackEl = container.querySelector('.published-component-fallback')
    expect(fallbackEl).not.toBeNull()
    const img = fallbackEl?.querySelector('img')
    expect(img).not.toBeNull()
    expect(img?.getAttribute('src')).toBe('https://example.test/fallback.png')
    expect(img?.getAttribute('src')).not.toBe('')

    handle.destroy()
    expect(container.querySelector('.published-component-fallback')).toBeNull()
  })

  it('renders a fallback label when package and fallback asset are both missing', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)

    const handle = mountPublishedComponent(container, {
      container,
      componentId: 'missing-pkg',
      version: '2.0.0',
      width: 200,
      height: 100,
    })

    expect(handle.ok).toBe(false)
    const fallbackEl = container.querySelector('.published-component-fallback')
    expect(fallbackEl).not.toBeNull()
    const label = fallbackEl?.querySelector('.published-component-fallback-label')
    expect(label?.textContent).toContain('[组件后备：missing-pkg@2.0.0]')

    handle.destroy()
  })

  it('captures a real DOM package and reserves static fallback for unavailable packages', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)

    const publishedComp: PublishedCourseComponent = {
      id: 'counter-component',
      name: '计数器',
      version: '1.0.0',
      contentSha256: 'dummy-sha',
      apiVersion: 4,
      scopes: ['scene', 'global'],
      renderMode: 'dom',
      code: encodeUtf16LeBase64(CAPTURE_RUNTIME_CODE),
      assets: {},
    }

    const handle = mountPublishedComponent(container, {
      container,
      componentId: 'counter-component',
      version: '1.0.0',
      width: 200,
      height: 100,
      mode: 'capture',
      staticFallbackAssetId: 'capture-fallback',
      resolveAsset: (id) => (id === 'capture-fallback' ? 'https://example.test/capture.png' : undefined),
      components: { 'counter-component': publishedComp },
    })

    expect(handle.ok).toBe(true)
    expect(container.querySelector('.published-component-fallback')).toBeNull()
    const captureRoot = container.querySelector<HTMLElement>('.published-component-mount')
      ?.shadowRoot
    expect(captureRoot?.querySelector('[data-capture-component-content="true"]')).not.toBeNull()

    await handle.waitForCaptureReady()
    expect(Reflect.get(window, '__publishedCaptureComponentProbe')).toMatchObject({
      mode: 'capture',
      waited: true,
      prepares: 1,
      suspends: 1,
      resumes: 0,
    })
    handle.restoreAfterCapture()
    expect(Reflect.get(window, '__publishedCaptureComponentProbe')).toMatchObject({ resumes: 1 })

    handle.destroy()
    expect(Reflect.get(window, '__publishedCaptureComponentProbe')).toMatchObject({ destroys: 1 })
    Reflect.deleteProperty(window, '__publishedCaptureComponentProbe')
  })
})
