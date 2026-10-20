// @vitest-environment node
import { expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { generateBundledSkillArtifacts } from '../../scripts/generate-ai-capabilities'
import { BundledSkillService } from '../../src/main/workbench/skills/BundledSkillService'
import { ScopedSkillService } from '../../src/main/workbench/skills/ScopedSkillService'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
const examples = [
  ['SKILL.md', '可持续编辑的互动演示'],
  ['references/web-composition-examples.md', 'examples/text-evidence.html'],
  ['references/examples/text-evidence.html', '吾十有五而志于学'],
  ['references/examples/variable-relation.html', '记录当前数据'],
] as const
const authoringMethods = [
  'references/creation-plan.md',
  'references/visual-design.md',
  'references/interaction-design.md',
  'references/teaching-design-quality.md',
  'references/teacher-controller.md',
  'references/material-assembly.md',
] as const
it('packages current method and runnable HTML examples and reads them through the actual skills.read Gateway', async () => {
  const generated = await generateBundledSkillArtifacts(path.resolve(__dirname, '../..'))
  const bundle = JSON.parse(generated.bundle)
  const entry = generated.manifest.skills.find(skill => skill.name === 'orchestrate-courseware')!
  expect(entry.references).toContain('skills/orchestrate-courseware/references/examples/text-evidence.html')
  expect(entry.references).toContain('skills/orchestrate-courseware/references/examples/variable-relation.html')
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-html-gateway-'))
  const host = new DocumentHostService(path.join(directory, 'journals'))
  const service = new ScopedSkillService(new BundledSkillService(bundle), async () => [])
  host.tools.configureHostServices({ skills: service })
  await host.tools.beginRun({ runId: 'bundled-html', actor: 'agent', documents: [] })
  try {
    for (const [resource, marker] of examples) {
      const result = await host.tools.execute('bundled-html', resource, { name: 'skills.read', input: { skill: 'orchestrate-courseware', path: resource, limit: 64000 } })
      expect(result).toMatchObject({ kind: 'read', data: { status: 'read', path: resource, content: expect.stringContaining(marker), truncated: false } })
      if (resource === 'SKILL.md') expect((result as Extract<typeof result, { kind: 'read' }>).data)
        .toMatchObject({ content: expect.stringContaining('data-gl-layout="stage"') })
    }
    for (const resource of authoringMethods) {
      const result = await host.tools.execute('bundled-html', resource, { name: 'skills.read', input: { skill: 'orchestrate-courseware', path: resource, limit: 64000 } })
      expect(result).toMatchObject({ kind: 'read', data: {
        status: 'read', path: resource,
        content: await fs.readFile(path.resolve(__dirname, '../../.agents/skills/orchestrate-courseware', resource), 'utf8'),
        truncated: false,
      } })
    }
  } finally { await host.tools.stop('bundled-html'); await fs.rm(directory, { recursive: true, force: true }) }
})
