import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  Info,
  LocateFixed,
  X,
} from 'lucide-react'
import { useMemo } from 'react'
import {
  collectCourseProjectHealth,
  summarizeCourseProjectHealth,
  type CourseProjectHealthFinding,
} from '../../shared/courseProjectHealth'
import { analyzeInformationRelease } from '../../shared/informationRelease'
import { analyzeVisualDensity } from '../../shared/visualDensity'
import {
  collectProjectHealth,
  summarizeProjectHealth,
  type ProjectHealthDiagnostic,
} from '../../shared/projectHealth'
import {
  resolveCourseProjectHealthRoute,
  resolveProjectHealthRoute,
} from '../diagnostics/projectHealthNavigation'
import { componentPackagesToArchiveFiles } from '../components/componentPackageStore'
import {
  selectActiveCourseProjectDocument,
  selectMediaAssetFiles,
  useEditorStore,
} from '../store/editorStore'

export interface ProjectHealthPanelProps {
  open: boolean
  onClose(): void
  onExportDiagnostics?(): void
}

const severityLabel = {
  error: '错误',
  warning: '提醒',
  info: '建议',
} as const

function SeverityIcon({ severity }: { severity: 'error' | 'warning' | 'info' }) {
  if (severity === 'error') return <CircleAlert size={17} aria-hidden="true" />
  if (severity === 'warning') return <AlertTriangle size={17} aria-hidden="true" />
  return <Info size={17} aria-hidden="true" />
}

export function ProjectHealthPanel({
  open,
  onClose,
  onExportDiagnostics,
}: ProjectHealthPanelProps) {
  if (!open) return null

  return (
    <OpenProjectHealthPanel
      onClose={onClose}
      onExportDiagnostics={onExportDiagnostics}
    />
  )
}

function OpenProjectHealthPanel({
  onClose,
  onExportDiagnostics,
}: Omit<ProjectHealthPanelProps, 'open'>) {
  const project = useEditorStore((state) => state.project)
  const courseProject = useEditorStore(selectActiveCourseProjectDocument)
  const assetFiles = useEditorStore(selectMediaAssetFiles)
  const componentPackages = useEditorStore((state) => state.componentPackages)
  const courseDiagnostics = useMemo(
    () => courseProject
      ? collectCourseProjectHealth(courseProject, {
          assetFiles,
          componentFiles: componentPackagesToArchiveFiles(componentPackages),
        })
      : null,
    [assetFiles, componentPackages, courseProject],
  )
  const legacyDiagnostics = useMemo(
    () => courseProject ? null : collectProjectHealth(project, componentPackages),
    [componentPackages, courseProject, project],
  )
  const diagnostics = courseDiagnostics ?? legacyDiagnostics ?? []
  const summary = useMemo(
    () => courseDiagnostics
      ? summarizeCourseProjectHealth(courseDiagnostics)
      : summarizeProjectHealth(legacyDiagnostics ?? []),
    [courseDiagnostics, legacyDiagnostics],
  )
  const informationRelease = useMemo(
    () => courseProject ? null : analyzeInformationRelease(project),
    [courseProject, project],
  )
  const visualDensity = useMemo(
    () => courseProject ? null : analyzeVisualDensity(project),
    [courseProject, project],
  )

  const locate = (diagnostic: ProjectHealthDiagnostic | CourseProjectHealthFinding) => {
    if (courseProject) {
      const route = resolveCourseProjectHealthRoute(
        courseProject,
        diagnostic as CourseProjectHealthFinding,
      )
      const store = useEditorStore.getState()
      if (route.locationId) store.activateCourseLocation(route.locationId)
      store.setEditingScope(route.scope)
      if (route.layerItemId) store.selectNode(route.layerItemId)
      if (route.tab === 'automation' || route.tab === 'components') {
        store.setEditorMode('professional')
      }
      store.setActiveTab(route.tab)
      store.setStatus(`已定位：${diagnostic.message}`)
      onClose()
      return
    }
    const legacyDiagnostic = diagnostic as ProjectHealthDiagnostic
    const route = resolveProjectHealthRoute(project, legacyDiagnostic)
    const store = useEditorStore.getState()
    store.setEditingScope(route.scope)
    if (route.sceneId) store.setActiveScene(route.sceneId)
    if (route.stateId !== undefined) store.setActivePresentationState(route.stateId)
    if (route.nodeId) store.selectNode(route.nodeId)
    if (route.tab === 'automation' || legacyDiagnostic.scope === 'component-package') {
      store.setEditorMode('professional')
    }
    store.setActiveTab(route.tab)
    store.setStatus(`已定位：${diagnostic.message}`)
    onClose()
  }

  return (
    <div className="modal-backdrop project-health-backdrop" role="presentation">
      <section
        className="project-health-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-health-title"
      >
        <header className="project-health-panel__header">
          <div>
            <h2 id="project-health-title">工程检查</h2>
            <p>集中检查丢失引用、无效跳转、组件包与静态兜底；不会修改工程。</p>
          </div>
          <button type="button" aria-label="关闭工程检查" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="project-health-summary" aria-label="工程检查摘要">
          <span className="is-error"><CircleAlert size={15} />{summary.error} 个错误</span>
          <span className="is-warning"><AlertTriangle size={15} />{summary.warning} 个提醒</span>
          <span className="is-info"><Info size={15} />{summary.info} 个建议</span>
        </div>

        {informationRelease && <details className="information-release-summary">
          <summary>
            信息释放（只读） · {informationRelease.summary.stateCount} 个状态，
            {informationRelease.summary.revealedCount} 个分步显示，
            {informationRelease.summary.hiddenWithoutRevealCount} 个未连通隐藏节点
          </summary>
          <p>按现有场景、状态和交互规则分析可能的显示路径；运行时、媒体和组件事件只按“可能发生”计算，不模拟真实授课。</p>
          <div className="information-release-grid" role="table" aria-label="信息释放状态概览">
            {informationRelease.states.map((state) => (
              <div className="information-release-row" role="row" key={`${state.sceneId}:${state.stateId}`}>
                <strong role="cell">{state.sceneName} / {state.stateName}</strong>
                <span role="cell">初始可见 {state.initialVisibleNodeIds.length}</span>
                <span role="cell">分步显示 {state.revealSteps.length}</span>
                <span role="cell" className={state.hiddenWithoutRevealNodeIds.length > 0 ? 'is-warning' : ''}>
                  未连通 {state.hiddenWithoutRevealNodeIds.length}
                </span>
              </div>
            ))}
          </div>
        </details>}

        {visualDensity && <details className="information-release-summary visual-density-summary">
          <summary>
            视觉密度（启发式） · 最高 {visualDensity.summary.maximumScore}/100，
            {visualDensity.summary.denseStateCount} 个高密度状态
          </summary>
          <p>分数只汇总对象数量、文字量、面积占用和明显重叠，不判断教学重点或视觉质量，也不会阻断导出。</p>
          <div className="information-release-grid" role="table" aria-label="视觉密度状态概览">
            {visualDensity.states.map((state) => (
              <div className="information-release-row visual-density-row" role="row" key={`${state.sceneId}:${state.stateId}`}>
                <strong role="cell">{state.sceneName} / {state.stateName}</strong>
                <span role="cell">对象 {state.visibleNodeCount}</span>
                <span role="cell">文字 {state.textCharacterCount}</span>
                <span role="cell" className={state.band === 'dense' ? 'is-warning' : ''}>
                  {state.score}/100 · {state.band === 'dense' ? '高' : state.band === 'balanced' ? '中' : '低'}
                </span>
              </div>
            ))}
          </div>
        </details>}

        <div className="project-health-panel__body">
          {diagnostics.length === 0 ? (
            <div className="project-health-empty">
              <CheckCircle2 size={34} />
              <strong>未发现工程问题</strong>
              <span>当前引用关系和交付配置完整。</span>
            </div>
          ) : (
            <ol className="project-health-list">
              {diagnostics.map((diagnostic, index) => (
                <li
                  key={`${diagnostic.code}:${diagnostic.path.join('.')}:${index}`}
                  className={`project-health-issue is-${diagnostic.severity}`}
                >
                  <SeverityIcon severity={diagnostic.severity} />
                  <span className="project-health-issue__content">
                    <strong>{severityLabel[diagnostic.severity]}</strong>
                    <span>{diagnostic.message}</span>
                    <small>{diagnostic.code}</small>
                  </span>
                  <button type="button" onClick={() => locate(diagnostic)}>
                    <LocateFixed size={14} />定位
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>

        <footer className="project-health-panel__footer">
          <span>{summary.canExport ? '没有阻断导出的错误。' : '请先处理错误，再导出成品。'}</span>
          <div className="project-health-panel__footer-actions">
            {onExportDiagnostics && (
              <button type="button" className="secondary-button" onClick={onExportDiagnostics}>
                导出诊断报告
              </button>
            )}
            <button type="button" className="secondary-button" onClick={onClose}>关闭</button>
          </div>
        </footer>
      </section>
    </div>
  )
}
