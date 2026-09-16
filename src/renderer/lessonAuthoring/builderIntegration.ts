import { DEFAULT_TEACHER_CONTROLLER_PACKAGE_ID } from '../../shared/defaultTeacherControllerComponent'
import { encodeBase64 } from '../export/base64'
import { createCoursewareBuilderV2WithOwner, type CoursewareBuilderV2Owner, type CoursewareBuilderV2Options } from '../course/coursewareBuilderV2'
import generatedCapabilities from '../../shared/generated/courseAgentCapabilities.json'
import { queryCourseAgentCapabilities, readCourseAgentCapability, type CourseAgentCapabilityData, type CourseAgentCapabilityQuery, type CourseAgentCapabilityCardOptions } from '../../shared/courseAgentCapabilities'
import { validateLessonBuilderModule, type LessonAssemblyInput, type LessonBuildFailure, type LessonBuildTarget } from '../../shared/lessonAuthoringDesktop'
import type { LessonAuthoringTicket } from '../../shared/lessonAuthoring'
import type { ComponentCatalogSnapshot } from '../../shared/componentCatalog'
export interface LessonAssemblyPorts {
  /** Flush and create through the application's existing new-project lifecycle exactly once. */
  createCourseProject(options: CoursewareBuilderV2Options): Promise<void>
  owner(): CoursewareBuilderV2Owner
  validate(ticket: LessonAuthoringTicket): Promise<{ allowed: boolean; issues: string[] }>
  /** Existing save lifecycle; success means a real saved .h5lesson path. */
  saveProject(): Promise<string>
  readAsset(relativePath: string): Promise<Uint8Array>
  componentCatalog(): Promise<ComponentCatalogSnapshot>
  importModule?(source: string): Promise<{ apiVersion?: number; default?: (context: unknown) => Promise<unknown> }>
}
async function importBuilder(source: string) {
  validateLessonBuilderModule(source)
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
  try { return await import(/* @vite-ignore */ url) as { apiVersion?: number; default?: (context: unknown) => Promise<unknown> } }
  finally { URL.revokeObjectURL(url) }
}
/** Explicit recovery observation; only the existing canonical owner is read. */
export function observeEmptyLessonBuildTarget(owner: CoursewareBuilderV2Owner): LessonBuildTarget {
  const project = owner.readDocument(), resources = owner.readResources()
  const nonempty = project.locations.length !== 1 || project.surfaces.length !== 1 || !!project.backgroundAssetId
    || Object.keys(project.assets).length > 0 || Object.keys(resources.assetFiles).length > 0
    || project.courseState.length > 0 || project.navigationGuards.length > 0 || project.globalInteractions.length > 0
    || project.globalLayerItems.some(({ item }) => item.kind !== 'component' || item.role !== 'teacher-controller' || item.component.packageId !== DEFAULT_TEACHER_CONTROLLER_PACKAGE_ID)
    || Object.keys(project.componentPackages).some(id => id !== DEFAULT_TEACHER_CONTROLLER_PACKAGE_ID)
    || Object.keys(resources.componentPackages).some(id => id !== DEFAULT_TEACHER_CONTROLLER_PACKAGE_ID)
    || project.surfaces.some(surface => surface.surfaceLayerItems.length > 0 || !!surface.backgroundAssetId || (surface.type === 'slide'
      ? surface.scenes.length !== 1 || surface.scenes.some(scene => scene.layerItems.length > 0 || scene.interactions.length > 0 || !!scene.backgroundAssetId)
      : surface.type === 'flow' ? surface.blocks.length > 0
      : surface.world.layerItems.length > 0 || !!surface.world.paths?.length || !!surface.world.relations?.length))
  if (nonempty) throw new Error('当前工程已有教学内容或资源，不能重新运行整个构建模块；请继续编辑当前工程')
  const observed = createCoursewareBuilderV2WithOwner(owner).observe()
  return { projectId: observed.projectId, revision: observed.documentRevision, generation: observed.generation }
}
export class LessonAssemblyError extends Error {
  constructor(message: string, readonly hasCommittedChanges: boolean, readonly failure?: LessonBuildFailure) { super(message); this.name = 'LessonAssemblyError' }
}
/** Execute in the current renderer; no additional Store, History, browser or model loop. */
export async function executeLessonAssembly(input: LessonAssemblyInput, ports: LessonAssemblyPorts): Promise<string> {
  let hasCommittedChanges = !!input.resumeTarget, committedStepCount = 0, activeOwner: CoursewareBuilderV2Owner | undefined
  let rejectedTool: Pick<LessonBuildFailure, 'tool' | 'diagnostics'> | undefined
  const targetOf = (owner: CoursewareBuilderV2Owner): LessonBuildTarget => ({ projectId: owner.readDocument().id, revision: owner.readDocument().revision, generation: owner.readGeneration() })
  try {
  const validate = async () => { const result = await ports.validate(input.ticket); if (!result.allowed) throw new Error(result.issues.join('；')) }
  await validate()
  const assertInitialTarget = () => { if (input.expectedInitialTarget && JSON.stringify(observeEmptyLessonBuildTarget(ports.owner())) !== JSON.stringify(input.expectedInitialTarget)) throw new Error('当前工程在修复后已变化，不能重新应用构建') }
  assertInitialTarget()
  let resumedOwner: CoursewareBuilderV2Owner | undefined
  if (input.resumeTarget) {
    const current = ports.owner()
    if (JSON.stringify(targetOf(current)) !== JSON.stringify(input.resumeTarget)) throw new Error('当前工程已变化，不能重新运行整个构建模块；请继续编辑当前工程')
    resumedOwner = current; activeOwner = current
  }
  const module = await (ports.importModule ?? importBuilder)(input.moduleSource)
  if (module.apiVersion !== 2 || typeof module.default !== 'function') throw new Error('构建模块必须声明 apiVersion 2 并导出构建函数')
  let created = false, finished: unknown
  let finishedTarget: LessonBuildTarget | undefined
  const assertTarget = () => { if (!activeOwner || !finishedTarget || JSON.stringify(targetOf(activeOwner)) !== JSON.stringify(finishedTarget)) throw new Error('当前工程已切换，构建结果未保存到其他工程') }
  const capabilities = generatedCapabilities as CourseAgentCapabilityData
  const api = Object.freeze({
    discover: (query: CourseAgentCapabilityQuery = {}) => queryCourseAgentCapabilities(capabilities, query),
    readCapability: (id: string, options: CourseAgentCapabilityCardOptions = {}) => readCourseAgentCapability(capabilities, id, options),
    componentCatalog: () => ports.componentCatalog(),
    async createCourseProject(options: CoursewareBuilderV2Options) {
      if (created) throw new Error('一个课例构建任务只创建一个当前工程')
      await validate()
      assertInitialTarget()
      if (resumedOwner && JSON.stringify(targetOf(resumedOwner)) !== JSON.stringify(input.resumeTarget)) throw new Error('当前工程在准备构建期间已变化，请保留教师修改并继续编辑')
      hasCommittedChanges = true
      try { if (!resumedOwner) await ports.createCourseProject(options) }
      catch (cause) { if (cause instanceof LessonAssemblyError && !cause.hasCommittedChanges) hasCommittedChanges = false; throw cause }
      created = true
      const owner = resumedOwner ?? ports.owner(); activeOwner = owner
      let expectedTarget = targetOf(owner)
      const assertExpectedTarget = () => { if (JSON.stringify(targetOf(owner)) !== JSON.stringify(expectedTarget)) throw new Error('当前工程或编辑会话已变化，当前构建已停止') }
      const builder = createCoursewareBuilderV2WithOwner({
        readDocument: () => owner.readDocument(), readResources: () => owner.readResources(), readScope: () => owner.readScope(), readGeneration: () => owner.readGeneration(),
        activate: next => { assertExpectedTarget(); owner.activate(next); expectedTarget = targetOf(owner) }, validateDestination: destination => owner.validateDestination(destination), commit: step => { assertExpectedTarget(); const committed = owner.commit(step); if (committed) { committedStepCount++; expectedTarget = targetOf(owner) } return committed }, signal: owner.signal,
        beforeExecute: async () => { await validate(); assertExpectedTarget(); await owner.beforeExecute?.(); assertExpectedTarget() },
      })
      return Object.freeze({ ...builder,
        async execute(...args: Parameters<typeof builder.execute>) {
          const receipt = await builder.execute(...args)
          rejectedTool = receipt.status === 'committed' || receipt.status === 'unchanged' ? undefined : { tool: args[0], diagnostics: receipt.diagnostics }
          return receipt
        },
        finish() { assertExpectedTarget(); finished = builder.finish(); finishedTarget = targetOf(owner); return finished },
      })
    },
  })
  const output = await module.default(Object.freeze({ api, encodeBase64, apiVersion: 2, caseDir: input.ticket.lesson.normalizedDirectory, documents: input.documents, readAsset: ports.readAsset }))
  if (!created || !finished || output !== finished) throw new Error('构建模块没有返回当前正式 Builder 的完成结果')
  await validate()
  assertTarget()
  const projectPath = await ports.saveProject()
  assertTarget()
  if (!projectPath) throw new Error('保存已取消，当前课件仍可编辑')
  await validate()
  assertTarget()
  return projectPath
  } catch (cause) {
    let target: LessonBuildTarget | undefined
    try { if (activeOwner) target = targetOf(activeOwner) } catch {}
    const message = (cause instanceof Error ? cause.message : String(cause)).slice(0, 20000)
    throw new LessonAssemblyError(message, hasCommittedChanges, { committedStepCount, message, ...rejectedTool, ...(target ? { target } : {}) })
  }
}
