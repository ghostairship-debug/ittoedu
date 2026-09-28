import type { ExecutionRunRecord } from '../../../src/shared/workbench/execution'

type Tool = ExecutionRunRecord['tools'][number]
const object = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, any> : {}
const readStatus = (tool: Tool) => tool.result?.kind === 'read' ? object(tool.result.data).status : null

/** Actual tool order is the source of truth for the three M18 gates. */
export function relM18StageEvidence(runs: readonly ExecutionRunRecord[]) {
  const tools = runs.flatMap(run => run.tools)
  const index = (predicate: (tool: Tool) => boolean) => tools.findIndex(predicate)
  const created = (name: string) => index(tool => tool.call.name === 'file.create'
    && object(tool.call.input).name === name && tool.result?.kind === 'read')
  const plan = created('01-teaching-plan.md')
  const frame = created('02-course-frame.html')
  const script = created('02-presentation-script.md')
  const representation = created('03-representation-plan.md')
  const createdDocumentId = (at: number) => at >= 0 && tools[at]?.result?.kind === 'read'
    ? object(tools[at].result.data).documentId : null
  const savedAt = (at: number, before: number) => tools.findIndex((tool, toolIndex) => toolIndex > at
    && toolIndex < before && tool.call.name === 'file.save' && readStatus(tool) === 'saved'
    && tool.result?.kind === 'read' && object(tool.result.data).documentId === createdDocumentId(at))
  const skill = (name: string) => index(tool => tool.call.name === 'skills.read'
    && object(tool.call.input).skill === name && readStatus(tool) === 'read')
  const planSaved = savedAt(plan, tools.length)
  const frameSaved = savedAt(frame, tools.length)
  const scriptSaved = savedAt(script, tools.length)
  const representationSaved = savedAt(representation, tools.length)
  const orchestrateSkill = skill('orchestrate-courseware')
  const buildSkill = skill('build-courseware-project')
  const capabilityReads = tools.flatMap((tool, toolIndex) => tool.call.name === 'skills.read'
    && object(tool.call.input).path === 'references/representation-capabilities.md'
    && readStatus(tool) === 'read' ? [toolIndex] : [])
  const planningCapabilityReads = capabilityReads.filter(read => representation < 0 || read < representation)
  const earlyEditorLoad = tools.slice(0, frameSaved < 0 ? tools.length : frameSaved)
    .some(tool => tool.call.name === 'tools.load' || tool.call.name === 'html.import'
      || tool.call.name.startsWith('build.') || tool.call.name === 'image.generate')
  const imported = tools.flatMap((tool, toolIndex) => tool.call.name === 'html.import'
    && tool.result?.kind === 'document-operation' && tool.result.result.status === 'applied'
    ? [toolIndex] : [])
  const observations = tools.flatMap((tool, toolIndex) => tool.call.name === 'view.observe'
    && tool.result?.kind === 'read' ? [{ index: toolIndex,
      locationId: object(object(tool.result.data).identity).locationId as string | undefined }] : [])
  const saved = tools.flatMap((tool, toolIndex) => tool.call.name === 'file.save'
    && readStatus(tool) === 'saved' ? [toolIndex] : [])
  const exported = tools.flatMap((tool, toolIndex) => tool.call.name === 'document.export'
    && readStatus(tool) === 'written' && object(tool.call.input).format === 'html-offline'
    ? [toolIndex] : [])
  const reopen = tools.flatMap((tool, toolIndex) => tool.call.name === 'file.open'
    && object(tool.call.input).path?.endsWith('.h5lesson') && tool.result?.kind === 'read'
    ? [toolIndex] : [])
  const failedBuilds = tools.flatMap((tool, toolIndex) => tool.call.name.startsWith('build.')
    && (tool.result?.kind === 'error' || tool.call.name === 'build.compile'
      && tool.result?.kind === 'read' && object(tool.result.data).ok === false
      || tool.call.name === 'build.check' && readStatus(tool) === 'failed') ? [toolIndex] : [])
  const readyBuilds = tools.flatMap((tool, toolIndex) => tool.call.name === 'build.check'
    && readStatus(tool) === 'ready' ? [toolIndex] : [])
  const buildJob = (tool: Tool | undefined): string | null => {
    const job = object(tool?.call.input).job
    return typeof job === 'string' && job ? job : null
  }
  const repairedBuilds = tools.flatMap((tool, toolIndex) => tool.call.name === 'build.import'
    && tool.result?.kind === 'document-operation' && tool.result.result.status === 'applied'
    && buildJob(tool) !== null
    && readyBuilds.some(ready => ready < toolIndex
      && buildJob(tools[ready]) === buildJob(tool)
      && failedBuilds.some(failed => failed < ready
        && buildJob(tools[failed]) === buildJob(tool))) ? [toolIndex] : [])
  return { indexes: { plan, planSaved, frame, frameSaved, script, scriptSaved, representation,
    representationSaved, orchestrateSkill, buildSkill, capabilityReads, imported, observations, saved, exported, reopen,
    failedBuilds, repairedBuilds },
    m18T01: orchestrateSkill >= 0 && orchestrateSkill < planSaved && planSaved > plan
      && frameSaved > planSaved && frameSaved > frame && scriptSaved > script
      && !earlyEditorLoad && capabilityReads.every(read => read > frameSaved),
    m18T02: planningCapabilityReads.length === 1 && buildSkill < planningCapabilityReads[0]!
      && representation > planningCapabilityReads[0]! && representationSaved > representation,
    m18T03: imported.length > 0 && observations.length > 0
      && saved.some(save => save > imported[0]!) && exported.some(write => write > imported[0]!)
      && reopen.some(open => saved.some(save => save > imported[0]! && save < open)),
    agentSaved: saved.length > 0, agentExported: exported.length > 0,
    repairObserved: repairedBuilds.length > 0,
  }
}
