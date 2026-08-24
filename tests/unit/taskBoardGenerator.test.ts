import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  checkTaskBoard,
  generateTaskBoard,
  parseTaskCard,
  writeTaskBoard,
} from '../../scripts/generate-task-board'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })),
  )
})

interface CardOptions {
  status?: string
  phase?: string
  riskTier?: string
  taskClass?: string
  necessity?: string
  complexityDelta?: string
  validationCeiling?: string
  validationBudget?: string
  reviewerBudget?: string
  evidenceReuse?: string
  invalidatingPaths?: string
  validationHeading?: 'Minimal validation' | 'Validation' | 'Validation plan'
  validation?: string
  omitValidationSection?: boolean
  additiveException?: string
  omitFields?: readonly string[]
}

function card(id: string, options: CardOptions = {}): string {
  const {
    status = 'ready',
    phase = 'ARCH-0A / wave 1',
    riskTier = 'S1',
    taskClass = 'implementation',
    necessity = 'Needed for one observable behavior; skip if it already passes.',
    complexityDelta = 'neutral',
    validationCeiling = taskClass === 'implementation' ? 'V1' : 'V2',
    validationBudget = '10 minutes',
    reviewerBudget = '1',
    evidenceReuse = 'Reuse only for the same product commit.',
    invalidatingPaths = 'src/example.ts; tests/unit/example.test.ts',
    validationHeading = 'Minimal validation',
    validation = '- npx vitest run tests/unit/example.test.ts',
    omitValidationSection = false,
    additiveException,
    omitFields = [],
  } = options
  const policyFields = [
    ['Policy version', '2'],
    ['Risk tier', riskTier],
    ['Task class', taskClass],
    ['Necessity / skip condition', necessity],
    ['Complexity delta', complexityDelta],
    ['Validation ceiling', validationCeiling],
    ['Validation budget', validationBudget],
    ['Reviewer budget', reviewerBudget],
    ['Evidence reuse', evidenceReuse],
    ['Invalidating paths', invalidatingPaths],
    ...(additiveException === undefined
      ? []
      : [['Additive exception', additiveException] as const]),
  ]
    .filter(([label]) => !omitFields.includes(label))
    .map(([label, value]) => '- ' + label + ': ' + value)

  return [
    '# S1 Task Card',
    '',
    '## State and assignment',
    '',
    '- Task ID: ' + id,
    '- Phase / wave: ' + phase,
    '- Status: ' + status,
    '- Owner / Reviewer / Integrator: Worker / Reviewer / Coordinator',
    '- Depends on: none',
    '- Blocks: next-task',
    ...policyFields,
    '',
    '## Product outcome',
    '',
    'One observable outcome for ' + id + '.',
    '',
    '## Current fact and evidence',
    '',
    'Evidence.',
    '',
    ...(omitValidationSection ? [] : ['## ' + validationHeading, '', validation, '']),
    '## Result evidence',
    '',
    'Historical evidence may mention npm test without changing the validation plan.',
    '',
  ].join('\n')
}

function legacyCard(id: string, status = 'done'): string {
  return [
    '# S1 Task Card',
    '',
    '## State and assignment',
    '',
    '- Task ID: ' + id,
    '- Phase / wave: ARCH-0A / wave 1',
    '- Status: ' + status,
    '- Owner / Reviewer / Integrator: Worker / Reviewer / Coordinator',
    '- Depends on: none',
    '- Blocks: next-task',
    '',
    '## Product outcome',
    '',
    'One observable outcome for ' + id + '.',
    '',
    '## Current fact and evidence',
    '',
    'Evidence.',
    '',
  ].join('\n')
}

async function createTaskRoot(): Promise<string> {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ittoedu-task-board-'))
  temporaryRoots.push(projectRoot)
  await fs.mkdir(path.join(projectRoot, 'docs', 'development-plan', 'tasks', 'arch-0a'), {
    recursive: true,
  })
  return projectRoot
}

describe('task board generator', () => {
  it('parses the stable task fields and rejects file/id mismatches', () => {
    const parsed = parseTaskCard(
      card('arch-0a-sample'),
      'docs/development-plan/tasks/arch-0a/arch-0a-sample.md',
    )
    expect(parsed).toMatchObject({
      id: 'arch-0a-sample',
      status: 'ready',
      phase: 'ARCH-0A / wave 1',
      outcome: 'One observable outcome for arch-0a-sample.',
    })
    expect(() =>
      parseTaskCard(card('wrong-id'), 'docs/development-plan/tasks/arch-0a/right-id.md'),
    ).toThrow(/文件名不一致/)
  })

  it('renders cards deterministically and detects a stale generated board', async () => {
    const projectRoot = await createTaskRoot()
    const tasksRoot = path.join(projectRoot, 'docs', 'development-plan', 'tasks', 'arch-0a')
    await fs.writeFile(
      path.join(tasksRoot, 'task-b.md'),
      card('task-b', { status: 'claimed' }),
      'utf8',
    )
    await fs.writeFile(path.join(tasksRoot, 'task-a.md'), legacyCard('task-a'), 'utf8')

    const first = await generateTaskBoard(projectRoot)
    const second = await generateTaskBoard(projectRoot)
    expect(first).toBe(second)
    expect(first.indexOf('[task-a]')).toBeLessThan(first.indexOf('[task-b]'))
    expect(first).not.toMatch(/20\d\d-|[A-Z]:\\/)

    await writeTaskBoard(projectRoot)
    await expect(checkTaskBoard(projectRoot)).resolves.toBeUndefined()
    await fs.writeFile(
      path.join(tasksRoot, 'task-b.md'),
      card('task-b', { status: 'target-green' }),
      'utf8',
    )
    await expect(checkTaskBoard(projectRoot)).rejects.toThrow(/已过期/)
  })

  it('rejects unknown statuses and duplicate IDs', async () => {
    expect(() =>
      parseTaskCard(
        legacyCard('bad-status', 'almost-done'),
        'docs/development-plan/tasks/arch-0a/bad-status.md',
      ),
    ).toThrow(/未知状态/)

    const projectRoot = await createTaskRoot()
    const firstRoot = path.join(projectRoot, 'docs', 'development-plan', 'tasks', 'arch-0a')
    const secondRoot = path.join(projectRoot, 'docs', 'development-plan', 'tasks', 'arch-0b')
    await fs.mkdir(secondRoot, { recursive: true })
    await fs.writeFile(path.join(firstRoot, 'same.md'), card('same'), 'utf8')
    await fs.writeFile(path.join(secondRoot, 'same.md'), card('same'), 'utf8')
    await expect(generateTaskBoard(projectRoot)).rejects.toThrow(/重复任务 ID/)
  })

  it('keeps legacy terminal cards compatible but requires policy 2 for active cards', () => {
    for (const status of ['done', 'wave-validated', 'parked', 'rolled-back']) {
      expect(() =>
        parseTaskCard(
          legacyCard('legacy-' + status, status),
          'docs/development-plan/tasks/arch-0a/legacy-' + status + '.md',
        ),
      ).not.toThrow()
    }
    expect(() =>
      parseTaskCard(
        legacyCard('legacy-ready', 'ready'),
        'docs/development-plan/tasks/arch-0a/legacy-ready.md',
      ),
    ).toThrow(/Policy version 2/)
    expect(() =>
      parseTaskCard(
        card('invalid-policy-done', {
          status: 'done',
          taskClass: 'unknown',
        }),
        'docs/development-plan/tasks/arch-0a/invalid-policy-done.md',
      ),
    ).toThrow(/Task class/)
  })

  it('requires every policy 2 governance field', () => {
    const requiredFields = [
      'Risk tier',
      'Task class',
      'Necessity / skip condition',
      'Complexity delta',
      'Validation ceiling',
      'Validation budget',
      'Reviewer budget',
      'Evidence reuse',
      'Invalidating paths',
    ]
    for (const field of requiredFields) {
      expect(() =>
        parseTaskCard(
          card('missing-policy-field', { omitFields: [field] }),
          'docs/development-plan/tasks/arch-0a/missing-policy-field.md',
        ),
      ).toThrow(field)
    }
  })

  it('accepts legal S0 implementation and S1 integration budgets', () => {
    expect(() =>
      parseTaskCard(
        card('legal-s0', {
          riskTier: 'S0',
          reviewerBudget: '0',
        }),
        'docs/development-plan/tasks/arch-0a/legal-s0.md',
      ),
    ).not.toThrow()
    expect(() =>
      parseTaskCard(
        card('legal-s1-integration', {
          taskClass: 'integration',
          validationCeiling: 'V2',
        }),
        'docs/development-plan/tasks/arch-0a/legal-s1-integration.md',
      ),
    ).not.toThrow()
  })

  it('enforces enums, positive-minute budgets, ceilings, and reviewer limits', () => {
    const cases: Array<[string, CardOptions, RegExp]> = [
      ['bad-risk', { riskTier: 'S3' }, /Risk tier/],
      ['bad-class', { taskClass: 'platform', validationCeiling: 'V1' }, /Task class/],
      ['bad-complexity', { complexityDelta: 'additive' }, /Complexity delta/],
      ['bad-time', { validationBudget: '0 minutes' }, /正整数分钟/],
      ['bad-ceiling', { validationCeiling: 'V2' }, /必须使用 Validation ceiling V1/],
      ['bad-s0-review', { riskTier: 'S0', reviewerBudget: '1' }, /上限 0/],
      ['bad-s1-review', { reviewerBudget: '2' }, /上限 1/],
    ]
    for (const [id, options, expected] of cases) {
      expect(() =>
        parseTaskCard(card(id, options), 'docs/development-plan/tasks/arch-0a/' + id + '.md'),
      ).toThrow(expected)
    }
  })

  it.each([
    ['npm test', 'Minimal validation'],
    ['npm run test:product', 'Minimal validation'],
    ['npm run test:e2e', 'Validation'],
    ['npm run verify', 'Validation plan'],
    ['npm run build:desktop', 'Minimal validation'],
    ['npx tsx scripts/measure-architecture-baseline.ts', 'Validation'],
    ['npm run repo:index:quality', 'Validation plan'],
  ] as const)('rejects over-ceiling validation command %s', (command, validationHeading) => {
    expect(() =>
      parseTaskCard(
        card('over-ceiling', {
          validation: '- ' + command,
          validationHeading,
        }),
        'docs/development-plan/tasks/arch-0a/over-ceiling.md',
      ),
    ).toThrow(/验证超过 V1/)
  })

  it('requires a non-empty supported validation section', () => {
    expect(() =>
      parseTaskCard(
        card('missing-validation', { omitValidationSection: true }),
        'docs/development-plan/tasks/arch-0a/missing-validation.md',
      ),
    ).toThrow(/必须包含非空/)
    expect(() =>
      parseTaskCard(
        card('empty-validation', { validation: '   ' }),
        'docs/development-plan/tasks/arch-0a/empty-validation.md',
      ),
    ).toThrow(/必须包含非空/)
    expect(() =>
      parseTaskCard(
        card('unsupported-validation-heading').replace(
          '## Minimal validation',
          '## Checks',
        ),
        'docs/development-plan/tasks/arch-0a/unsupported-validation-heading.md',
      ),
    ).toThrow(/必须包含非空/)
  })

  it('keeps docs/V0 free of direct product test runners', () => {
    for (const [id, validation] of [
      ['docs-vitest', '- npx vitest run tests/unit/example.test.ts'],
      ['docs-playwright', '- npx playwright test tests/e2e/example.spec.ts'],
    ] as const) {
      expect(() =>
        parseTaskCard(
          card(id, {
            taskClass: 'docs',
            validationCeiling: 'V0',
            validation,
          }),
          'docs/development-plan/tasks/arch-0a/' + id + '.md',
        ),
      ).toThrow(/docs\/V0/)
    }
  })

  it('allows targeted Vitest and Playwright commands and ignores Result evidence', () => {
    expect(() =>
      parseTaskCard(
        card('targeted-validation', {
          validation: [
            '- npx vitest run tests/unit/a.test.ts',
            '- npx vitest run tests/unit/b.test.ts',
            '- npx playwright test tests/e2e/example.spec.ts',
          ].join('\n'),
        }),
        'docs/development-plan/tasks/arch-0a/targeted-validation.md',
      ),
    ).not.toThrow()
  })

  it('requires explicit targets and limits implementation cards to three target files', () => {
    const missingTargetCases: Array<[string, CardOptions]> = [
      ['implementation-bare', { validation: '- npx vitest run' }],
      ['implementation-chained-bare', { validation: '- npx vitest run && git diff --check' }],
      ['vitest-config-only', { validation: '- npx vitest run --config vitest.config.ts' }],
      ['vitest-name-only', { validation: '- npx vitest run --testNamePattern foo' }],
      [
        'vitest-option-test-file',
        { validation: '- npx vitest run --config tests/unit/not-a-target.test.ts' },
      ],
      [
        'vitest-equals-option-test-file',
        { validation: '- npx vitest run --config=tests/unit/not-a-target.test.ts' },
      ],
      ['vitest-glob', { validation: '- npx vitest run tests/unit/*.test.ts' }],
      [
        'integration-bare',
        {
          taskClass: 'integration',
          validationCeiling: 'V2',
          validation: '- npx playwright test --project electron',
        },
      ],
      [
        'playwright-glob',
        {
          taskClass: 'integration',
          validationCeiling: 'V2',
          validation: '- npx playwright test tests/e2e/**/*.spec.ts',
        },
      ],
      [
        'wave-bare',
        {
          taskClass: 'wave-gate',
          validationCeiling: 'V2',
          validation: '- npx vitest run',
        },
      ],
    ]
    for (const [id, options] of missingTargetCases) {
      expect(() =>
        parseTaskCard(
          card(id, options),
          'docs/development-plan/tasks/arch-0a/' + id + '.md',
        ),
      ).toThrow(/无 glob 的明确 \.test\/\.spec 文件/)
    }
    expect(() =>
      parseTaskCard(
        card('too-many-target-files-one-command', {
          validation:
            '- npx vitest run tests/unit/a.test.ts tests/unit/b.test.ts tests/unit/c.test.ts tests/unit/d.test.ts',
        }),
        'docs/development-plan/tasks/arch-0a/too-many-target-files-one-command.md',
      ),
    ).toThrow(/不得超过 3 个明确 test target 文件/)
    expect(() =>
      parseTaskCard(
        card('manual-only-validation', {
          validation: '- Manual: reproduce the bounded user behavior and inspect the result.',
        }),
        'docs/development-plan/tasks/arch-0a/manual-only-validation.md',
      ),
    ).not.toThrow()
    expect(() =>
      parseTaskCard(
        card('three-target-files-four-commands', {
          validation: [
            '- npx vitest run tests/unit/a.test.ts',
            '- npx vitest run tests/unit/b.test.ts',
            '- npx vitest run tests/unit/c.test.ts',
            '- npx vitest run tests/unit/a.test.ts',
          ].join('\n'),
        }),
        'docs/development-plan/tasks/arch-0a/three-target-files-four-commands.md',
      ),
    ).not.toThrow()
  })

  it.each([
    '- npx vitest run tests/unit/hidden.test.ts',
    '- playwright test tests/e2e/hidden.spec.ts',
    '1. npm test',
    '> npm run test:e2e',
    '- [ ] npm run verify',
    '- `npm run build:desktop`',
    '- Command: npm run repo:index:quality',
  ])('rejects a command-style validation line outside the validation section: %s', (line) => {
    const markdown = card('hidden-validation-command').replace(
      '## Minimal validation',
      '## Implementation outline\n\n' + line + '\n\n## Minimal validation',
    )
    expect(() =>
      parseTaskCard(
        markdown,
        'docs/development-plan/tasks/arch-0a/hidden-validation-command.md',
      ),
    ).toThrow(/验证命令只能写在/)
  })

  it('allows ordinary validation prose outside validation and commands after result evidence', () => {
    const prose = [
      'Do not run npm test in this section.',
      'Vitest coverage is intentionally deferred.',
      'Playwright evidence remains unchanged.',
      'The command npm run verify is out of scope.',
    ].join('\n')
    const markdown = card('validation-prose-and-result-command')
      .replace('## Minimal validation', '## Notes\n\n' + prose + '\n\n## Minimal validation')
      .replace(
        'Historical evidence may mention npm test without changing the validation plan.',
        '- npx vitest run tests/unit/historical.test.ts',
      )
    expect(() =>
      parseTaskCard(
        markdown,
        'docs/development-plan/tasks/arch-0a/validation-prose-and-result-command.md',
      ),
    ).not.toThrow()
    expect(() =>
      parseTaskCard(
        markdown.replace('## Result evidence', '## Result and rollback'),
        'docs/development-plan/tasks/arch-0a/validation-prose-and-result-command.md',
      ),
    ).not.toThrow()
  })

  it('requires narrow implementation invalidating paths', () => {
    for (const [id, invalidatingPaths] of [
      ['broad-src', 'src/**'],
      ['broad-src-extension', 'src/*.ts'],
      ['broad-nested-src', 'src/renderer/**'],
      ['broad-tests', 'tests/**'],
      ['broad-root', '*'],
      ['broad-root-extension', '*.ts'],
      ['broad-all', 'all'],
      ['broad-repo', 'repo-wide'],
    ] as const) {
      expect(() =>
        parseTaskCard(
          card(id, { invalidatingPaths }),
          'docs/development-plan/tasks/arch-0a/' + id + '.md',
        ),
      ).toThrow(/最窄可解释路径/)
    }
    expect(() =>
      parseTaskCard(
        card('narrow-paths', {
          invalidatingPaths: 'src/example.ts; tests/unit/example.test.ts',
        }),
        'docs/development-plan/tasks/arch-0a/narrow-paths.md',
      ),
    ).not.toThrow()
    expect(() =>
      parseTaskCard(
        card('integration-broad-paths', {
          taskClass: 'integration',
          validationCeiling: 'V2',
          invalidatingPaths: 'src/**',
        }),
        'docs/development-plan/tasks/arch-0a/integration-broad-paths.md',
      ),
    ).not.toThrow()
  })

  it('rejects governance placeholders and requires an additive-exception reason', () => {
    const placeholderCases: Array<[string, CardOptions]> = [
      ['placeholder-necessity', { necessity: 'TBD' }],
      ['placeholder-evidence', { evidenceReuse: 'none' }],
      ['placeholder-paths', { invalidatingPaths: '—' }],
    ]
    for (const [id, options] of placeholderCases) {
      expect(() =>
        parseTaskCard(card(id, options), 'docs/development-plan/tasks/arch-0a/' + id + '.md'),
      ).toThrow(/不得使用空占位/)
    }
    expect(() =>
      parseTaskCard(
        card('missing-additive-reason', { complexityDelta: 'additive-exception' }),
        'docs/development-plan/tasks/arch-0a/missing-additive-reason.md',
      ),
    ).toThrow(/Additive exception/)
    expect(() =>
      parseTaskCard(
        card('placeholder-additive-reason', {
          complexityDelta: 'additive-exception',
          additiveException: 'none',
        }),
        'docs/development-plan/tasks/arch-0a/placeholder-additive-reason.md',
      ),
    ).toThrow(/不得使用空占位/)
    expect(() =>
      parseTaskCard(
        card('legal-additive-reason', {
          complexityDelta: 'additive-exception',
          additiveException: 'First real consumer requires one bounded seam.',
        }),
        'docs/development-plan/tasks/arch-0a/legal-additive-reason.md',
      ),
    ).not.toThrow()
    expect(() =>
      parseTaskCard(
        card('unexpected-additive-reason', {
          complexityDelta: 'neutral',
          additiveException: 'Not applicable.',
        }),
        'docs/development-plan/tasks/arch-0a/unexpected-additive-reason.md',
      ),
    ).toThrow(/只有 additive-exception/)
  })

  it('reserves final-candidate cards for ARCH-5', () => {
    const finalCandidate: CardOptions = {
      taskClass: 'final-candidate',
      validationCeiling: 'V4',
      reviewerBudget: '2',
    }
    expect(() =>
      parseTaskCard(
        card('early-final', { ...finalCandidate, phase: 'ARCH-4 / final gate' }),
        'docs/development-plan/tasks/arch-0a/early-final.md',
      ),
    ).toThrow(/只能在 ARCH-5/)
    expect(() =>
      parseTaskCard(
        card('arch-5-final', { ...finalCandidate, phase: 'ARCH-5 / final candidate' }),
        'docs/development-plan/tasks/arch-0a/arch-5-final.md',
      ),
    ).not.toThrow()
  })
})
