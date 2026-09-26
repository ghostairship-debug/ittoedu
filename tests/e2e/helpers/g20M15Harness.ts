import type { Page } from '@playwright/test'
import { createBlankCourseProject } from '../../../src/core/course/createCourseProject'
import { createCourseProjectArchive } from '../../../src/core/drivers/codecs/courseProjectArchive'
import { componentPackagesToArchiveFiles } from '../../../src/renderer/components/componentPackageStore'
import { componentContentSha256 } from '../../../src/shared/componentContentIntegrity'
import { componentPackageMeta } from '../../../src/shared/componentPackageMeta'
import { courseProjectDocumentSchema } from '../../../src/shared/courseProjectSchema'
import type { ComponentManifest, ComponentPackageData } from '../../../src/shared/componentTypes'
import type { CourseProjectDocument } from '../../../src/shared/courseProjectTypes'
import { createDefaultTeacherControllerPackage } from '../../../src/shared/defaultTeacherControllerComponent'
import { solidPng, textBlock } from './g20M19Harness'

/** Fixtures for the M15 acceptance specs: a quiz Runtime and a word card component that draw their own text. */
export const CANVAS = { width: 1280, height: 720 }
export const QUESTIONS = ['听录音，选出正确的图片', '跟读句子：How are you?', '看图说话：这是什么？'] as const
export const QUIZ_FRAME = { x: 40, y: 140, width: 760, height: 420 }
export const CARD_FRAME = { x: 840, y: 140, width: 400, height: 300 }
export const HERO = solidPng(256, 144, [37, 99, 235])
export const PIC = solidPng(160, 90, [22, 163, 74])

/**
 * A DOM Runtime (API 2) that registers nothing: the question comes from a list in its source, its progress is a local
 * counter, the answers it counts go to the course state, and a picture comes from its asset binding `hero`.
 * `window.__m15Quiz.creates` counts its instances.
 */
export const QUIZ_SOURCE = `CoursewareRuntime.define({
  runtimeApiVersion: 2,
  create(ctx) {
    var probe = window.__m15Quiz = window.__m15Quiz || { creates: 0 };
    probe.creates += 1;
    var questions = ${JSON.stringify(QUESTIONS)};
    var index = 0;
    var answered = ctx.courseState.get('answered') || 0;
    var panel = document.createElement('div');
    panel.style.cssText = 'position:absolute;inset:0;background:#fef3c7;';
    var heading = document.createElement('h2');
    heading.setAttribute('data-m15-question', '');
    heading.style.cssText = 'position:absolute;left:24px;top:20px;margin:0;font:bold 34px sans-serif;color:#7c2d12;white-space:nowrap;';
    var count = document.createElement('p');
    count.setAttribute('data-m15-count', '');
    count.style.cssText = 'position:absolute;left:24px;top:86px;margin:0;font:22px sans-serif;color:#92400e;white-space:nowrap;';
    var picture = document.createElement('img');
    picture.alt = '';
    picture.setAttribute('data-m15-picture', '');
    picture.style.cssText = 'position:absolute;left:24px;top:150px;width:256px;height:144px;';
    var next = document.createElement('button');
    next.type = 'button';
    next.textContent = '下一题';
    next.setAttribute('data-m15-next', '');
    next.style.cssText = 'position:absolute;left:24px;bottom:24px;font:22px sans-serif;padding:8px 20px;pointer-events:auto;';
    var render = function () {
      heading.textContent = questions[index];
      count.textContent = '已作答 ' + answered + ' 题';
    };
    next.addEventListener('click', function () {
      index = (index + 1) % questions.length;
      answered += 1;
      ctx.courseState.set('answered', answered);
      render();
    });
    picture.src = ctx.assets.url('hero');
    panel.append(heading, count, picture, next);
    ctx.dom.root.appendChild(panel);
    render();
    return { destroy: function () { panel.remove(); } };
  }
});`

const CARD_SOURCE = `window.CoursewareComponent.define({
  id: 'm15-card',
  runtimeApiVersion: 4,
  create(context) {
    var root = context.dom.root;
    root.innerHTML = '<section style="position:absolute;inset:0;background:#e0f2fe;">'
      + '<h3 data-m15-card-title style="position:absolute;left:16px;top:12px;margin:0;font:bold 28px sans-serif;color:#0c4a6e;white-space:nowrap;">词语卡片</h3>'
      + '<img data-m15-card-picture alt="" style="position:absolute;left:16px;top:64px;width:160px;height:90px;">'
      + '<p data-m15-card-answer hidden style="position:absolute;left:200px;top:90px;margin:0;font:24px sans-serif;color:#075985;white-space:nowrap;">答案：苹果</p>'
      + '<button type="button" data-m15-card-toggle style="position:absolute;left:16px;bottom:16px;font:20px sans-serif;padding:6px 14px;pointer-events:auto;">看答案</button>'
      + '</section>';
    root.querySelector('img').setAttribute('src', context.assetUrl('pic'));
    root.querySelector('button').addEventListener('click', function () { root.querySelector('p').hidden = false; });
    return { destroy: function () { root.innerHTML = ''; } };
  },
});`

export function cardPackage(): ComponentPackageData {
  const manifest: ComponentManifest = {
    schemaVersion: 4, runtimeApiVersion: 4, id: 'm15-card', version: '1.0.0', name: '词语卡片', description: 'M15 验收用组件：自己显示文字与图片',
    thumbnail: 'thumbnail.svg', entry: 'runtime.js', renderMode: 'dom', supportedScopes: ['scene'], defaultSize: { width: 400, height: 300 },
    minSize: { width: 80, height: 60 }, preserveAspectRatio: false, assets: { pic: 'pic.png' }, defaultProps: {}, editor: { properties: [] },
  } as unknown as ComponentManifest
  const encode = (value: string) => new TextEncoder().encode(value)
  const files = {
    'manifest.json': encode(JSON.stringify(manifest, null, 2)), 'runtime.js': encode(CARD_SOURCE), 'pic.png': PIC,
    'thumbnail.svg': encode('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="#e0f2fe"/></svg>'),
  }
  return { manifest, runtimeSource: CARD_SOURCE, files, contentSha256: componentContentSha256(files) }
}

/** One Slide page: a title, the quiz Runtime and the word card component. */
export function liveCourse(title = 'M15 运行现场'): Uint8Array {
  const project: CourseProjectDocument = createBlankCourseProject({ title, canvas: CANVAS })
  const surface = project.surfaces[0]
  if (surface?.type !== 'slide') throw new Error('slide surface')
  const base = { visible: true, locked: false, rotation: 0, opacity: 1, hitPolicy: 'surface', playbackInitialVisibility: 'inherit' }
  surface.scenes[0]!.layerItems = [
    textBlock('title', { x: 40, y: 40, width: 360, height: 72 }, '听力练习', '#245b46', 1),
    { ...base, kind: 'runtime', layerItemId: 'quiz', label: '小测验', frame: { mode: 'absolute', ...QUIZ_FRAME }, order: 2,
      runtime: { protocol: 'canvas-runtime', runtimeApiVersion: 2, enabled: true, renderMode: 'dom', source: QUIZ_SOURCE, content: { values: {} }, assets: { hero: { assetId: 'hero' } } } },
    { ...base, kind: 'component', layerItemId: 'card', label: '词语卡片', frame: { mode: 'absolute', ...CARD_FRAME }, order: 3,
      component: { packageId: 'm15-card', version: '1.0.0' }, props: {} },
  ] as never
  project.assets = { hero: { id: 'hero', filename: 'hero.png', mimeType: 'image/png', kind: 'image', path: 'assets/hero.png', byteLength: HERO.byteLength, width: 256, height: 144 } } as never
  const card = cardPackage(), controller = createDefaultTeacherControllerPackage()
  project.componentPackages['m15-card'] = componentPackageMeta(card)
  return createCourseProjectArchive({ project: courseProjectDocumentSchema.parse(project), assetFiles: { hero: HERO },
    componentFiles: componentPackagesToArchiveFiles({ [controller.manifest.id]: controller, [card.manifest.id]: card }) })
}

export interface LiveCourseState {
  revision: number
  dirty: boolean
  quiz: { source: string; overrides: unknown[]; assets: Record<string, { assetId: string }>; locked: boolean }
  card: { textOverrides: unknown[]; assetOverrides: Record<string, { assetId: string }>; locked: boolean }
  assets: string[]
}

/** The course as the main process holds it. */
export async function liveCourseState(page: Page, file: string): Promise<LiveCourseState> {
  return page.evaluate(async file => {
    const found = (await window.desktopAPI.documents!.list()).find(entry => entry.binding.kind === 'file' && entry.binding.path.endsWith(file))
    if (!found || found.model.kind !== 'course-v9') throw new Error(`no course ${file}`)
    const slide = found.model.project.surfaces.find(surface => surface.type === 'slide')
    if (slide?.type !== 'slide') throw new Error('slide surface')
    const items = slide.scenes[0]!.layerItems
    const quiz = items.find(item => item.layerItemId === 'quiz'), card = items.find(item => item.layerItemId === 'card')
    if (quiz?.kind !== 'runtime' || card?.kind !== 'component') throw new Error('quiz and card')
    return {
      revision: found.revision, dirty: found.dirty,
      quiz: { source: quiz.runtime.source, overrides: [...(quiz.runtime.content.overrides ?? [])], assets: quiz.runtime.assets, locked: quiz.locked },
      card: { textOverrides: [...(card.textOverrides ?? [])], assetOverrides: card.assetOverrides ?? {}, locked: card.locked },
      assets: Object.keys(found.model.project.assets).sort(),
    }
  }, file)
}
