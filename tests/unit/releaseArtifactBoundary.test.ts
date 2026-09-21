/**
 * 022 / 060 的发布物数据边界：AI 消息、trace、凭据与本机个人路径不得进入
 * `.h5lesson`、Published payload 与导出 HTML。
 *
 * `docs/development-plan/reviews/2026-09-21-r20-contextual-acceptance.md:85`
 * 记录当时「没有任何测试或脚本证明消息/trace/凭据不进入发布物」，仓库里只有
 * 一次人工扫描结论。这个文件把那句话变成可重复执行的断言。
 *
 * 一个永远通过的检查器没有价值，所以本文件同时证明三件事：
 * 1. 每条规则都有样本，样本确实会开火（新增规则而不补样本会让本文件变红）；
 * 2. 把凭据/会话记录/trace/个人路径注入真实产物后，真实 producer 的输出会被拒绝；
 * 3. 真实干净产物 0 命中，且压缩代码里形似凭据的表达式不会误报。
 *
 * 本文件只读产物，不运行 `refresh:*`，不改写 `examples/`。
 */
import { createPackage, createPackageWithOptions, getRawHeader } from '@electron/asar'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { afterAll, describe, expect, it } from 'vitest'
import {
  RELEASE_ARTIFACT_BOUNDARY_DEFAULT_TARGET_FILES,
  RELEASE_ARTIFACT_BOUNDARY_DEFAULT_TARGETS,
  RELEASE_ARTIFACT_BOUNDARY_RULES,
  assertReleaseArtifactBoundaryClean,
  assertReleaseArtifactPathClean,
  hasReleaseArtifactZipSignature,
  readReleaseArtifactAsarEntries,
  releaseArtifactBoundaryTargetPath,
  releaseArtifactBoundaryTargetPaths,
  releaseArtifactRepositoryRoot,
  scanReleaseArtifactAsar,
  scanReleaseArtifactBytes,
  scanReleaseArtifactPath,
  scanReleaseArtifactText,
  scanReleaseArtifactTree,
} from '../../scripts/releaseArtifactBoundary'
import { componentPackagesFromArchive } from '@/renderer/components/componentPackageStore'
import { buildPublishedCourseStandaloneHtml } from '@/renderer/export/course/buildCoursePackages'
import { buildPublishedCourseV2Payload } from '@/renderer/export/course/buildPublishedCourse'
import {
  createCourseProjectArchive,
  openCourseProjectArchive,
} from '@/renderer/project/courseProjectArchive'
import type { CoursePublishSources } from '@/renderer/export/course/buildPublishedCourse'

const PLAYER_BUNDLE = 'window.__COURSE_PLAYER_PLACEHOLDER__=true;'
const SAMPLE_PROJECT = path.join(
  releaseArtifactRepositoryRoot,
  'examples',
  'sample-project.h5lesson',
)

/** 与真实密钥同形但显然是假值，用来证明规则会开火。 */
const FAKE_OPENAI_KEY = `sk-${'A1b2C3d4E5'.repeat(4)}`
const FAKE_CONVERSATION_ID = '2f1c9a44-6b0e-4a1f-9d2c-7f3b5e8a1042'

function artifactBytes(relativePath: string): Uint8Array {
  return new Uint8Array(readFileSync(path.join(releaseArtifactRepositoryRoot, relativePath)))
}

function readArtifact(absolutePath: string): Uint8Array {
  return new Uint8Array(readFileSync(absolutePath))
}

function sampleProjectSources(): { archive: ReturnType<typeof openCourseProjectArchive>; sources: CoursePublishSources } {
  const archive = openCourseProjectArchive(readArtifact(SAMPLE_PROJECT))
  return {
    archive,
    sources: {
      project: archive.project,
      assetFiles: archive.assetFiles,
      components: componentPackagesFromArchive(archive.project, archive.componentFiles),
    },
  }
}

function ruleIdsIn(findings: ReturnType<typeof scanReleaseArtifactText>): string[] {
  return findings.map((finding) => finding.ruleId)
}

describe('发布物边界规则集', () => {
  it('每条规则都有可开火的样本，规则与样本一一对应', () => {
    const samples: Record<string, string> = {
      'conversation.record-field': `{"schemaVersion":1,"conversationId":"${FAKE_CONVERSATION_ID}"}`,
      'conversation.session-ids-field': `"sessionIds":["${FAKE_CONVERSATION_ID}"]`,
      'conversation.agent-record-field': `{"workingDirectoryId":"${FAKE_CONVERSATION_ID}"}`,
      'conversation.agent-record-adapter': '{"version":3,"adapter":"codex","status":"running"}',
      'conversation.user-message-event': '{"kind":"user-message","text":"请把第二页改成选择题"}',
      'conversation.input-delivery-event': '{"kind":"input-delivery"}',
      'conversation.question-event': '{"kind":"question","question":{"id":"q1"}}',
      'trace.turn-ended-event': '{"kind":"turn-ended","status":"completed"}',
      'trace.observation-field': `"observationId":"${FAKE_CONVERSATION_ID}"`,
      'trace.host-results-field': '"hostResults":[',
      'trace.agent-record-store': 'AppData/Roaming/ittoedu/local-agent/v3/9f2c.json',
      'trace.conversation-store': 'lesson-conversations/v1/lesson-1/abc.json',
      'trace.conversation-index': 'conversation-index-v1.json',
      'trace.document-recovery-store': 'lesson-document-recovery/v1/abc.json',
      'trace.project-data-store': 'project-data/recovery.json',
      'trace.diagnostic-log-file': 'editor-diagnostics.previous.jsonl',
      'trace.diagnostic-entry':
        '{"timestamp":"2026-09-21T00:00:00.000Z","source":"renderer","message":"boom"}',
      'trace.diagnostic-report': '互动课件编辑器诊断报告\n生成时间：2026-09-21T00:00:00.000Z',
      'credential.openai-api-key': `OPENAI_API_KEY 形态：${FAKE_OPENAI_KEY}`,
      'credential.aws-access-key-id': 'AKIAIOSFODNN7EXAMPLE',
      'credential.github-token': `ghp_${'b7Kd93LmQ1x'.repeat(4)}`,
      'credential.slack-token': 'xoxb-123456789012-abcdefghijkl',
      'credential.private-key-block': '-----BEGIN RSA PRIVATE KEY-----\nMIIEow==',
      'credential.quoted-assignment': '"api_key":"a1b2c3d4e5f6"',
      'credential.unquoted-assignment': 'password=hunter2hunter2',
      'credential.bearer-header': 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9',
      'personal-path.windows-user-profile': 'C:\\Users\\teacher\\Documents\\a.h5lesson',
      'personal-path.macos-user-profile': '/Users/teacher/Documents/a.h5lesson',
      'personal-path.documents-directory': 'C:\\Users\\teacher\\Documents\\a.h5lesson',
      'personal-path.repository-root': releaseArtifactRepositoryRoot,
      'personal-path.home-directory': os.homedir(),
    }
    expect(Object.keys(samples).sort()).toEqual(
      RELEASE_ARTIFACT_BOUNDARY_RULES.map((rule) => rule.id).sort(),
    )
    for (const [ruleId, sample] of Object.entries(samples)) {
      const findings = scanReleaseArtifactText(sample, { artifact: '规则样本' })
      expect(ruleIdsIn(findings), `${ruleId} 的样本没有命中`).toContain(ruleId)
      expect(
        () => assertReleaseArtifactBoundaryClean(findings, `${ruleId} 样本`),
        ruleId,
      ).toThrow(ruleId)
    }
  })

  it('每条规则都带 g 标志，否则统计不到全部命中', () => {
    for (const rule of RELEASE_ARTIFACT_BOUNDARY_RULES) {
      expect(rule.pattern.global, rule.id).toBe(true)
    }
  })

  it('不把压缩代码里形似凭据的表达式当成凭据', () => {
    // 这几条是冻结基准 HTML（3.8MB）里真实出现过的写法，宽松的
    // `token:`/`secret:` 规则会在这里误报，因此规则要求引号或 12 字符以上的值。
    const codeLike = [
      'const a={token:Re.optional()};',
      'const b={token:Symbol(`published-interaction:${e.id}`)};',
      'if(token===l.token&&this.#m.delete(e.id)){}',
      'const c={secret:undefined,password:this.value};',
      'const d=secretStore.read(name);',
      'const e="sk-1";',
      'const f="Documents";',
      '<p>同学你好，本节没有密钥，也没有账号口令。</p>',
    ]
    for (const text of codeLike) {
      expect(
        ruleIdsIn(scanReleaseArtifactText(text, { artifact: '代码形态样本' })),
        text,
      ).toEqual([])
    }
  })

  it('不把说明文字里的 Documents/ 当成个人文档目录', () => {
    // 真实误报：`.agents/skills/build-courseware-project/references/external-case-build.md:17`
    // 正文写「用户 Documents/Desktop 的直接子项目」。旧的裸 `Documents[\\/]{1,2}` 会命中它，
    // 使发布边界在干净产物上报 personal-path，进而诱使后来者放宽规则。
    // 规则现在要求路径上下文（盘符／前导分隔符），同时仍必须抓到真实路径。
    const prose = [
      '4. 在当前已知工作区根、用户 Documents/Desktop 的直接子项目中做有界只读查找。',
      'see Documents/ for details',
      'const f="Documents";',
      'Documents',
    ]
    for (const text of prose) {
      expect(ruleIdsIn(scanReleaseArtifactText(text, { artifact: '说明文字样本' })), text).toEqual([])
    }
    const realPaths = [
      'C:\\Users\\teacher\\Documents\\a.h5lesson',
      '/home/teacher/Documents/a.h5lesson',
      '\\\\server\\share\\Documents\\a.h5lesson',
    ]
    for (const text of realPaths) {
      expect(ruleIdsIn(scanReleaseArtifactText(text, { artifact: '真实路径样本' })), text)
        .toContain('personal-path.documents-directory')
    }
  })

  it('识别 UTF-16LE 编码产物里的凭据', () => {
    // 只按 UTF-8 解码会漏掉 UTF-16 产物：ASCII 明文此时是「字符 + 0x00」交错字节，
    // UTF-8 解码得到夹杂 NUL 的字符串，任何凭据规则都不匹配；按原始字节扫描同样无效。
    // 这里用真实字节路径（scanReleaseArtifactBytes）而不是文本入口。
    const secret = 'api_key="a1b2c3d4e5f6"'
    const utf16 = Buffer.from(secret, 'utf16le')
    expect(ruleIdsIn(scanReleaseArtifactBytes(new Uint8Array(utf16), { artifact: 'UTF-16LE 产物' })))
      .toContain('credential.quoted-assignment')
    // 反向控制：UTF-8 形态必须仍然命中，且两种解码不会把同一规则计成两条。
    const utf8 = Buffer.from(secret, 'utf8')
    const findings = scanReleaseArtifactBytes(new Uint8Array(utf8), { artifact: 'UTF-8 产物' })
    expect(ruleIdsIn(findings)).toContain('credential.quoted-assignment')
    expect(findings.filter(finding => finding.ruleId === 'credential.quoted-assignment')).toHaveLength(1)
  })

  it('不把标识符里恰好含 sk- 的词当成 OpenAI 密钥', () => {
    // `r17-040-risk-preview-single-repair` 是仓库里真实存在的任务标识符：
    // 其中的 `sk-preview-single-repair` 满足旧的 `sk-[A-Za-z0-9_-]{16,}`，
    // 会让发布物边界在干净产物上误报。密钥是独立 token，前导必须是边界。
    const identifiers = [
      'r17-040-risk-preview-single-repair',
      'docs/risk-preview-single-repair.md',
      'disk-usage-report-2024-final',
      'task-preview-and-single-repair-plan',
    ]
    for (const text of identifiers) {
      expect(
        ruleIdsIn(scanReleaseArtifactText(text, { artifact: '标识符样本' })),
        text,
      ).toEqual([])
    }
    // 前导边界不能把真实密钥一起放过：这些仍然是凭据。
    for (const text of [
      `OPENAI_API_KEY=${FAKE_OPENAI_KEY}`,
      `"apiKey": "${FAKE_OPENAI_KEY}"`,
      `：${FAKE_OPENAI_KEY}`,
    ]) {
      expect(
        ruleIdsIn(scanReleaseArtifactText(text, { artifact: '凭据样本' })),
        text,
      ).toContain('credential.openai-api-key')
    }
  })
})

describe('注入 fixture 必须被拒绝（检查器非空转）', () => {
  it('压缩条目里的凭据会被解压后命中，并给出可读错误', () => {
    const bytes = zipSync({
      'project.json': strToU8('{"schemaVersion":9,"title":"干净工程"}'),
      'components/com.example.x@4.0.0/runtime.js': strToU8(
        `export const key = "${FAKE_OPENAI_KEY}";\n`,
      ),
    })
    const findings = scanReleaseArtifactBytes(bytes, { artifact: '被篡改的 .h5lesson' })
    const keyFinding = findings.find((finding) => finding.ruleId === 'credential.openai-api-key')
    expect(keyFinding).toBeDefined()
    expect(keyFinding?.entry).toBe('components/com.example.x@4.0.0/runtime.js')
    expect(keyFinding?.location).toBe('entry-content')
    expect(keyFinding?.occurrences).toBe(1)
    expect(() =>
      assertReleaseArtifactBoundaryClean(findings, '被篡改的 .h5lesson'),
    ).toThrow(/被篡改的 \.h5lesson 发现 \d+ 处应用记录\/凭据边界违规[\s\S]*credential\.openai-api-key/u)
  })

  it('个人路径藏在归档条目名里也会被命中', () => {
    const bytes = zipSync({
      'project.json': strToU8('{"schemaVersion":9}'),
      'C:/Users/teacher/notes.json': strToU8('{}'),
    })
    const findings = scanReleaseArtifactBytes(bytes, { artifact: '条目名被篡改的 .h5lesson' })
    const pathFinding = findings.find(
      (finding) => finding.ruleId === 'personal-path.windows-user-profile',
    )
    expect(pathFinding?.location).toBe('entry-name')
    expect(pathFinding?.entry).toBe('C:/Users/teacher/notes.json')
  })

  it('会话记录信封注入 Published payload 会被拒绝', () => {
    const { sources } = sampleProjectSources()
    const published = buildPublishedCourseV2Payload(sources)
    const text = JSON.stringify(published)
    expect(ruleIdsIn(scanReleaseArtifactText(text, { artifact: 'Published V2' }))).toEqual([])

    const injected = text.replace(
      '"format":',
      `"conversationId":"${FAKE_CONVERSATION_ID}","sessionIds":["${FAKE_CONVERSATION_ID}"],"format":`,
    )
    expect(() =>
      assertReleaseArtifactBoundaryClean(
        scanReleaseArtifactText(injected, { artifact: 'Published V2' }),
        'Published payload',
      ),
    ).toThrow(/Published payload 发现 \d+ 处[\s\S]*conversation\.record-field/u)
  })

  it('trace 与诊断日志片段注入导出 HTML 会被拒绝', () => {
    const { sources } = sampleProjectSources()
    const html = buildPublishedCourseStandaloneHtml(sources, PLAYER_BUNDLE)
    expect(ruleIdsIn(scanReleaseArtifactText(html, { artifact: '导出 HTML' }))).toEqual([])

    const injected = html.replace(
      '</body>',
      '<script>/* editor-diagnostics.jsonl */</script>' +
        '<script>{"kind":"turn-ended","status":"completed"}</script></body>',
    )
    expect(() =>
      assertReleaseArtifactBoundaryClean(
        scanReleaseArtifactText(injected, { artifact: '导出 HTML' }),
        '导出 HTML',
      ),
    ).toThrow(/导出 HTML 发现 \d+ 处[\s\S]*trace\.diagnostic-log-file/u)
  })

  it('把凭据写进真实工程后，真实 producer 的三种产物都会被拒绝', () => {
    const { archive } = sampleProjectSources()
    const tampered = {
      ...archive,
      project: { ...archive.project, title: `示例互动课件 ${FAKE_OPENAI_KEY}` },
    }
    const tamperedSources: CoursePublishSources = {
      project: tampered.project,
      assetFiles: tampered.assetFiles,
      components: componentPackagesFromArchive(tampered.project, tampered.componentFiles),
    }

    const archiveBytes = createCourseProjectArchive(tampered)
    expect(() =>
      assertReleaseArtifactBoundaryClean(
        scanReleaseArtifactBytes(archiveBytes, { artifact: '篡改后的 .h5lesson' }),
        '篡改后的 .h5lesson',
      ),
    ).toThrow(/credential\.openai-api-key/u)

    const publishedText = JSON.stringify(buildPublishedCourseV2Payload(tamperedSources))
    expect(publishedText).toContain(FAKE_OPENAI_KEY)
    expect(() =>
      assertReleaseArtifactBoundaryClean(
        scanReleaseArtifactText(publishedText, { artifact: '篡改后的 Published V2' }),
        '篡改后的 Published V2',
      ),
    ).toThrow(/credential\.openai-api-key/u)

    const html = buildPublishedCourseStandaloneHtml(tamperedSources, PLAYER_BUNDLE)
    expect(html).toContain(FAKE_OPENAI_KEY)
    expect(() =>
      assertReleaseArtifactBoundaryClean(
        scanReleaseArtifactText(html, { artifact: '篡改后的导出 HTML' }),
        '篡改后的导出 HTML',
      ),
    ).toThrow(/credential\.openai-api-key/u)
  })

  it('带 ZIP 签名却解不开时失败关闭，不把压缩内容判成干净', () => {
    // 截断的真实 zip：签名仍在，但明文密钥在原始字节里不可见，解压必然失败。
    const whole = zipSync({ 'project.json': strToU8(`{"title":"${FAKE_OPENAI_KEY}"}`) })
    const truncated = whole.slice(0, Math.floor(whole.length / 2))
    expect(hasReleaseArtifactZipSignature(truncated)).toBe(true)
    expect(new TextDecoder().decode(truncated)).not.toContain(FAKE_OPENAI_KEY)

    // 记录曾经的实现给出的错误结论：退回整包文本扫描时这个产物「0 命中」，
    // 也就是把一个内含真实凭据的归档判成干净。这条断言是失败关闭的理由本身。
    expect(
      scanReleaseArtifactText(new TextDecoder().decode(truncated), { artifact: '截断的 .h5lesson' }),
    ).toEqual([])

    expect(() => scanReleaseArtifactBytes(truncated, { artifact: '截断的 .h5lesson' })).toThrow(
      /无法解压/u,
    )
    // 只有签名加明文的样本同样不是可检查的归档，不能因为明文可见就放行。
    const magicOnly = strToU8(`PK\u0003\u0004${FAKE_OPENAI_KEY}`)
    expect(() => scanReleaseArtifactBytes(magicOnly, { artifact: '损坏的 .h5lesson' })).toThrow(
      /无法解压/u,
    )
  })
})

describe('真实产物 0 命中', () => {
  it('tracked 工程 / 组件包 / Published payload / 固定 HTML 全部干净', () => {
    expect(RELEASE_ARTIFACT_BOUNDARY_DEFAULT_TARGETS.length).toBeGreaterThanOrEqual(6)
    for (const relativePath of RELEASE_ARTIFACT_BOUNDARY_DEFAULT_TARGETS) {
      const findings = scanReleaseArtifactBytes(artifactBytes(relativePath), {
        artifact: relativePath,
      })
      expect(findings, relativePath).toEqual([])
      expect(
        () => assertReleaseArtifactBoundaryClean(findings, relativePath),
        relativePath,
      ).not.toThrow()
    }
  })

  it('真实 producer 重新生成的工程 / Published / 导出 HTML 干净', () => {
    const { archive, sources } = sampleProjectSources()

    const archiveBytes = createCourseProjectArchive(archive)
    expect(unzipSync(archiveBytes)['project.json']).toBeDefined()
    expect(
      scanReleaseArtifactBytes(archiveBytes, { artifact: '重新生成的 .h5lesson' }),
    ).toEqual([])

    const published = buildPublishedCourseV2Payload(sources)
    expect(published.title).toBe(archive.project.title)
    expect(
      scanReleaseArtifactText(JSON.stringify(published), { artifact: '重新生成的 Published V2' }),
    ).toEqual([])

    const html = buildPublishedCourseStandaloneHtml(sources, PLAYER_BUNDLE)
    expect(html.length).toBeGreaterThan(1000)
    expect(scanReleaseArtifactText(html, { artifact: '重新生成的导出 HTML' })).toEqual([])
  })

  it('压缩条目必须解压后才能命中：不解压的扫描会漏掉条目内容', () => {
    const bytes = zipSync({ 'project.json': strToU8(`{"title":"${FAKE_OPENAI_KEY}"}`) })
    // 压缩后的原始字节里读不到明文，所以「不解压的扫描」会漏。
    expect(new TextDecoder().decode(bytes)).not.toContain(FAKE_OPENAI_KEY)
    expect(ruleIdsIn(scanReleaseArtifactBytes(bytes, { artifact: '压缩样本' }))).toContain(
      'credential.openai-api-key',
    )
    // 真实 tracked 工程同理：明文只存在于解压后的条目里。
    const real = readArtifact(SAMPLE_PROJECT)
    expect(strFromU8(unzipSync(real)['project.json'])).toContain('示例互动课件')
    expect(new TextDecoder().decode(real)).not.toContain('示例互动课件')
  })
})

// ---------------------------------------------------------------------------
// 目标清单的单一来源与漂移守卫
//
// 背景：`scripts/releaseArtifactBoundary.ts` 的默认目标常量与
// `scripts/verify-release.ts` 调用点曾各有一份平行清单。2026-09-22 用
// `output/r20-wf-boundary/probe-targets.mjs` 逐项比较，两份解析到仓库根后
// 同序同集合（6 vs 6，仅 A 有 = []，仅 B 有 = []），所以合并为单一来源不会
// 改变被扫描的文件集合。这两条用例把这个结论钉住。
// ---------------------------------------------------------------------------

describe('发布边界目标清单只有一处定义', () => {
  const verifyReleaseSource = readFileSync(
    path.join(releaseArtifactRepositoryRoot, 'scripts', 'verify-release.ts'),
    'utf8',
  )

  it('默认常量、具名取值与解析结果同序同集合，且仍是原来的 6 个文件', () => {
    const derived = releaseArtifactBoundaryTargetPaths(releaseArtifactRepositoryRoot)
    expect(RELEASE_ARTIFACT_BOUNDARY_DEFAULT_TARGETS).toHaveLength(6)
    expect(derived).toEqual(
      RELEASE_ARTIFACT_BOUNDARY_DEFAULT_TARGETS.map((relative) =>
        path.join(releaseArtifactRepositoryRoot, relative),
      ),
    )
    // 钉住实际被扫描的文件集合（合并前后必须一致）。
    expect(
      derived.map((value) =>
        path.relative(releaseArtifactRepositoryRoot, value).split(path.sep).join('/'),
      ),
    ).toEqual([
      'examples/sample-project.h5lesson',
      'examples/photosynthesis-interactive-lesson.h5lesson',
      'examples/sample-counter.h5component',
      'examples/render-host-benchmark/render-host-benchmark-v9.h5lesson',
      'examples/render-host-benchmark/published-v2.json',
      'examples/render-host-benchmark/render-host-benchmark-v2.html',
    ])
    for (const key of Object.keys(RELEASE_ARTIFACT_BOUNDARY_DEFAULT_TARGET_FILES)) {
      expect(derived).toContain(
        releaseArtifactBoundaryTargetPath(
          key as keyof typeof RELEASE_ARTIFACT_BOUNDARY_DEFAULT_TARGET_FILES,
          releaseArtifactRepositoryRoot,
        ),
      )
    }
    for (const value of derived) expect(existsSync(value)).toBe(true)
  })

  it('verify-release.ts 从同一来源取目标，没有第二份平行清单', () => {
    // 正例：发布脚本的边界调用点必须用派生结果，而不是就地拼一份清单。
    expect(verifyReleaseSource).toContain(
      'releaseArtifactBoundaryTargetPaths(projectRoot)',
    )
    // 反例：这 6 个文件名不得再出现在任何 `path.join(...)` 字面量里。
    // 只禁 `path.join` 形式 —— `benchmarkNotices.includes('render-host-benchmark-v2.html')`
    // 是「第三方声明文件必须提到该文件名」的内容断言，不是路径定义。
    for (const relative of RELEASE_ARTIFACT_BOUNDARY_DEFAULT_TARGETS) {
      const fileName = path
        .basename(relative)
        .replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
      expect(verifyReleaseSource).not.toMatch(
        new RegExp(`path\\.join\\([^()]*'${fileName}'`, 'su'),
      )
    }
    // 具名引用只能走同一个取值函数，且 key 必须都是已声明的 key。
    const referencedKeys = [
      ...verifyReleaseSource.matchAll(
        /releaseArtifactBoundaryTargetPath\(\s*'([A-Za-z]+)'/gu,
      ),
    ].map((match) => match[1])
    expect(referencedKeys.length).toBeGreaterThanOrEqual(5)
    const declaredKeys = Object.keys(RELEASE_ARTIFACT_BOUNDARY_DEFAULT_TARGET_FILES)
    for (const key of referencedKeys) expect(declaredKeys).toContain(key)
  })

  it('verify-release.ts 里不出现仓库相对路径字面量', () => {
    // 上一条只禁 `path.join(..., '<文件名>')`，因此下面这种平行清单能绕过它：
    //   const targets = ['examples/sample-project.h5lesson', …]
    //   targets.map(relative => path.join(projectRoot, ...relative.split('/')))
    //   void releaseArtifactBoundaryTargetPaths(projectRoot)   // 只为满足 toContain
    // 这里的判据是「带目录的仓库相对路径不得作为字符串字面量出现」：合法的内容断言
    // （`benchmarkNotices.includes('render-host-benchmark-v2.html')`）用的是裸文件名，
    // 不含目录，因此不会被误伤。常量本身用 path.join 拼，Windows 上是反斜杠，
    // 所以两种分隔符都按仓库相对形式（正斜杠）与原生形式各查一遍。
    for (const relative of RELEASE_ARTIFACT_BOUNDARY_DEFAULT_TARGETS) {
      const posix = relative.split(path.sep).join('/')
      expect(posix, relative).toContain('/')
      const forms = new Set([relative, posix])
      for (const form of forms) {
        expect(verifyReleaseSource, form).not.toContain(`'${form}'`)
        expect(verifyReleaseSource, form).not.toContain(`"${form}"`)
        expect(verifyReleaseSource, form).not.toContain(`\`${form}\``)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// 打包产物：app.asar 逐条目扫描 + win-unpacked/resources 目录扫描
//
// 源码树里的 6 个产物不等于发布物；真正发给用户的是
// `release/win-unpacked/resources/app.asar`。asar 未压缩（JSON 头 + 顺序拼接的
// 条目体），所以「整包当纯文本扫」能看见明文，但它给不出条目归属，也看不见
// `unpacked` 条目 —— 那些内容根本不在 asar 里，而在 `<asar>.unpacked/` 下。
// ---------------------------------------------------------------------------

const temporaryRoots: string[] = []

function makeTemporaryRoot(prefix: string): string {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix))
  temporaryRoots.push(root)
  return root
}

afterAll(() => {
  for (const root of temporaryRoots) {
    rmSync(root, { recursive: true, force: true })
  }
})

/** 用 `@electron/asar` 造一个真实 asar；键是归档内相对路径（`/` 分隔）。 */
async function buildAsar(
  files: Record<string, string>,
  options?: { unpack?: string },
): Promise<string> {
  const root = makeTemporaryRoot('release-boundary-asar-')
  const source = path.join(root, 'source')
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(source, ...name.split('/'))
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
  const archive = path.join(root, 'app.asar')
  if (options?.unpack) {
    await createPackageWithOptions(source, archive, { unpack: options.unpack })
  } else {
    await createPackage(source, archive)
  }
  return archive
}

describe('打包产物 app.asar 逐条目扫描', () => {
  it('真实 asar 里的凭据按条目命中，并归属到具体条目', async () => {
    const archive = await buildAsar({
      'package.json': '{"name":"boundary-probe","version":"1.0.0"}',
      'clean.js': 'export const ok = 1;\n',
      'resources/nested/leak.js': `export const k = "${FAKE_OPENAI_KEY}";\n`,
    })

    // asar 不是压缩格式，明文在原始字节里就可见 —— 所以「按条目扫」不是为了
    // 看得见内容，而是为了条目归属与 unpacked 条目。
    expect(new TextDecoder().decode(readFileSync(archive))).toContain(FAKE_OPENAI_KEY)

    const result = scanReleaseArtifactAsar(archive, { artifact: 'app.asar 样本' })
    expect(result.coverage).toMatchObject({ archives: 1, entries: 3, files: 0 })
    expect(result.coverage.bytes).toBeGreaterThan(0)

    const credentialFindings = result.findings.filter(
      (finding) => finding.ruleId === 'credential.openai-api-key',
    )
    expect(credentialFindings).toHaveLength(1)
    expect(credentialFindings[0]).toMatchObject({
      artifact: 'app.asar 样本',
      entry: 'resources/nested/leak.js',
      location: 'entry-content',
      category: 'credential',
    })
    // 干净条目不会被牵连。
    expect(result.findings.some((finding) => finding.entry === 'clean.js')).toBe(false)

    await expect(assertReleaseArtifactPathClean(archive, 'app.asar 样本')).rejects.toThrow(
      /credential\.openai-api-key/u,
    )
  })

  it('干净 asar 通过，且条目计数非零（证明扫描不是空转）', async () => {
    const archive = await buildAsar({
      'package.json': '{"name":"boundary-probe","version":"1.0.0"}',
      'clean.js': 'export const ok = 1;\n',
      'resources/nested/clean.json': '{"title":"示例互动课件"}',
    })
    const coverage = await assertReleaseArtifactPathClean(archive, '干净 app.asar')
    expect(coverage).toMatchObject({ archives: 1, entries: 3, files: 0 })
    expect(coverage.bytes).toBeGreaterThan(0)
  })

  it('头部损坏 / 截断 / 越界 / 非 asar：一律抛错，绝不静默判干净', async () => {
    const archive = await buildAsar({ 'clean.js': 'export const ok = 1;\n' })
    const original = readFileSync(archive)
    const { headerSize } = getRawHeader(archive)
    expect(headerSize).toBeGreaterThan(0)
    const root = makeTemporaryRoot('release-boundary-broken-')

    const cases: ReadonlyArray<readonly [string, Buffer]> = [
      ['头部不是 JSON', Buffer.concat([original.subarray(0, 8), Buffer.from('{not json}')])],
      ['整体截断', original.subarray(0, 12)],
      ['不是 asar', Buffer.from('not an asar at all')],
      // 头部完整、归档体被截掉：条目声明的区间落在文件之外。
      ['条目区间越界', original.subarray(0, 8 + headerSize + 1)],
    ]
    for (const [name, bytes] of cases) {
      const broken = path.join(root, `${name}.asar`)
      writeFileSync(broken, bytes)
      expect(() => readReleaseArtifactAsarEntries(broken), name).toThrow(
        /拒绝跳过条目检查放行/u,
      )
      await expect(scanReleaseArtifactPath(broken), name).rejects.toThrow(
        /拒绝跳过条目检查放行/u,
      )
    }
  })

  it('unpacked 条目的内容不在 asar 里：从 <asar>.unpacked 读，缺失即抛错', async () => {
    const archive = await buildAsar(
      {
        'package.json': '{"name":"boundary-probe","version":"1.0.0"}',
        'native/addon.node': `native-binary-placeholder\n${FAKE_OPENAI_KEY}\n`,
        'index.js': 'export const ok = 1;\n',
      },
      { unpack: '**/*.node' },
    )
    // 内容真的不在归档字节里 —— 整包文本扫描对这个条目什么都看不到。
    expect(new TextDecoder().decode(readFileSync(archive))).not.toContain(FAKE_OPENAI_KEY)
    expect(existsSync(`${archive}.unpacked`)).toBe(true)

    const result = scanReleaseArtifactAsar(archive, { artifact: 'unpacked 样本' })
    expect(result.coverage.entries).toBe(3)
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        entry: 'native/addon.node',
        location: 'entry-content',
        ruleId: 'credential.openai-api-key',
      }),
    )

    // 内容读不出来时失败关闭：不能因为「归档字节里没有」就判干净。
    rmSync(`${archive}.unpacked`, { recursive: true, force: true })
    expect(() => readReleaseArtifactAsarEntries(archive)).toThrow(
      /拒绝跳过条目检查放行/u,
    )
  })

  it('目录扫描：.asar 走条目扫描，其余文件走字节扫描', async () => {
    const root = makeTemporaryRoot('release-boundary-tree-')
    const resources = path.join(root, 'win-unpacked', 'resources')
    const unpacked = path.join(resources, 'app.asar.unpacked')
    mkdirSync(unpacked, { recursive: true })
    writeFileSync(
      path.join(unpacked, 'leaked.json'),
      `{"note":"${FAKE_OPENAI_KEY}"}`,
    )
    const source = path.join(root, 'source')
    mkdirSync(source, { recursive: true })
    writeFileSync(
      path.join(source, 'package.json'),
      '{"name":"boundary-probe","version":"1.0.0"}',
    )
    writeFileSync(path.join(source, 'index.js'), 'export const ok = 1;\n')
    await createPackage(source, path.join(resources, 'app.asar'))

    const result = await scanReleaseArtifactTree(resources, 'win-unpacked/resources')
    expect(result.coverage).toMatchObject({ archives: 1, entries: 2, files: 1 })
    expect(result.findings.map((finding) => finding.artifact)).toContain(
      path.join(unpacked, 'leaked.json'),
    )
    await expect(
      assertReleaseArtifactPathClean(resources, 'win-unpacked/resources'),
    ).rejects.toThrow(/credential\.openai-api-key/u)
  })

  it('目标不存在时抛错，不会退化成「0 命中」', async () => {
    const root = makeTemporaryRoot('release-boundary-missing-')
    await expect(scanReleaseArtifactPath(path.join(root, 'nope.asar'))).rejects.toThrow()
    await expect(scanReleaseArtifactTree(path.join(root, 'nope'))).rejects.toThrow()
  })
})
