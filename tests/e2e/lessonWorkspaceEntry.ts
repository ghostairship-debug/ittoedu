import { expect, type Page } from '@playwright/test'

/**
 * 冷启动进入独立课件编辑器的唯一共享入口（R2）。
 *
 * 产品事实（V3.1 / bc2072f7 之后，2026-09-19 逐条复核，全部 src 级证据）：
 * - 冷启动落在着陆页 .lesson-workspace-landing（LessonWorkspaceView.tsx:1316，条件 !state.workspace && !state.standalone），
 *   其中「打开工作空间」按钮在 :1326-1335（renderer 全仓唯一一处同名 role=button）；内容区默认收起，
 *   顶栏与「＋新建标签页」都在隐藏列内。
 * - 旧「更多（.lesson-workspace-more）→ 新建独立课件」入口已从产品移除：src/ 对「新建独立课件」零命中。
 *   .lesson-workspace-more 现在是共享样式类，LessonWorkspaceView.tsx 渲染 3 处：
 *   :945 .lesson-new-tab（＋新建标签页）、:1170 .lesson-workspace-switcher（切换工作空间）、
 *   :1258 .lesson-layout-menu（布局）。任何 '.lesson-workspace-more > summary' locator 都是多匹配
 *   （先例：docs/development-plan/reviews/2026-09-18-r19-closeout-retry-v05-060.md:78 记录过 strict mode violation）。
 * - 现在唯一能建立空白独立课件并展开工作台的入口是 App 级「新建课件（Ctrl+N）」：
 *   useEditorKeyboardRouter.ts:60-62 在 window keydown 上路由到 current.newProject()（监听注册在 :108），
 *   App.tsx:552 接到 courseProjectLifecycle.newProject()；键盘路由只在 isReadOnly() 为假时生效
 *   （App.tsx:505 = 预览打开或 canvasMode==='run'；冷启动为假）。
 * - 产品态判据：TopToolbar.tsx:78 aria-label={title} ⇒ 「打开工程（Ctrl+O）」（:182）只有编辑器面存在；
 *   <main aria-label="课件画布">（SlideLocationWorkspace.tsx:2374）与 [data-testid="canvas-stage"]（:2830）
 *   才是编辑器面真的展开——着陆页是否卸载不是证据（standalone 一置真必卸载，近乎恒真）。
 *
 * 本文件只服务「独立编辑器」路线。课例工作空间路线（打开工作空间 → 会话）见 tests/e2e/r19ChatSpecSupport.ts，
 * 两者今天互不覆盖，不要互相替代。
 */

export type StartupSurface = 'editor' | 'landing' | 'recovery' | 'workspace'

/** 冷启动面探测超时集中在这里。禁止各 spec 复制 timeout 参数（Windows 负载抖动，见 R19_SIGNOFF_PUSH_BRIEF §9 坑 5）。 */
const STARTUP_SURFACE_TIMEOUT_MS = 30_000

async function readStartupSurface(page: Page): Promise<StartupSurface | 'unknown'> {
  const editor = page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true })
  const landing = page.getByRole('button', { name: '打开工作空间', exact: true }).first()
  const recovery = page.getByRole('alertdialog', { name: '发现未完成的本地恢复副本', exact: true })
  const restoredWorkspace = page.locator('.lesson-workspace-toolbar')
  if (await recovery.isVisible()) return 'recovery'
  if (await editor.isVisible()) return 'editor'
  if (await landing.isVisible()) return 'landing'
  if (!await restoredWorkspace.isVisible()) return 'unknown'
  // `.lesson-workspace-toolbar` 是无条件渲染的 shell 表头（LessonWorkspaceView.tsx:1165，在着陆页分支 :1312
  // 之外、隐藏列 :1360 之外），着陆页上它同样是可见的一行（实测 1427×52 flex）。它只证明 shell 挂载了，
  // 不证明「已恢复工作空间」。而上面四次 isVisible 不是一次原子快照：冷启动时 React 恰好挂载在这四次之间，
  // 就会读出「landing=false + toolbar=true」——这个组合在产品里从不出现。2026-09-19 实测（探针 probe-real-helper，
  // 8 次冷启动 3 次命中，命中时 DOM 与未命中完全一致：landing 548×261 可见、columns[hidden]、
  // data-layout=standalone、main 零尺寸；挂载落在 landing 检查之后、toolbar 检查之前），
  // 于是 enterIndependentEditor 判成 'workspace'、根本不按 Ctrl+N，30s 后在 :74 大声失败。
  // 所以 toolbar 可见时重读一次着陆页：toolbar 可见即 shell 已挂载，这次重读与它同属一个已挂载的快照，
  // 不会再跨挂载边界；真的恢复了工作空间（r19LessonCopyMove.spec.ts:86-87 一类）时 landing 依旧缺席，'workspace' 照旧返回。
  if (await landing.isVisible()) return 'landing'
  return 'workspace'
}

/**
 * 只读冷启动面探测：返回当前面，不点、不按键、不改变启动面。
 * 三态判据与 tests/e2e/stabilizationCoreUsability.spec.ts:159-173 一致（同一组 locator 与产品态断言）；
 * 额外识别第四态 'workspace'：带最近工作空间记录的 profile 重开时产品会直接回到该工作空间且内容区默认收起
 * （先例：r19LessonCopyMove.spec.ts:86-87 与 .lesson-workspace-toolbar 断言），此时上面三态都不出现。
 * 注意 .lesson-workspace-toolbar 在着陆页上也可见（它不在隐藏列内），单独一条 toolbar 断言分不出这两态，
 * readStartupSurface 里因此有一步着陆页重读；判据见那里的注释与 2026-09-19 的探针实证。
 * 本 helper 不把它当着陆页，也不会去按 Ctrl+N（那会顶替夹具已有的工作空间），而是交由下面的产品态断言大声失败。
 */
export async function observeStartupSurface(page: Page): Promise<StartupSurface> {
  const deadline = Date.now() + STARTUP_SURFACE_TIMEOUT_MS
  for (;;) {
    const surface = await readStartupSurface(page)
    if (surface !== 'unknown') return surface
    if (Date.now() >= deadline) break
    await page.waitForTimeout(250)
  }
  throw new Error(
    '冷启动面在 ' + STARTUP_SURFACE_TIMEOUT_MS + 'ms 内没有出现；四种已知面都没有渲染：'
    + '「打开工程（Ctrl+O）」/「打开工作空间」/「发现未完成的本地恢复副本」/ .lesson-workspace-toolbar。'
    + '若本用例故意用带最近工作空间的 profile 重开，请在该用例里显式声明它期望的启动面；不要放宽本探测。',
  )
}

/**
 * 从冷启动面进入独立编辑器（landing → Control+N）。
 * 已在编辑器面时不顶替；恢复稿面与已恢复工作空间面不按 Ctrl+N，改由下面无条件的产品态断言大声失败。
 * Ctrl+N 只按一次：第二次会替换刚建好的空白工程，破坏依赖 revision 的断言——禁止加『再按一次』重试。
 */
export async function enterIndependentEditor(page: Page): Promise<void> {
  const surface = await observeStartupSurface(page)
  if (surface === 'landing') await page.keyboard.press('Control+N')
  await expect(page.getByRole('main', { name: '课件画布' })).toBeVisible({ timeout: 30_000 })
  await page.locator('[data-testid="canvas-stage"] canvas').first().waitFor()
}
