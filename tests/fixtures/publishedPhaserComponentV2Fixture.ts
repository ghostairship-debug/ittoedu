import { strToU8, zipSync } from 'fflate'
import { addCourseFlowPage, addCourseScene } from '../../src/renderer/course/courseLocationCommands'
import {
  openSlideAuthoringSession,
  type SlideAuthoringSession,
} from '../../src/renderer/course/slideAuthoringBackend'
import type { SlideCommandResult } from '../../src/renderer/course/slideEditorCommands'
import {
  addSlideComponentLayer,
  addSlideImageLayer,
  addSlideTextLayer,
  readSlideComponentLayer,
  upsertSlideInteractionRule,
} from '../../src/renderer/course/v9SlideContentCommands'
import { importComponentPackage } from '../../src/renderer/components/importComponentPackage'
import { createBlankCourseProject } from '../../src/renderer/project/createCourseProject'
import { courseProjectDocumentSchema } from '../../src/shared/courseProjectSchema'
import type { ComponentManifest, ComponentPackageData } from '../../src/shared/componentTypes'
import type { CourseProjectDocument } from '../../src/shared/courseProjectTypes'

const NOW = '2026-08-26T08:00:00.000Z'
export const PUBLISHED_PHASER_COMPONENT_ID = 'com.example.published-phaser-v4'
export const PUBLISHED_PHASER_COMPONENT_ITEM_ID = 'published-phaser-v4-item'

export const PUBLISHED_PHASER_COMPONENT_RUNTIME_SOURCE = `
window.CoursewareComponent.define({
  id: '${PUBLISHED_PHASER_COMPONENT_ID}',
  runtimeApiVersion: 4,
  create(ctx) {
    var probe = window.__publishedPhaserComponentV4Probe || {};
    window.__publishedPhaserComponentV4Probe = probe;
    probe.creates = (probe.creates || 0) + 1;
    probe.context = ctx.runtimeApiVersion === 4
      && ctx.renderMode === 'phaser'
      && ctx.mode === 'preview'
      && ctx.scope === 'scene'
      && !!ctx.phaser && !!ctx.phaser.Phaser && !!ctx.phaser.scene && !!ctx.phaser.root
      && !('dom' in ctx) && !('Phaser' in ctx) && !('root' in ctx) && !('editor' in ctx);
    probe.props = JSON.parse(JSON.stringify(ctx.props));
    probe.frame = { width: ctx.width, height: ctx.height };
    probe.assetUrl = ctx.assetUrl('badge');
    probe.projectAssetUrl = ctx.projectAssetUrl(String(ctx.props.projectAssetId || 'missing'));
    probe.sceneId = ctx.sceneId;
    var game = ctx.phaser.scene.game;
    var games = window.__publishedPhaserComponentV4Games || [];
    window.__publishedPhaserComponentV4Games = games;
    games.push(game);
    game.events.once(ctx.phaser.Phaser.Core.Events.DESTROY, function () {
      probe.coreDestroys = (probe.coreDestroys || 0) + 1;
    });
    game.canvas.dataset.publishedPhaserComponentV4E2e = 'true';
    var panel = ctx.phaser.scene.add.rectangle(0, 0, ctx.width, ctx.height, 0x0f766e, 1)
      .setOrigin(0, 0).setInteractive();
    var count = 0;
    var label = ctx.phaser.scene.add.text(24, 24, String(ctx.props.label) + ':0', {
      fontFamily: 'Arial', fontSize: '30px', color: '#ffffff'
    });
    var disposeLabelEditor = ctx.editor
      ? ctx.editor.registerTextRegion({
          key: 'label',
          label: 'Phaser 标题',
          maxLength: 40,
          getBounds: function () {
            return { x: 20, y: 18, width: Math.max(80, ctx.width - 40), height: 42 };
          }
        })
      : function () {};
    var onHit = function () {
      count += 1;
      label.setText(String(ctx.props.label) + ':' + count);
      probe.hits = (probe.hits || 0) + 1;
      ctx.emit('phaser:hit', { count: count, label: ctx.props.label });
    };
    panel.on('pointerup', onHit);
    ctx.phaser.root.add([panel, label]);
    return {
      setMode(mode) { probe.mode = mode; },
      resize(width, height) {
        probe.resizes = (probe.resizes || 0) + 1;
        probe.lastResize = { width: width, height: height };
        panel.setSize(width, height);
      },
      updateProps(props) {
        probe.updates = (probe.updates || 0) + 1;
        label.setText(String(props.label) + ':' + count);
      },
      setVisible(value) {
        value ? probe.visibleTrue = (probe.visibleTrue || 0) + 1
          : probe.visibleFalse = (probe.visibleFalse || 0) + 1;
      },
      suspend() {
        probe.suspends = (probe.suspends || 0) + 1;
        game.loop.stop();
        probe.stopped = !game.loop.started && !game.loop.running;
      },
      resume() {
        probe.resumes = (probe.resumes || 0) + 1;
        if (!game.loop.started) game.loop.start(game.step.bind(game));
      },
      destroy() {
        probe.destroys = (probe.destroys || 0) + 1;
        disposeLabelEditor();
        panel.off('pointerup', onHit);
        delete game.canvas.dataset.publishedPhaserComponentV4E2e;
      }
    };
  }
});
`

export interface PublishedPhaserComponentV2Fixture {
  readonly project: CourseProjectDocument
  readonly assetFiles: Record<string, Uint8Array>
  readonly components: Record<string, ComponentPackageData>
  readonly slideSurfaceId: string
  readonly slideLocationIds: readonly [string, string]
  readonly flowLocationId: string
  readonly componentId: string
  readonly componentItemId: string
}

function requireProject(
  result: { ok: boolean; project?: CourseProjectDocument; reason?: string },
): CourseProjectDocument {
  if (!result.ok || !result.project) throw new Error(result.reason ?? 'course command failed')
  return result.project
}

function requireSession(result: SlideCommandResult): SlideAuthoringSession {
  if (!result.ok || !result.nextSession) {
    throw new Error(result.reason ?? 'slide command failed')
  }
  return result.nextSession
}

function manifest(version = '4.0.0'): ComponentManifest {
  return {
    schemaVersion: 4,
    runtimeApiVersion: 4,
    id: PUBLISHED_PHASER_COMPONENT_ID,
    name: 'Published Phaser API 4',
    version,
    entry: 'runtime.js',
    defaultSize: { width: 360, height: 210 },
    minSize: { width: 120, height: 80 },
    preserveAspectRatio: false,
    supportedScopes: ['scene'],
    renderMode: 'phaser',
    assets: { badge: 'assets/badge.svg' },
    defaultProps: { label: '导入默认', projectAssetId: 'fixture-project-asset' },
    editor: {
      properties: [{ key: 'label', label: 'Phaser 标题', type: 'text', maxLength: 40 }],
    },
  }
}

export function createPublishedPhaserComponentV2Fixture(
  runtimeSource = PUBLISHED_PHASER_COMPONENT_RUNTIME_SOURCE,
): PublishedPhaserComponentV2Fixture {
  const componentManifest = manifest()
  const imported = importComponentPackage(zipSync({
    'manifest.json': strToU8(JSON.stringify(componentManifest)),
    'runtime.js': strToU8(runtimeSource),
    'assets/badge.svg': strToU8('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#14b8a6"/></svg>'),
  }))
  const projectAssetBytes = strToU8(
    '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><circle cx="4" cy="4" r="4" fill="#2563eb"/></svg>',
  )

  let id = 0
  let project = createBlankCourseProject({
    id: 'published-phaser-component-v2',
    title: 'Published Phaser Component V2',
    now: NOW,
    idFactory: () => `published-phaser-${++id}`,
  })
  const slide = project.surfaces.find((surface) => surface.type === 'slide')
  if (!slide || slide.type !== 'slide') throw new Error('expected initial Slide surface')
  project = requireProject(addCourseScene(project, {
    surfaceId: slide.id,
    title: '生命周期第二代',
    now: NOW,
    expectedRevision: project.revision,
  }))
  project = requireProject(addCourseFlowPage(project, {
    title: '暂离恢复目标',
    now: NOW,
    expectedRevision: project.revision,
  }))
  project = structuredClone(project)
  project.componentPackages[imported.manifest.id] = structuredClone(imported.metadata)
  project.assets['fixture-project-asset'] = {
    id: 'fixture-project-asset',
    filename: 'fixture.svg',
    mimeType: 'image/svg+xml',
    kind: 'image',
    path: 'assets/fixture.svg',
    byteLength: projectAssetBytes.byteLength,
    width: 8,
    height: 8,
  }
  project = courseProjectDocumentSchema.parse(project)

  const slideLocations = project.locations.filter((location): location is Extract<
    CourseProjectDocument['locations'][number],
    { kind: 'slide-scene' }
  > => location.kind === 'slide-scene' && location.surfaceId === slide.id)
  if (slideLocations.length !== 2) throw new Error('expected two Slide locations')
  let session = requireSession(addSlideComponentLayer(
    openSlideAuthoringSession(project, { locationId: slideLocations[0]!.id }),
    {
      packageId: imported.manifest.id,
      manifest: imported.manifest,
      id: PUBLISHED_PHASER_COMPONENT_ITEM_ID,
      x: 123,
      y: 87,
      width: 360,
      height: 210,
      props: { label: '真实导入', projectAssetId: 'fixture-project-asset' },
    },
    { now: NOW },
  ))
  const authored = readSlideComponentLayer(session, PUBLISHED_PHASER_COMPONENT_ITEM_ID)
  if (
    authored.component.packageId !== imported.manifest.id
    || authored.component.version !== imported.manifest.version
    || authored.frame.x !== 123
    || authored.frame.y !== 87
  ) throw new Error('Slide component authoring command output mismatch')

  session = requireSession(addSlideTextLayer(session, {
    id: 'published-phaser-order-sentinel',
    text: '层级哨兵',
    x: 16,
    y: 16,
  }, { now: NOW }))
  session = requireSession(addSlideTextLayer(session, {
    id: 'published-phaser-restart-sentinel',
    text: '重启',
    x: 160,
    y: 16,
  }, { now: NOW }))
  session = requireSession(upsertSlideInteractionRule(session, {
    id: 'published-phaser-replay-rule',
    name: 'Phaser 组件重播',
    enabled: true,
    trigger: { type: 'node.click', nodeId: 'published-phaser-order-sentinel' },
    conditions: [],
    actions: [{
      id: 'published-phaser-replay-action',
      start: 'after-previous',
      delayMs: 0,
      action: { type: 'scene.replay' },
    }],
  }, { now: NOW }))
  session = requireSession(upsertSlideInteractionRule(session, {
    id: 'published-phaser-restart-rule',
    name: 'Phaser 组件整课重启',
    enabled: true,
    trigger: { type: 'node.click', nodeId: 'published-phaser-restart-sentinel' },
    conditions: [],
    actions: [{
      id: 'published-phaser-restart-action',
      start: 'after-previous',
      delayMs: 0,
      action: { type: 'course.restart' },
    }],
  }, { now: NOW }))
  project = session.history.present
  let secondSession = requireSession(addSlideTextLayer(
    openSlideAuthoringSession(project, { locationId: slideLocations[1]!.id }),
    { id: 'published-phaser-second-scene', text: '第二代', x: 24, y: 24 },
    { now: NOW },
  ))
  secondSession = requireSession(addSlideImageLayer(secondSession, {
    id: 'published-phaser-project-asset-reference',
    assetId: 'fixture-project-asset',
    x: 24,
    y: 72,
    width: 8,
    height: 8,
  }, { now: NOW }))
  project = courseProjectDocumentSchema.parse(secondSession.history.present)
  const flowLocation = project.locations.find((location) => location.kind === 'flow-block')
  if (!flowLocation) throw new Error('expected Flow pause location')
  return {
    project,
    assetFiles: { 'fixture-project-asset': projectAssetBytes },
    components: { [imported.manifest.id]: imported },
    slideSurfaceId: slide.id,
    slideLocationIds: [slideLocations[0]!.id, slideLocations[1]!.id],
    flowLocationId: flowLocation.id,
    componentId: imported.manifest.id,
    componentItemId: PUBLISHED_PHASER_COMPONENT_ITEM_ID,
  }
}
