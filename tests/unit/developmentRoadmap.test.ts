import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  checkDevelopmentRoadmap,
  DevelopmentRoadmapValidationError,
  OLD_PLAN_TASK_IDS,
  ROADMAP_WRITE_LOCKS,
} from '../../scripts/check-development-roadmap'

interface FixtureTask {
  id: string
  release: string
  title: string
  dependencies: string[]
  optional: boolean
  writeLocks: string[]
  spec: string
  [key: string]: unknown
}

interface FixtureManifest {
  schemaVersion: number
  tasks: FixtureTask[]
}

const tempRoots: string[] = []

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'development-roadmap-'))
  tempRoots.push(root)
  return root
}

function validManifest(): FixtureManifest {
  return {
    schemaVersion: 1,
    tasks: [
      {
        id: 'r11-000-fixture-foundation',
        release: '1.1',
        title: '建立 fixture 基线',
        dependencies: [],
        optional: false,
        writeLocks: ['contracts-schema'],
        spec: '1.1/r11-000-fixture-foundation.md',
      },
      {
        id: 'r12-000-fixture-left',
        release: '1.2',
        title: '`fixture-v1` 并行左支',
        dependencies: ['r11-000-fixture-foundation'],
        optional: false,
        writeLocks: ['props-shared'],
        spec: '1.2/r12-000-fixture-left.md',
      },
      {
        id: 'r12-010-fixture-right',
        release: '1.2',
        title: '并行右支',
        dependencies: ['r11-000-fixture-foundation'],
        optional: false,
        writeLocks: ['generated-index'],
        spec: '1.2/r12-010-fixture-right.md',
      },
      {
        id: 'r15-900-fixture-optional',
        release: '1.5',
        title: '独立可选支线',
        dependencies: ['r11-000-fixture-foundation'],
        optional: true,
        writeLocks: ['main-preload'],
        spec: '1.5/README.md',
      },
    ],
  }
}

function renderCrosswalk(ids: readonly string[] = OLD_PLAN_TASK_IDS): string {
  return [
    '# 旧路线映射',
    '',
    '| 旧任务 ID | 归类 | 新路线节点 | 理由 |',
    '|---|---|---|---|',
    ...ids.map((id) => `| \`${id}\` | retired | — | 临时 fixture 以明确理由关闭该旧任务。 |`),
    '',
  ].join('\n')
}

function renderOneOneReadme(tasks: readonly FixtureTask[]): string {
  const rows = tasks
    .filter((task) => task.release === '1.1')
    .map((task) => [
      task.id,
      task.title,
      task.dependencies.length > 0 ? task.dependencies.join(', ') : '—',
      task.writeLocks.join(', '),
      `[spec](${path.posix.basename(task.spec)})`,
    ].join(' | '))
  return [
    '# 1.1',
    '',
    '| Task | 结果 | Dependencies | Write locks | Spec |',
    '|---|---|---|---|---|',
    ...rows.map((row) => `| ${row} |`),
    '',
  ].join('\n')
}

function renderLaterReadme(release: string, tasks: readonly FixtureTask[]): string {
  const independentSpec = release === '1.2'
  const rows = tasks
    .filter((task) => task.release === release)
    .map((task) => [
      `\`${task.id}\``,
      task.title,
      task.dependencies.length > 0 ? task.dependencies.map((dependency) => `\`${dependency}\``).join(', ') : '—',
      task.optional ? '是' : '否',
      task.writeLocks.map((lock) => `\`${lock}\``).join(', '),
      ...(independentSpec ? [`[spec](${path.posix.basename(task.spec)})`] : []),
      'fixture 验收',
    ].join(' | '))
  return [
    `# ${release}`,
    '',
    independentSpec
      ? '| Task ID | 结果 | Dependencies | Optional | Write locks | Spec | Acceptance |'
      : '| Task ID | 结果 | Dependencies | Optional | Write locks | Acceptance |',
    independentSpec
      ? '| --- | --- | --- | --- | --- | --- | --- |'
      : '| --- | --- | --- | --- | --- | --- |',
    ...rows.map((row) => `| ${row} |`),
    '',
    ...(release === '1.2' ? ['证据：`npm run test -- tests/unit/existing.test.ts`。', ''] : []),
  ].join('\n')
}

function renderOneOneSpec(
  task: FixtureTask,
  inventoryAccess: 'none' | 'read' | 'write' = 'none',
  extra = '',
): string {
  if (task.release === '1.2') {
    return [
      `# ${task.id}｜${task.title}`,
      '',
      `- Release / Dependencies: ${task.release} / ${task.dependencies.length > 0 ? task.dependencies.join(', ') : 'none'}`,
      `- Write locks: ${task.writeLocks.map((lock) => `\`${lock}\``).join(', ')}`,
      `- Inventory access: \`${inventoryAccess}\``,
      '',
      '[共享合同](IMPLEMENTATION_CONTRACT.md)。',
      '',
      '## Outcome / current evidence',
      '',
      'fixture 结果。',
      '',
      '## Read first',
      '',
      '- `tests/unit/existing.test.ts`',
      '',
      '## Write scope',
      '',
      '只写 fixture。',
      '',
      '## Execution',
      '',
      '1. 完成 fixture。',
      '',
      '## Stop conditions',
      '',
      '- 合同冲突时停止。',
      '',
      '## Acceptance',
      '',
      '- fixture 通过。',
      '',
      '## Focused validation',
      '',
      '- `npm run test -- tests/unit/existing.test.ts`',
      '',
      '## Rollback / handoff',
      '',
      '回滚 fixture。',
      ...(extra ? ['', extra] : []),
      '',
    ].join('\n')
  }
  return [
    `# ${task.id}｜${task.title}`,
    '',
    `- Release / Dependencies: ${task.release} / ${task.dependencies.length > 0 ? task.dependencies.join(', ') : 'none'}`,
    `- Write locks: ${task.writeLocks.map((lock) => `\`${lock}\``).join(', ')}`,
    `- Inventory access: \`${inventoryAccess}\``,
    '- Preservation: PM-01',
    '',
    '检查：`npm run test -- tests/unit/existing.test.ts`。',
    ...(extra ? ['', extra] : []),
    '',
  ].join('\n')
}

async function writeManifest(root: string, manifest: FixtureManifest): Promise<void> {
  await writeFile(
    path.join(root, 'docs', 'development-plan', 'roadmap', 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  )
}

async function writeReleaseReadmes(root: string, manifest: FixtureManifest): Promise<void> {
  const roadmapRoot = path.join(root, 'docs', 'development-plan', 'roadmap')
  await writeFile(path.join(roadmapRoot, '1.1', 'README.md'), renderOneOneReadme(manifest.tasks), 'utf8')
  for (const release of ['1.2', '1.3', '1.4', '1.5', '1.6', '1.7', '1.8', '1.9', '2.0']) {
    await writeFile(path.join(roadmapRoot, release, 'README.md'), renderLaterReadme(release, manifest.tasks), 'utf8')
  }
}

async function writeOneOneSpec(
  root: string,
  task: FixtureTask,
  inventoryAccess: 'none' | 'read' | 'write' = 'none',
  extra = '',
): Promise<string> {
  const specPath = path.join(root, 'docs', 'development-plan', 'roadmap', ...task.spec.split('/'))
  await writeFile(specPath, renderOneOneSpec(task, inventoryAccess, extra), 'utf8')
  return specPath
}

async function writeFixture(): Promise<{ root: string; manifest: FixtureManifest; oneOneSpecPath: string }> {
  const root = await createTempRoot()
  const roadmapRoot = path.join(root, 'docs', 'development-plan', 'roadmap')
  for (const release of ['1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '1.7', '1.8', '1.9', '2.0']) {
    await mkdir(path.join(roadmapRoot, release), { recursive: true })
  }
  await mkdir(path.join(root, 'tests', 'unit'), { recursive: true })
  await writeFile(
    path.join(root, 'package.json'),
    `${JSON.stringify({ scripts: { test: 'vitest run', 'check:development-roadmap': 'tsx scripts/check-development-roadmap.ts' } }, null, 2)}\n`,
    'utf8',
  )
  await writeFile(path.join(root, 'tests', 'unit', 'existing.test.ts'), 'export {}\n', 'utf8')
  await writeFile(
    path.join(roadmapRoot, 'README.md'),
    '# 路线\n\n[不降级矩阵](PRESERVATION_MATRIX.md) · [旧路线映射](OLD_PLAN_CROSSWALK.md)\n',
    'utf8',
  )
  await writeFile(
    path.join(roadmapRoot, 'PRESERVATION_MATRIX.md'),
    '# 不降级矩阵\n\n| ID | 行为 | 证据 | 禁止降级 |\n|---|---|---|---|\n| PM-01 | fixture 行为 | 精确测试 | 不删除入口 |\n',
    'utf8',
  )
  await writeFile(path.join(roadmapRoot, 'OLD_PLAN_CROSSWALK.md'), renderCrosswalk(), 'utf8')
  await writeFile(
    path.join(roadmapRoot, '1.2', 'IMPLEMENTATION_CONTRACT.md'),
    '# 1.2 fixture contract\n',
    'utf8',
  )
  await writeFile(
    path.join(roadmapRoot, '1.2', 'EXECUTION_GUIDE.md'),
    '# 1.2 fixture execution guide\n\n[contract](IMPLEMENTATION_CONTRACT.md)\n',
    'utf8',
  )
  const manifest = validManifest()
  await writeManifest(root, manifest)
  await writeReleaseReadmes(root, manifest)
  const oneOneSpecPath = await writeOneOneSpec(root, manifest.tasks[0])
  for (const task of manifest.tasks.filter((entry) => entry.release === '1.2')) {
    await writeOneOneSpec(root, task)
  }
  return { root, manifest, oneOneSpecPath }
}

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root) await rm(root, { recursive: true, force: true })
  }
})

describe('development roadmap validation', () => {
  it('accepts strict independent 1.1/1.2 specs and shared later-version specs', async () => {
    const { root } = await writeFixture()
    const report = await checkDevelopmentRoadmap(root)
    expect(report.taskCount).toBe(4)
    expect(report.specCount).toBe(4)
    expect(report.crosswalkCount).toBe(98)
    expect(report.parallelFrontier).toEqual(['r12-000-fixture-left', 'r12-010-fixture-right'])
  })

  it('rejects execution state stored in the manifest', async () => {
    const { root, manifest } = await writeFixture()
    manifest.tasks[0].status = 'ready'
    await writeManifest(root, manifest)
    await expect(checkDevelopmentRoadmap(root)).rejects.toThrow(/路线不得保存执行状态/)
  })

  it('rejects write locks outside the current task-card protocol', async () => {
    const { root, manifest } = await writeFixture()
    manifest.tasks[0].writeLocks = ['invented-roadmap-lock']
    await writeManifest(root, manifest)
    await expect(checkDevelopmentRoadmap(root)).rejects.toThrow(/任务卡协议未定义的写锁/)
    expect(ROADMAP_WRITE_LOCKS).toEqual([
      'none',
      'contracts-schema',
      'generated-index',
      'legacy-inventory',
      'store-kernel',
      'store-slide',
      'store-flow',
      'store-spatial',
      'store-course',
      'props-shared',
      'props-slide',
      'props-flow',
      'props-spatial',
      'props-global',
      'workspace-shell',
      'authoring-slide',
      'authoring-flow',
      'authoring-spatial',
      'authoring-interaction',
      'authoring-recipe',
      'published-slide',
      'published-flow',
      'published-spatial',
      'published-interaction',
      'published-dynamic',
      'published-producer',
      'export-pptx',
      'export-docx-print',
      'app-save-recovery',
      'diagnostics',
      'main-preload',
      'cli-adapters',
      'ai-session',
      'mcp-server',
      'chat-ui',
    ])
  })

  it('rejects cycles but allows a correctly ordered serial graph', async () => {
    const cycleFixture = await writeFixture()
    cycleFixture.manifest.tasks[0].dependencies = ['r12-000-fixture-left']
    await writeManifest(cycleFixture.root, cycleFixture.manifest)
    await expect(checkDevelopmentRoadmap(cycleFixture.root)).rejects.toThrow(/任务图存在环/)

    const serialFixture = await writeFixture()
    serialFixture.manifest.tasks[2].dependencies = ['r12-000-fixture-left']
    await writeManifest(serialFixture.root, serialFixture.manifest)
    await writeReleaseReadmes(serialFixture.root, serialFixture.manifest)
    await writeOneOneSpec(serialFixture.root, serialFixture.manifest.tasks[2])
    await expect(checkDevelopmentRoadmap(serialFixture.root)).resolves.toMatchObject({ parallelFrontier: [] })
  })

  it('reports the complete maximum lock-disjoint set in the first parallel frontier', async () => {
    const fixture = await writeFixture()
    const third: FixtureTask = {
      id: 'r12-020-fixture-third',
      release: '1.2',
      title: '并行第三支',
      dependencies: ['r11-000-fixture-foundation'],
      optional: false,
      writeLocks: ['main-preload'],
      spec: '1.2/r12-020-fixture-third.md',
    }
    const laterRelease: FixtureTask = {
      id: 'r13-900-fixture-later',
      release: '1.3',
      title: '后续版本并行支线',
      dependencies: ['r11-000-fixture-foundation'],
      optional: false,
      writeLocks: ['props-flow'],
      spec: '1.3/README.md',
    }
    fixture.manifest.tasks.push(third, laterRelease)
    await writeManifest(fixture.root, fixture.manifest)
    await writeReleaseReadmes(fixture.root, fixture.manifest)
    await writeOneOneSpec(fixture.root, third)
    await expect(checkDevelopmentRoadmap(fixture.root)).resolves.toMatchObject({
      parallelFrontier: [
        'r12-000-fixture-left',
        'r12-010-fixture-right',
        'r12-020-fixture-third',
      ],
    })
  })

  it('rejects an optional task in a core dependency closure', async () => {
    const { root, manifest } = await writeFixture()
    manifest.tasks[1].dependencies = ['r15-900-fixture-optional']
    await writeManifest(root, manifest)
    await expect(checkDevelopmentRoadmap(root)).rejects.toThrow(/依赖闭包包含可选任务/)
  })

  it.each([
    ['missing package script in a fenced block', '```text\nnpm run missing-script -- tests/unit/existing.test.ts\n```', /不存在的 package script/],
    ['missing test path in a fenced block', '```text\nnpm run test -- tests/unit/missing.test.ts\n```', /不存在的测试文件/],
    ['test glob in a fenced block', '```text\nnpm run test -- tests/unit/*.test.ts\n```', /验证命令含通配符/],
    ['minimum-equivalent fallback', '命令无法运行时选择最小等价集合。', /仍允许“最小等价”验证/],
    ['installer verifier', '执行 npm run verify:installer 后继续。', /verify:installer/],
  ])('rejects %s in executable specs', async (_label, content, expected) => {
    const { root, oneOneSpecPath } = await writeFixture()
    await writeFile(oneOneSpecPath, `# fixture\n\n${content}\n`, 'utf8')
    await expect(checkDevelopmentRoadmap(root)).rejects.toThrow(expected as RegExp)
  })

  it('allows historical deletion targets but still rejects missing Read first entries', async () => {
    const historicalFixture = await writeFixture()
    const historical = await readFile(historicalFixture.oneOneSpecPath, 'utf8')
    await writeFile(
      historicalFixture.oneOneSpecPath,
      `${historical}\n## Integrator audit\n\n已删除的历史目标：\`tests/unit/missing.test.ts\`。\n\n## Exact targets\n\n- \`tests/unit/also-missing.test.ts\`（删除）\n`,
      'utf8',
    )
    await expect(checkDevelopmentRoadmap(historicalFixture.root)).resolves.toBeDefined()

    const readFirstFixture = await writeFixture()
    const readFirst = await readFile(readFirstFixture.oneOneSpecPath, 'utf8')
    await writeFile(
      readFirstFixture.oneOneSpecPath,
      `${readFirst}\n## Read first\n\n- \`tests/unit/missing.test.ts\`\n`,
      'utf8',
    )
    await expect(checkDevelopmentRoadmap(readFirstFixture.root)).rejects.toThrow(/不存在的测试文件/)
  })

  it('requires an independent 1.1 spec and valid local document links', async () => {
    const duplicateSpecFixture = await writeFixture()
    duplicateSpecFixture.manifest.tasks.push({
      id: 'r11-010-fixture-second',
      release: '1.1',
      title: '第二个 1.1 节点',
      dependencies: [],
      optional: false,
      writeLocks: ['main-preload'],
      spec: '1.1/r11-000-fixture-foundation.md',
    })
    await writeManifest(duplicateSpecFixture.root, duplicateSpecFixture.manifest)
    await expect(checkDevelopmentRoadmap(duplicateSpecFixture.root)).rejects.toThrow(/各有独立规格/)

    const brokenLinkFixture = await writeFixture()
    const readmePath = path.join(brokenLinkFixture.root, 'docs', 'development-plan', 'roadmap', 'README.md')
    const current = await readFile(readmePath, 'utf8')
    await writeFile(readmePath, `${current}\n[失效链接](missing.md)\n`, 'utf8')
    await expect(checkDevelopmentRoadmap(brokenLinkFixture.root)).rejects.toThrow(/失效本地链接/)
  })

  it('requires every 1.1 spec to identify itself and cite an existing preservation row', async () => {
    const { root, oneOneSpecPath } = await writeFixture()
    await writeFile(
      oneOneSpecPath,
      '# wrong-task-id\n\n关联 PM-99。检查：`npm run test -- tests/unit/existing.test.ts`。\n',
      'utf8',
    )
    await expect(checkDevelopmentRoadmap(root)).rejects.toThrow(/一级标题必须以完整 task ID 开头/)
    await expect(checkDevelopmentRoadmap(root)).rejects.toThrow(/引用不存在的不可降级矩阵 ID/)
  })

  it('rejects README task rows that are extra or missing relative to the manifest', async () => {
    const extraFixture = await writeFixture()
    const extraReadme = path.join(extraFixture.root, 'docs', 'development-plan', 'roadmap', '1.2', 'README.md')
    const extraText = await readFile(extraReadme, 'utf8')
    await writeFile(
      extraReadme,
      `${extraText}| \`r12-999-extra-row\` | 额外行 | \`r11-000-fixture-foundation\` | 否 | \`main-preload\` | [spec](r12-999-extra-row.md) | 不应存在 |\n`,
      'utf8',
    )
    await expect(checkDevelopmentRoadmap(extraFixture.root)).rejects.toThrow(/manifest 任务 ID 不一致.*额外/)

    const missingFixture = await writeFixture()
    const missingReadme = path.join(missingFixture.root, 'docs', 'development-plan', 'roadmap', '1.2', 'README.md')
    const missingText = await readFile(missingReadme, 'utf8')
    await writeFile(
      missingReadme,
      missingText.split(/\r?\n/).filter((line) => !line.includes('r12-010-fixture-right')).join('\n'),
      'utf8',
    )
    await expect(checkDevelopmentRoadmap(missingFixture.root)).rejects.toThrow(/manifest 任务 ID 不一致.*缺失/)
  })

  it('compares later-version README title, dependencies, optional and locks with the manifest', async () => {
    const { root } = await writeFixture()
    const readmePath = path.join(root, 'docs', 'development-plan', 'roadmap', '1.2', 'README.md')
    const current = await readFile(readmePath, 'utf8')
    const changed = current.replace(
      '| `r12-000-fixture-left` | `fixture-v1` 并行左支 | `r11-000-fixture-foundation` | 否 | `props-shared` | [spec](r12-000-fixture-left.md) | fixture 验收 |',
      '| `r12-000-fixture-left` | 错误标题 | `r12-010-fixture-right` | 是 | `main-preload` | [spec](r12-000-fixture-left.md) | fixture 验收 |',
    )
    await writeFile(readmePath, changed, 'utf8')
    await expect(checkDevelopmentRoadmap(root)).rejects.toThrow(/title 与 manifest 不一致/)
    await expect(checkDevelopmentRoadmap(root)).rejects.toThrow(/dependencies 与 manifest 不一致/)
    await expect(checkDevelopmentRoadmap(root)).rejects.toThrow(/optional 与 manifest 不一致/)
    await expect(checkDevelopmentRoadmap(root)).rejects.toThrow(/writeLocks 与 manifest 不一致/)
  })

  it('compares the 1.1 README spec link and all executable spec metadata with the manifest', async () => {
    const linkFixture = await writeFixture()
    const oneOneReadme = path.join(linkFixture.root, 'docs', 'development-plan', 'roadmap', '1.1', 'README.md')
    const readme = await readFile(oneOneReadme, 'utf8')
    await writeFile(oneOneReadme, readme.replace('r11-000-fixture-foundation.md', 'wrong-spec.md'), 'utf8')
    await expect(checkDevelopmentRoadmap(linkFixture.root)).rejects.toThrow(/spec 链接与 manifest 不一致/)

    const metadataFixture = await writeFixture()
    await writeFile(
      metadataFixture.oneOneSpecPath,
      [
        '# r11-000-fixture-foundation｜错误标题',
        '',
        '- Release / Dependencies: 1.2 / r12-000-fixture-left',
        '- Write locks: `main-preload`',
        '- Inventory access: `write`',
        '- Preservation: PM-01',
        '',
        '允许更新 inventory。',
        '',
      ].join('\n'),
      'utf8',
    )
    await expect(checkDevelopmentRoadmap(metadataFixture.root)).rejects.toThrow(/规格标题与 manifest title 不一致/)
    await expect(checkDevelopmentRoadmap(metadataFixture.root)).rejects.toThrow(/spec release/)
    await expect(checkDevelopmentRoadmap(metadataFixture.root)).rejects.toThrow(/spec dependencies 与 manifest 不一致/)
    await expect(checkDevelopmentRoadmap(metadataFixture.root)).rejects.toThrow(/spec writeLocks 与 manifest 不一致/)
    await expect(checkDevelopmentRoadmap(metadataFixture.root)).rejects.toThrow(/Inventory access: write.*legacy-inventory/)
  })

  it('requires every 1.2 node to have a linked, decision-complete independent spec', async () => {
    const linkFixture = await writeFixture()
    const readmePath = path.join(linkFixture.root, 'docs', 'development-plan', 'roadmap', '1.2', 'README.md')
    const readme = await readFile(readmePath, 'utf8')
    await writeFile(readmePath, readme.replace('r12-000-fixture-left.md', 'wrong-spec.md'), 'utf8')
    await expect(checkDevelopmentRoadmap(linkFixture.root)).rejects.toThrow(/spec 链接与 manifest 不一致/)

    const shapeFixture = await writeFixture()
    const specPath = path.join(
      shapeFixture.root,
      'docs',
      'development-plan',
      'roadmap',
      '1.2',
      'r12-000-fixture-left.md',
    )
    const spec = await readFile(specPath, 'utf8')
    await writeFile(specPath, spec.replace('## Stop conditions', '## Missing stop section'), 'utf8')
    await expect(checkDevelopmentRoadmap(shapeFixture.root)).rejects.toThrow(/缺少标准章节.*Stop conditions/)
  })

  it('compares 1.1 README fields and rejects abbreviated dependency IDs', async () => {
    const fieldFixture = await writeFixture()
    const readmePath = path.join(fieldFixture.root, 'docs', 'development-plan', 'roadmap', '1.1', 'README.md')
    const current = await readFile(readmePath, 'utf8')
    await writeFile(
      readmePath,
      current.replace(
        '| r11-000-fixture-foundation | 建立 fixture 基线 | — | contracts-schema |',
        '| r11-000-fixture-foundation | 错误标题 | r12-000 | main-preload |',
      ),
      'utf8',
    )
    await expect(checkDevelopmentRoadmap(fieldFixture.root)).rejects.toThrow(/dependencies 必须使用完整 task ID/)
    await expect(checkDevelopmentRoadmap(fieldFixture.root)).rejects.toThrow(/title 与 manifest 不一致/)
    await expect(checkDevelopmentRoadmap(fieldFixture.root)).rejects.toThrow(/writeLocks 与 manifest 不一致/)
  })

  it('requires every 1.1 spec to declare the inventory access protocol field', async () => {
    const { root, manifest, oneOneSpecPath } = await writeFixture()
    const withoutAccess = renderOneOneSpec(manifest.tasks[0]).replace('- Inventory access: `none`\n', '')
    await writeFile(oneOneSpecPath, withoutAccess, 'utf8')
    await expect(checkDevelopmentRoadmap(root)).rejects.toThrow(/Inventory access 必须严格是 none、read 或 write/)
  })

  it('rejects orphan 1.1 specs and unknown task references inside a registered spec', async () => {
    const orphanFixture = await writeFixture()
    const orphanPath = path.join(
      orphanFixture.root,
      'docs',
      'development-plan',
      'roadmap',
      '1.1',
      'r11-999-orphan-spec.md',
    )
    await writeFile(orphanPath, '# r11-999-orphan-spec｜孤儿\n', 'utf8')
    await expect(checkDevelopmentRoadmap(orphanFixture.root)).rejects.toThrow(/manifest 未登记的孤儿规格/)

    const unknownFixture = await writeFixture()
    const current = await readFile(unknownFixture.oneOneSpecPath, 'utf8')
    await writeFile(unknownFixture.oneOneSpecPath, `${current}\n后续交给 r11-999-missing-task。\n`, 'utf8')
    await expect(checkDevelopmentRoadmap(unknownFixture.root)).rejects.toThrow(/引用不存在的任务 ID r11-999-missing-task/)
  })

  it('requires every inventory writer to declare write access and hold legacy-inventory', async () => {
    const noLockFixture = await writeFixture()
    await writeFile(
      noLockFixture.oneOneSpecPath,
      renderOneOneSpec(noLockFixture.manifest.tasks[0], 'write', '允许更新唯一 inventory。'),
      'utf8',
    )
    await expect(checkDevelopmentRoadmap(noLockFixture.root)).rejects.toThrow(/Inventory access: write.*legacy-inventory/)

    const nonWriterFixture = await writeFixture()
    await writeFile(
      nonWriterFixture.oneOneSpecPath,
      renderOneOneSpec(nonWriterFixture.manifest.tasks[0], 'read', '允许修改 LEG-001 和 inventory。'),
      'utf8',
    )
    await expect(checkDevelopmentRoadmap(nonWriterFixture.root)).rejects.toThrow(/不是 inventory writer 却声称写入/)

    const wrongAccessFixture = await writeFixture()
    wrongAccessFixture.manifest.tasks[0].writeLocks.push('legacy-inventory')
    await writeManifest(wrongAccessFixture.root, wrongAccessFixture.manifest)
    await writeReleaseReadmes(wrongAccessFixture.root, wrongAccessFixture.manifest)
    await writeFile(
      wrongAccessFixture.oneOneSpecPath,
      renderOneOneSpec(wrongAccessFixture.manifest.tasks[0], 'read'),
      'utf8',
    )
    await expect(checkDevelopmentRoadmap(wrongAccessFixture.root)).rejects.toThrow(/legacy-inventory 写锁.*Inventory access 不是 write/)
  })

  it('allows a declared read-only task to inspect inventory without taking its write lock', async () => {
    const fixture = await writeFixture()
    await writeFile(
      fixture.oneOneSpecPath,
      renderOneOneSpec(fixture.manifest.tasks[0], 'read', '允许读取 inventory 与 LEG-001，禁止修改共享台账。'),
      'utf8',
    )
    await expect(checkDevelopmentRoadmap(fixture.root)).resolves.toMatchObject({ taskCount: 4 })
  })

  it('requires legacy-inventory writers to be totally ordered and keeps gates read-only', async () => {
    const unorderedFixture = await writeFixture()
    unorderedFixture.manifest.tasks[0].writeLocks.push('legacy-inventory')
    const secondWriter: FixtureTask = {
      id: 'r11-010-second-writer',
      release: '1.1',
      title: '第二台账 writer',
      dependencies: [],
      optional: false,
      writeLocks: ['legacy-inventory'],
      spec: '1.1/r11-010-second-writer.md',
    }
    unorderedFixture.manifest.tasks.push(secondWriter)
    await writeManifest(unorderedFixture.root, unorderedFixture.manifest)
    await writeReleaseReadmes(unorderedFixture.root, unorderedFixture.manifest)
    await writeOneOneSpec(
      unorderedFixture.root,
      unorderedFixture.manifest.tasks[0],
      'write',
      '允许更新 inventory。',
    )
    await writeOneOneSpec(unorderedFixture.root, secondWriter, 'write', '允许更新 inventory。')
    await expect(checkDevelopmentRoadmap(unorderedFixture.root)).rejects.toThrow(/legacy-inventory writer 必须在依赖图中全序/)

    const gateFixture = await writeFixture()
    const gate: FixtureTask = {
      id: 'r11-010-zero-gate',
      release: '1.1',
      title: '只读零门',
      dependencies: ['r11-000-fixture-foundation'],
      optional: false,
      writeLocks: ['legacy-inventory'],
      spec: '1.1/r11-010-zero-gate.md',
    }
    gateFixture.manifest.tasks.push(gate)
    await writeManifest(gateFixture.root, gateFixture.manifest)
    await writeReleaseReadmes(gateFixture.root, gateFixture.manifest)
    await writeOneOneSpec(gateFixture.root, gate, 'write', '允许更新 inventory。')
    await expect(checkDevelopmentRoadmap(gateFixture.root)).rejects.toThrow(/是 gate，必须只读 inventory/)
  })

  it('allows a partial archival crosswalk and rejects unknown old ids', async () => {
    const { root } = await writeFixture()
    const crosswalkPath = path.join(root, 'docs', 'development-plan', 'roadmap', 'OLD_PLAN_CROSSWALK.md')
    await writeFile(crosswalkPath, renderCrosswalk(OLD_PLAN_TASK_IDS.slice(1)), 'utf8')
    await expect(checkDevelopmentRoadmap(root)).resolves.toMatchObject({ crosswalkCount: 97 })

    await writeFile(crosswalkPath, renderCrosswalk(['r11-999-not-in-retired-plan']), 'utf8')
    await expect(checkDevelopmentRoadmap(root)).rejects.toThrow(/不属于归档旧路线/)
  })

  it('exposes exactly 98 canonical old task ids to keep the checker independent of the retired ZIP', () => {
    expect(OLD_PLAN_TASK_IDS).toHaveLength(98)
    expect(new Set(OLD_PLAN_TASK_IDS).size).toBe(98)
  })

  it('aggregates failures in a typed error for CLI non-zero handling', async () => {
    const { root, manifest } = await writeFixture()
    manifest.schemaVersion = 2
    manifest.tasks[0].dependencies = ['missing-task']
    await writeManifest(root, manifest)
    try {
      await checkDevelopmentRoadmap(root)
      throw new Error('expected roadmap validation to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(DevelopmentRoadmapValidationError)
      expect((error as DevelopmentRoadmapValidationError).issues.length).toBeGreaterThanOrEqual(2)
    }
  })
})
