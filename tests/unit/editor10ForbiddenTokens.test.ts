import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  checkLegacyConsumers,
  LEGACY_QUERY_CATALOG,
} from '../../scripts/check-legacy-consumers'

const FORBIDDEN_TOKENS = [
  'v9-slide-candidate',
  'V8SlideBackend',
  'V8_SLIDE_BACKEND',
  'migrateProjectV8ToCourseProjectV9',
  'build-project-v8-courseware',
  '导入旧版工程',
  'legacy-runtime-v2',
  'legacy-whole-canvas',
  'isV9SlideCandidateBackend',
  'selectSlideCandidateBackend',
  'executeSlideCandidateCommand',
] as const

describe('Editor 1.0 forbidden token boundary', () => {
  const repoRoot = path.join(fileURLToPath(import.meta.url), '../../..')

  it('uses the unique legacy inventory scanner instead of a second path whitelist', () => {
    for (const token of FORBIDDEN_TOKENS) expect(LEGACY_QUERY_CATALOG).toContain(token)
    const result = checkLegacyConsumers({ projectRoot: repoRoot, mode: 'ratchet' })
    expect(result.newConsumers).toEqual([])
    expect(result.unmatchedHits).toEqual([])
    // 该断言真实扫描整个 legacy inventory：单独运行约 3.8s，全量 440 文件并发时曾到
    // 5.53s。只放宽调度等待上限，目录、token 与结果断言均未改变。
  }, 30_000)
})
