/**
 * A scope flag that never reaches a job condition is a gate that never runs.
 *
 * GitHub Actions needs a flag declared twice: written to `$GITHUB_OUTPUT` by the
 * step, *and* re-exported in the job's `outputs:` map. Miss the second and
 * `needs.changes.outputs.<flag>` is the empty string, `== 'true'` is false, and
 * the job reports `skipped` — inside an otherwise green run, which is the worst
 * possible way to fail. That is exactly how `renderer_fonts` shipped: the gate
 * existed, the flag was computed, and the job could not fire.
 *
 * Checked by name sets rather than by parsing YAML: the failure is a name
 * present on one side and absent on the other, and matching that needs no
 * schema. Nothing here validates what the flags mean.
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(__dirname, '..', '..')
const workflowPath = join(repoRoot, '.github/workflows/check-contracts.yml')
const workflow = readFileSync(workflowPath, 'utf8')

/** `changes` re-exports its step outputs here; without this a flag is unreadable. */
function declaredJobOutputs(): Set<string> {
  const block = /^ {4}outputs:\n((?: {6}\S+:.*\n)+)/mu.exec(workflow)
  if (!block) throw new Error('找不到 changes 作业的 outputs 块')
  return new Set(
    [...block[1]!.matchAll(/^ {6}(\w+):/gmu)].map((match) => match[1]!),
  )
}

/** Flags the scope step computes and writes out. */
function emittedFlags(): Set<string> {
  return new Set(
    [...workflow.matchAll(/echo "(\w+)=\$\w+" >> "\$GITHUB_OUTPUT"/gu)]
      .map((match) => match[1]!),
  )
}

/** Flags some job's `if:` actually reads. */
function consumedFlags(): Set<string> {
  return new Set(
    [...workflow.matchAll(/needs\.changes\.outputs\.(\w+)/gu)].map((match) => match[1]!),
  )
}

describe('Scoped Validation 的作用域标志接线', () => {
  it('finds flags on all three sides, so the checks below are not vacuous', () => {
    expect(declaredJobOutputs().size).toBeGreaterThan(0)
    expect(emittedFlags().size).toBeGreaterThan(0)
    expect(consumedFlags().size).toBeGreaterThan(0)
  })

  it('re-exports every computed flag as a job output', () => {
    const declared = declaredJobOutputs()
    const unreachable = [...emittedFlags()].filter((flag) => !declared.has(flag)).sort()
    expect(unreachable, '这些标志写进了 $GITHUB_OUTPUT 但没在 outputs: 里声明，读出来永远是空值').toEqual([])
  })

  it('backs every flag a job condition reads with a declared output', () => {
    const declared = declaredJobOutputs()
    const dangling = [...consumedFlags()].filter((flag) => !declared.has(flag)).sort()
    expect(dangling, '这些标志被 if: 引用但没有声明，条件恒为假、作业永远跳过').toEqual([])
  })

  it('gives every renderer-font trigger a reason to exist', () => {
    // The gate is the only one that runs a renderer build, so its trigger list is
    // the one place a path can be forgotten. These four are why it exists: the
    // inline-limit line, the manifest, the check itself, and the workflow that
    // failed to wire it up the first time.
    const gate = /renderer_fonts=true/u.exec(workflow)
    expect(gate, 'renderer_fonts 触发分支不见了').not.toBeNull()
    for (const path of [
      'vite*.ts',
      'src/shared/fonts/*',
      'scripts/check-renderer-font-assets.ts',
      '.github/workflows/check-contracts.yml',
    ]) {
      expect(workflow, `renderer_fonts 应当由 ${path} 触发`).toContain(path)
    }
  })
})
