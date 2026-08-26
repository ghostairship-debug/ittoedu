import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { courseProjectDocumentSchema } from '../src/shared/courseProjectSchema'
import type {
  CourseProjectDocument,
  RuntimeLayerItem,
  SlideSceneDocument,
} from '../src/shared/courseProjectTypes'
import {
  PUBLISHED_COURSE_FORMAT,
  PUBLISHED_COURSE_VERSION,
} from '../src/shared/publishedCourseTypes'
import { buildPublishedCourseStandaloneHtml } from '../src/renderer/export/course/buildCoursePackages'
import { buildPublishedCourseV2Payload } from '../src/renderer/export/course/buildPublishedCourse'
import { createBlankCourseProject } from '../src/renderer/project/createCourseProject'
import {
  createCourseProjectArchive,
  openCourseProjectArchive,
} from '../src/renderer/project/courseProjectArchive'
import {
  checkTrackedExampleOutputs,
  createTimezoneStableZipMtime,
  type GeneratedExampleOutputs,
} from './exampleGenerationBoundary'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(scriptDirectory, '..')
const examplesDirectory = path.join(root, 'examples')
export const INTERACTIVE_LESSON_TRACKED_OUTPUT_PATHS = {
  lesson: 'photosynthesis-interactive-lesson.h5lesson',
} as const
const artifactDirectory = path.join(root, 'artifacts', 'photosynthesis-lesson')
const htmlPath = path.join(artifactDirectory, 'photosynthesis-interactive-lesson.html')
/** 写进工程数据的业务时刻（`createdAt`/`updatedAt`）。 */
const timestamp = '2026-07-21T00:00:00.000Z'
/** 只用于 ZIP 封装的时间戳，与上面的业务时刻分开。 */
const archiveZipMtime = createTimezoneStableZipMtime(timestamp)

const runtimeSource = String.raw`
CoursewareRuntime.define({
  protocol: 'surface-runtime',
  runtimeApiVersion: 3,
  create: function (ctx) {
    var root = ctx.dom.root;
    var page = Number(ctx.content.get('page'));
    var accent = ctx.content.get('accent');
    var titles = [
      '一片叶子，如何把阳光变成生命能量？',
      '环境改变，光合效率会怎样变化？',
      '把光合作用“组装”起来'
    ];
    var subtitles = [
      '依次点击三种输入，启动这条能量路径。',
      '改变实验条件，观察光合效率的响应。',
      '操作两张卡片，完成最后的知识挑战。'
    ];
    var listeners = [];

    function element(tag, styles, text) {
      var node = document.createElement(tag);
      Object.assign(node.style, styles || {});
      if (text !== undefined) node.textContent = text;
      return node;
    }

    function listen(node, type, handler) {
      node.addEventListener(type, handler);
      listeners.push(function () { node.removeEventListener(type, handler); });
    }

    Object.assign(root.style, {
      position: 'relative', width: '100%', height: '100%', overflow: 'hidden',
      boxSizing: 'border-box', color: '#ecfeff', background: '#071426',
      fontFamily: 'Microsoft YaHei, PingFang SC, sans-serif'
    });
    root.replaceChildren();

    var pageRoot = element('section', {
      position: 'absolute', inset: '0', overflow: 'hidden',
      background: page === 2
        ? 'linear-gradient(135deg,#071827,#0b3241)'
        : page === 3
          ? 'linear-gradient(135deg,#11102b,#282153)'
          : 'linear-gradient(135deg,#06152b,#0b3a3b)'
    });
    pageRoot.dataset.photosynthesisPage = String(page);
    root.appendChild(pageRoot);

    var glow = element('div', {
      position: 'absolute', width: '520px', height: '520px', right: '-110px', top: '-190px',
      borderRadius: '50%', background: accent, opacity: '0.16', filter: 'blur(12px)'
    });
    pageRoot.appendChild(glow);
    var kicker = element('div', {
      position: 'absolute', left: '72px', top: '54px', color: accent,
      fontSize: '15px', fontWeight: '700', letterSpacing: '2px'
    }, 'INTERACTIVE SCIENCE  /  互动科学');
    pageRoot.appendChild(kicker);
    var title = element('h1', {
      position: 'absolute', left: '72px', top: '82px', width: '1040px', margin: '0',
      fontSize: '38px', lineHeight: '1.3', fontWeight: '800', color: '#f2fbff'
    }, titles[page - 1]);
    pageRoot.appendChild(title);
    var subtitle = element('p', {
      position: 'absolute', left: '74px', top: '145px', width: '900px', margin: '0',
      fontSize: '18px', color: '#9bc0d0'
    }, subtitles[page - 1]);
    pageRoot.appendChild(subtitle);
    var pageNumber = element('div', {
      position: 'absolute', right: '76px', top: '55px', color: accent,
      fontSize: '48px', fontWeight: '800', opacity: '0.8'
    }, '0' + page);
    pageRoot.appendChild(pageNumber);

    if (page === 1) {
      var selected = 0;
      var labels = ['阳光', '二氧化碳', '水'];
      var colors = ['#fbbf24', '#38bdf8', '#34d399'];
      var result = element('div', {
        position: 'absolute', left: '445px', top: '238px', width: '735px', height: '376px',
        boxSizing: 'border-box', borderRadius: '30px', border: '2px solid #34d39966',
        background: '#082436', boxShadow: '0 24px 70px #00000055', transition: 'all 180ms ease'
      });
      var resultTitle = element('div', {
        position: 'absolute', left: '54px', top: '46px', fontSize: '25px', fontWeight: '800'
      }, '叶绿体能量转换器');
      var resultStatus = element('div', {
        position: 'absolute', left: '54px', top: '104px', right: '54px', padding: '24px',
        borderRadius: '18px', background: '#02061788', color: '#bae6fd', fontSize: '20px'
      }, '等待三种输入……');
      var energy = element('div', {
        position: 'absolute', left: '54px', right: '54px', bottom: '56px', height: '88px',
        borderRadius: '18px', background: '#0f766e', opacity: '0.25', transition: 'all 200ms ease'
      });
      result.append(resultTitle, resultStatus, energy);
      pageRoot.appendChild(result);
      labels.forEach(function (label, index) {
        var button = element('button', {
          position: 'absolute', left: '150px', top: (365 + index * 80) + 'px',
          width: '220px', height: '64px', borderRadius: '18px',
          border: '2px solid ' + colors[index], background: '#0b2235', color: '#f8fafc',
          fontSize: '20px', fontWeight: '700', cursor: 'pointer'
        }, label);
        listen(button, 'click', function () {
          if (button.dataset.selected === 'true') return;
          button.dataset.selected = 'true';
          button.style.background = colors[index];
          button.style.color = '#071426';
          selected += 1;
          resultStatus.textContent = selected === 3
            ? '光能已转化为化学能，氧气正在释放！'
            : '已接入 ' + selected + ' / 3 种原料';
          energy.style.opacity = String(0.38 + selected * 0.2);
          energy.style.background = selected === 3 ? '#34d399' : colors[index];
          result.style.boxShadow = '0 24px 80px ' + colors[index] + '55';
        });
        pageRoot.appendChild(button);
      });
    } else if (page === 2) {
      var meter = element('div', {
        position: 'absolute', left: '690px', top: '246px', width: '420px', height: '340px',
        borderRadius: '30px', border: '2px solid #38bdf877', background: '#061525',
        boxShadow: '0 24px 70px #00000055', transition: 'all 200ms ease'
      });
      var meterLabel = element('div', {
        position: 'absolute', left: '44px', top: '48px', fontSize: '22px', color: '#bae6fd'
      }, '当前光合效率');
      var meterValue = element('div', {
        position: 'absolute', left: '44px', top: '105px', fontSize: '82px', fontWeight: '800',
        color: '#38bdf8'
      }, '42%');
      var meterHint = element('div', {
        position: 'absolute', left: '44px', bottom: '54px', right: '44px', fontSize: '17px',
        color: '#7dd3fc'
      }, '点击左侧实验按钮提高光照强度');
      meter.append(meterLabel, meterValue, meterHint);
      pageRoot.appendChild(meter);
      var experimentButton = element('button', {
        position: 'absolute', left: '330px', top: '365px', width: '280px', height: '78px',
        borderRadius: '22px', border: '2px solid #38bdf8', background: '#0c4a6e',
        color: '#ecfeff', fontSize: '21px', fontWeight: '800', cursor: 'pointer',
        boxShadow: '0 14px 40px #0284c755'
      }, '提高光照强度');
      listen(experimentButton, 'click', function () {
        experimentButton.textContent = '实验条件已改变';
        experimentButton.style.background = '#fbbf24';
        experimentButton.style.borderColor = '#fde68a';
        experimentButton.style.color = '#422006';
        meterValue.textContent = '86%';
        meterValue.style.color = '#34d399';
        meter.style.background = '#064e3b';
        meter.style.transform = 'scale(1.025)';
        meterHint.textContent = '光照增强后，效率进入理想区间';
      });
      pageRoot.appendChild(experimentButton);
    } else {
      var tray = element('div', {
        position: 'absolute', left: '500px', top: '240px', width: '650px', height: '390px',
        borderRadius: '30px', border: '2px dashed #a78bfa99', background: '#17153a',
        boxShadow: '0 24px 70px #00000055'
      });
      var trayTitle = element('div', {
        position: 'absolute', left: '42px', top: '36px', fontSize: '24px', fontWeight: '800'
      }, '光合作用反应式');
      var equation = element('div', {
        position: 'absolute', left: '42px', top: '102px', right: '42px', padding: '30px',
        borderRadius: '20px', background: '#09081f', fontSize: '25px', color: '#c4b5fd',
        textAlign: 'center', transition: 'all 180ms ease'
      }, '原料  +  能量  →  产物');
      var challengeStatus = element('div', {
        position: 'absolute', left: '42px', right: '42px', bottom: '52px', color: '#a5b4fc',
        fontSize: '18px', textAlign: 'center'
      }, '完成两次操作来验证理解');
      tray.append(trayTitle, equation, challengeStatus);
      pageRoot.appendChild(tray);
      var actions = 0;
      function completeAction(button, label) {
        if (button.dataset.done === 'true') return;
        button.dataset.done = 'true';
        button.style.background = '#34d399';
        button.style.borderColor = '#86efac';
        button.style.color = '#052e16';
        button.style.transform = 'translateX(250px)';
        actions += 1;
        equation.textContent = actions === 2
          ? '二氧化碳 + 水 + 光能 → 有机物 + 氧气'
          : label + ' 已归位，还差一步';
        if (actions === 2) {
          equation.style.background = '#14532d';
          equation.style.color = '#dcfce7';
          challengeStatus.textContent = '挑战完成：物质与能量路径均正确';
        }
      }
      var energyCard = element('button', {
        position: 'absolute', left: '150px', top: '500px', width: '180px', height: '72px',
        borderRadius: '18px', border: '2px solid #fbbf24', background: '#3b3218',
        color: '#fde68a', fontSize: '20px', fontWeight: '800', cursor: 'pointer',
        transition: 'all 220ms ease'
      }, '光能');
      var materialCard = element('button', {
        position: 'absolute', left: '180px', top: '375px', width: '220px', height: '76px',
        borderRadius: '18px', border: '2px solid #38bdf8', background: '#0c3550',
        color: '#bae6fd', fontSize: '20px', fontWeight: '800', cursor: 'pointer',
        transition: 'all 220ms ease'
      }, '二氧化碳 + 水');
      listen(energyCard, 'click', function () { completeAction(energyCard, '光能'); });
      listen(materialCard, 'click', function () { completeAction(materialCard, '原料'); });
      pageRoot.append(energyCard, materialCard);
    }

    return {
      destroy: function () {
        listeners.splice(0).forEach(function (remove) { remove(); });
        root.replaceChildren();
      }
    };
  }
});
`.trim()

function runtimeLayer(page: number, accent: string): RuntimeLayerItem {
  return {
    layerItemId: `photosynthesis_runtime_${page}`,
    label: `光合作用互动 · 第 ${page} 页`,
    kind: 'runtime',
    frame: { mode: 'absolute', x: 0, y: 0, width: 1280, height: 720 },
    order: 0,
    visible: true,
    locked: false,
    rotation: 0,
    opacity: 1,
    hitPolicy: 'surface',
    playbackInitialVisibility: 'inherit',
    runtime: {
      protocol: 'surface-runtime',
      runtimeApiVersion: 3,
      enabled: true,
      renderMode: 'dom',
      source: runtimeSource,
      content: {
        values: { page: String(page), accent },
        metadata: {
          page: { label: '页码', maxLength: 1 },
          accent: { label: '强调色', maxLength: 7 },
        },
      },
      assets: {},
    },
  }
}

function buildProject(): CourseProjectDocument {
  const project = createBlankCourseProject({
    id: 'project_photosynthesis_v9_oracle',
    title: '光合作用互动课例',
    now: timestamp,
    includeDefaultController: false,
    controls: 'none',
  })
  const surface = project.surfaces[0]
  if (!surface || surface.type !== 'slide') {
    throw new Error('空白 Course Project 必须包含 Slide 表面')
  }
  const definitions = [
    { id: 'scene_energy_path', name: '01 · 发现能量路径', background: '#06152b', accent: '#34d399' },
    { id: 'scene_live_experiment', name: '02 · 光合实验室', background: '#061b29', accent: '#38bdf8' },
    { id: 'scene_classification', name: '03 · 光合挑战', background: '#11102b', accent: '#a78bfa' },
  ] as const
  const scenes: SlideSceneDocument[] = definitions.map((definition, index) => ({
    id: definition.id,
    name: definition.name,
    backgroundColor: definition.background,
    backgroundAssetId: null,
    layerItems: [runtimeLayer(index + 1, definition.accent)],
    presentation: {
      initialStateId: 'state_initial',
      thumbnailStateId: 'state_initial',
      states: [{ id: 'state_initial', name: '初始', layerItemOverrides: {} }],
    },
    interactions: [],
  }))
  surface.title = project.title
  surface.scenes = scenes
  project.locations = scenes.map((scene) => ({
    id: scene.id,
    label: `${surface.title} · ${scene.name}`,
    kind: 'slide-scene' as const,
    surfaceId: surface.id,
    sceneId: scene.id,
  }))
  project.startLocationId = scenes[0]!.id
  project.updatedAt = timestamp
  return courseProjectDocumentSchema.parse(project)
}

export interface InteractiveLessonOutputs {
  tracked: GeneratedExampleOutputs
  html: string
}

export async function buildInteractiveLessonOutputs(): Promise<InteractiveLessonOutputs> {
  const project = buildProject()
  const lessonArchive = createCourseProjectArchive(
    { project, assetFiles: {}, componentFiles: {} },
    { mtime: archiveZipMtime },
  )
  const reopened = openCourseProjectArchive(lessonArchive)
  const reopenedSlide = reopened.project.surfaces[0]
  if (
    reopened.project.schemaVersion !== 9
    || !reopenedSlide
    || reopenedSlide.type !== 'slide'
    || reopenedSlide.scenes.length !== 3
    || reopenedSlide.scenes.some((scene) => (
      scene.layerItems.length !== 1
      || scene.layerItems[0]?.kind !== 'runtime'
      || scene.layerItems[0].runtime.protocol !== 'surface-runtime'
      || scene.layerItems[0].runtime.runtimeApiVersion !== 3
    ))
  ) {
    throw new Error('光合作用 V9 课例保存重开后结构不完整')
  }

  const sources = {
    project: reopened.project,
    assetFiles: reopened.assetFiles,
    components: {},
  }
  const payload = buildPublishedCourseV2Payload(sources)
  if (
    payload.format !== PUBLISHED_COURSE_FORMAT
    || payload.formatVersion !== PUBLISHED_COURSE_VERSION
    || payload.sourceSchemaVersion !== 9
    || payload.locations.length !== 3
  ) {
    throw new Error('光合作用课例没有生成 Published Course V2 payload')
  }
  const playerBundle = await fs.readFile(path.join(root, 'dist-player', 'player.iife.js'), 'utf8')
  const html = buildPublishedCourseStandaloneHtml(sources, { playerBundle, lang: 'zh-CN' })
  if (!html.includes('window.__H5_COURSE_PAYLOAD__=')) {
    throw new Error('离线 HTML 缺少 Published Course V2 payload')
  }
  if (/window\.__H5_LESSON_PAYLOAD__\s*=/.test(html)) {
    throw new Error('离线 HTML 意外内嵌 V8 ExportPayload')
  }
  if (/https?:\/\//i.test(html)) throw new Error('离线 HTML 中出现远程 URL')

  return {
    tracked: {
      [INTERACTIVE_LESSON_TRACKED_OUTPUT_PATHS.lesson]: lessonArchive,
    },
    html,
  }
}

export async function checkInteractiveLessonOutputs(): Promise<void> {
  const outputs = await buildInteractiveLessonOutputs()
  await checkTrackedExampleOutputs(examplesDirectory, outputs.tracked, '光合作用课例')
}

async function writeInteractiveLessonHtml(html: string): Promise<void> {
  await fs.mkdir(artifactDirectory, { recursive: true })
  await fs.writeFile(htmlPath, html, 'utf8')
}

async function refreshInteractiveLessonOutputs(): Promise<void> {
  const outputs = await buildInteractiveLessonOutputs()
  await Promise.all([
    ...Object.entries(outputs.tracked).map(([relativePath, bytes]) =>
      fs.writeFile(path.join(examplesDirectory, relativePath), bytes)),
    writeInteractiveLessonHtml(outputs.html),
  ])
  console.log('已刷新光合作用 Course Project V9 工程和 Published V2 离线预览')
}

async function prepareInteractiveLessonHtml(): Promise<void> {
  const outputs = await buildInteractiveLessonOutputs()
  await writeInteractiveLessonHtml(outputs.html)
  console.log(`已准备 E2E 所需离线预览：${htmlPath}`)
}

export type InteractiveLessonGenerationMode = 'refresh' | 'check' | 'prepare'

export function parseInteractiveLessonGenerationMode(
  argv: readonly string[],
): InteractiveLessonGenerationMode {
  if (argv.length === 0 || (argv.length === 1 && argv[0] === '--refresh')) return 'refresh'
  if (argv.length === 1 && argv[0] === '--check') return 'check'
  if (argv.length === 1 && argv[0] === '--prepare') return 'prepare'
  throw new Error(
    'Usage: tsx scripts/build-interactive-lesson.ts [--refresh|--check|--prepare]',
  )
}

async function main(argv: readonly string[]): Promise<void> {
  switch (parseInteractiveLessonGenerationMode(argv)) {
    case 'check':
      await checkInteractiveLessonOutputs()
      return
    case 'prepare':
      await prepareInteractiveLessonHtml()
      return
    case 'refresh':
      await refreshInteractiveLessonOutputs()
  }
}

const invokedPath = process.argv[1]
if (invokedPath && import.meta.url === pathToFileURL(path.resolve(invokedPath)).href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error('生成互动教学课例失败', error)
    process.exitCode = 1
  })
}
