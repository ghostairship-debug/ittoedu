import { describe, expect, it, vi } from 'vitest'
import type { RuntimeHostOptions } from '@/player/RuntimeHost'

const runtimeHostOptions = vi.hoisted(() => [] as RuntimeHostOptions[])

vi.mock('phaser', () => ({}))
vi.mock('@/player/RuntimeHost', () => ({
  RuntimeHost: class RuntimeHost {
    constructor(options: RuntimeHostOptions) {
      runtimeHostOptions.push(options)
    }

    getFailure(): null {
      return null
    }

    setVisible(): void {}
    suspend(): void {}
    resume(): void {}
    destroy(): void {}
  },
}))
vi.mock('@/player/RuntimeRegistry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/player/RuntimeRegistry')>()
  return {
    ...actual,
    RuntimeRegistry: class RuntimeRegistry {
      dispose(): void {}
    },
  }
})

import { CourseStateStore } from '@/player/CourseStateStore'
import {
  mountPublishedCanvasRuntime,
} from '@/player/surfaces/runtime/publishedCanvasRuntimeMount'
import {
  createPublishedSurfaceRuntimeSession,
  mountPublishedSurfaceRuntime,
} from '@/player/surfaces/runtime/publishedSurfaceRuntimeMount'
import {
  PublishedSurfaceRuntimeAuthoringTargets,
} from '@/player/surfaces/runtime/publishedSurfaceRuntimeAuthoringTargets'
import type { PublishedRuntimeLayerItem } from '@/shared/publishedCourseTypes'

function encodeSource(source: string): PublishedRuntimeLayerItem['runtime']['code'] {
  const bytes = new Uint8Array(source.length * 2)
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index)
    bytes[index * 2] = code & 0xff
    bytes[index * 2 + 1] = code >>> 8
  }
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return { encoding: 'base64-utf16le', data: btoa(binary) }
}

function runtime(
  protocol: 'canvas-runtime' | 'surface-runtime',
  source: string,
): PublishedRuntimeLayerItem['runtime'] {
  return {
    protocol,
    runtimeApiVersion: protocol === 'canvas-runtime' ? 2 : 3,
    enabled: true,
    renderMode: 'dom',
    code: encodeSource(source),
    content: {
      values: { title: 'Title' },
      metadata: { title: { label: 'Title label', multiline: true } },
    },
    assets: { hero: { assetId: 'asset-hero' } },
  }
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  }
}

async function flushTargets(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('Published Runtime authoring mounts', () => {
  it('maps API 2 authoring to RuntimeHost capture and forwards the isolated state/target sink', async () => {
    runtimeHostOptions.length = 0
    const container = document.createElement('div')
    document.body.append(container)
    const session = createPublishedSurfaceRuntimeSession()
    const authoringState = new CourseStateStore()
    const onTargetsChanged = vi.fn()
    const handle = mountPublishedCanvasRuntime(container, {
      instanceId: 'canvas-authoring',
      runtime: runtime('canvas-runtime', 'CoursewareRuntime.define({})'),
      width: 640,
      height: 360,
      visible: true,
      mode: 'authoring',
      resolveAsset: () => undefined,
      session,
      courseState: authoringState,
      authoring: {
        scope: 'scene',
        sceneId: 'scene-one',
        onTargetsChanged,
      },
    })

    await handle.waitForReady()
    expect(runtimeHostOptions).toHaveLength(1)
    expect(runtimeHostOptions[0]).toMatchObject({
      mode: 'capture',
      scope: 'scene',
      sceneId: 'scene-one',
      courseState: authoringState,
      authoring: { onTargetsChanged },
    })

    handle.destroy()
    session.destroy()
    container.remove()
  })

  it('publishes API 3 explicit and declarative targets in inspect mode and clears them on destroy', async () => {
    const source = `
      CoursewareRuntime.define({
        runtimeApiVersion: 3,
        create(ctx) {
          window.__surfaceAuthoringProbe = {
            mode: ctx.mode,
            state: ctx.courseState.get('isolation'),
            missingRejected: false,
            invalidate: function () { ctx.authoring.invalidate(); }
          };
          try {
            ctx.authoring.registerText({ key: 'missing', bounds: { x: 0, y: 0, width: 10, height: 10 } });
          } catch (error) {
            window.__surfaceAuthoringProbe.missingRejected = true;
          }
          var dispose = ctx.authoring.registerText({
            key: 'title',
            label: 'Explicit title',
            bounds: { x: 10, y: 20, width: 100, height: 50 }
          });
          var title = document.createElement('div');
          title.dataset.coursewareContentKey = 'title';
          ctx.dom.root.appendChild(title);
          ctx.dom.root.dataset.coursewareAssetKey = 'hero';
          var shadowHost = document.createElement('div');
          shadowHost.dataset.shadowHost = 'true';
          ctx.dom.root.appendChild(shadowHost);
          var shadowRoot = shadowHost.attachShadow({ mode: 'open' });
          var shadowTitle = document.createElement('div');
          shadowTitle.dataset.coursewareEditKey = 'title';
          shadowTitle.textContent = ctx.content.get('title');
          shadowRoot.appendChild(shadowTitle);
          var disposeShadow = ctx.authoring.registerText({
            key: 'title',
            label: 'Shadow title',
            element: shadowTitle
          });
          return {
            setMode(mode) { window.__surfaceAuthoringProbe.setMode = mode; },
            destroy() { disposeShadow(); dispose(); title.remove(); shadowHost.remove(); }
          };
        }
      });
    `
    const frame = document.createElement('iframe')
    document.body.append(frame)
    const frameDocument = frame.contentDocument
    const view = frame.contentWindow
    if (!frameDocument || !view) throw new Error('JSDOM iframe realm unavailable')
    const container = frameDocument.createElement('div')
    frameDocument.body.append(container)
    const session = createPublishedSurfaceRuntimeSession()
    session.courseState.set('isolation', 'session')
    const authoringState = new CourseStateStore()
    authoringState.set('isolation', 'authoring')
    const updates: Array<{ targets: ReadonlyArray<{ kind: string; key: string }> }> = []
    const handle = mountPublishedSurfaceRuntime(container, {
      instanceId: 'surface-authoring',
      runtime: runtime('surface-runtime', source),
      width: 640,
      height: 360,
      visible: true,
      mode: 'authoring',
      resolveAsset: () => undefined,
      session,
      courseState: authoringState,
      authoring: {
        scope: 'scene',
        sceneId: 'scene-one',
        onTargetsChanged: (update) => updates.push(update),
      },
    })
    expect(handle.ok).toBe(true)
    await handle.waitForReady()

    const probe = Reflect.get(view, '__surfaceAuthoringProbe') as Record<string, unknown>
    expect(probe).toMatchObject({
      mode: 'inspect',
      setMode: 'inspect',
      state: 'authoring',
      missingRejected: true,
    })
    const root = container.querySelector<HTMLElement>('[data-surface-runtime-root]')
    const title = root?.querySelector<HTMLElement>('[data-courseware-content-key="title"]')
    const shadowTitle = root
      ?.querySelector<HTMLElement>('[data-shadow-host="true"]')
      ?.shadowRoot
      ?.querySelector<HTMLElement>('[data-courseware-edit-key="title"]')
    if (!root || !title || !shadowTitle) throw new Error('Surface Runtime authoring DOM missing')
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(rect(100, 50, 640, 360))
    vi.spyOn(title, 'getBoundingClientRect').mockReturnValue(rect(164, 86, 320, 72))
    vi.spyOn(shadowTitle, 'getBoundingClientRect').mockReturnValue(rect(132, 68, 160, 36))
    const invalidate = probe.invalidate
    if (typeof invalidate !== 'function') throw new Error('authoring invalidation hook missing')
    invalidate()
    await flushTargets()

    expect(updates.at(-1)).toMatchObject({
      scope: 'scene',
      sceneId: 'scene-one',
      targets: expect.arrayContaining([
        expect.objectContaining({
          kind: 'text',
          key: 'title',
          source: 'registered',
          bounds: { x: 20, y: 40, width: 200, height: 100 },
        }),
        expect.objectContaining({
          kind: 'text',
          key: 'title',
          source: 'registered',
          bounds: { x: 128, y: 72, width: 640, height: 144 },
        }),
        expect.objectContaining({
          kind: 'text',
          key: 'title',
          source: 'registered',
          bounds: { x: 64, y: 36, width: 320, height: 72 },
        }),
        expect.objectContaining({
          kind: 'asset',
          key: 'hero',
          source: 'registered',
          bounds: { x: 0, y: 0, width: 1280, height: 720 },
        }),
      ]),
    })

    expect(handle.applyAuthoringContentValue('title', 'Updated title')).toBe(true)
    expect(shadowTitle.textContent).toBe('Updated title')

    const hero = frameDocument.createElement('img')
    hero.dataset.coursewareAssetKey = 'hero'
    vi.spyOn(hero, 'getBoundingClientRect').mockReturnValue(rect(100, 50, 128, 72))
    root.appendChild(hero)
    await vi.waitFor(() => {
      expect(updates.at(-1)?.targets).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'asset', key: 'hero' }),
      ]))
    })

    const dynamicShadowHost = frameDocument.createElement('div')
    const dynamicShadow = dynamicShadowHost.attachShadow({ mode: 'open' })
    const dynamicHero = frameDocument.createElement('img')
    dynamicHero.dataset.coursewareAssetKey = 'hero'
    vi.spyOn(dynamicHero, 'getBoundingClientRect').mockReturnValue(rect(228, 122, 64, 36))
    dynamicShadow.appendChild(dynamicHero)
    root.appendChild(dynamicShadowHost)
    await vi.waitFor(() => {
      expect(updates.at(-1)?.targets).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: 'asset',
          key: 'hero',
          bounds: { x: 256, y: 144, width: 128, height: 72 },
        }),
      ]))
    })

    handle.destroy()
    expect(updates.at(-1)?.targets).toEqual([])
    session.destroy()
    frame.remove()
  })

  it('re-normalizes explicit API 3 bounds after a logical resize', async () => {
    const root = document.createElement('div')
    const updates: Array<{ targets: ReadonlyArray<{ bounds: unknown }> }> = []
    const targets = new PublishedSurfaceRuntimeAuthoringTargets({
      root,
      width: 640,
      height: 360,
      content: { values: { title: 'Title' } },
      assets: {},
      authoring: {
        scope: 'global',
        onTargetsChanged: (update) => updates.push(update),
      },
    })
    targets.registerText({
      key: 'title',
      bounds: { x: 10, y: 20, width: 100, height: 50 },
    })
    await flushTargets()
    expect(updates.at(-1)?.targets[0]?.bounds).toEqual({
      x: 20,
      y: 40,
      width: 200,
      height: 100,
    })

    targets.resize(1280, 720)
    await flushTargets()
    expect(updates.at(-1)?.targets[0]?.bounds).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 50,
    })
    targets.destroy()
  })
})
