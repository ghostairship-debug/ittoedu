import {
  ArrowLeft,
  Box,
  ChevronDown,
  Eye,
  FilePlus2,
  FileUp,
  FolderOpen,
  FileText,
  Pencil,
  Redo2,
  History,
  Save,
  SaveAll,
  ShieldCheck,
  Undo2,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useDismissableDetails } from './useDismissableDetails'
import { ExportMenu, type ExportFormat } from './ExportMenu'
import type { RecentProjectEntry } from '../../shared/ipcTypes'
import type { CourseProjectHealthSummary } from '../../shared/courseProjectHealth'
import { APP_NAME } from '../../shared/constants'
import { useCourseEditorChrome } from '../documents/CourseEditorChromeContext'
import type { SingleHtmlExportMode } from '../export/course/coursePackagePreflight'
import {
  selectActiveCourseProjectDocument,
  selectActiveSceneId,
  selectCanRedoActiveSurface,
  selectCanUndoActiveSurface,
  selectHasUnsavedCourseChanges,
  useEditorStore,
} from '../store/editorStore'

interface TopToolbarProps {
  busy: boolean
  onNew(): void
  onNewSpatial?(): void
  onNewFlow?(): void
  onOpen(): void
  recentProjects: RecentProjectEntry[]
  onOpenRecent(path: string): void
  onSave(saveAs?: boolean): void
  healthSummary: CourseProjectHealthSummary | null
  onOpenHealth(): void
  onOpenRecipes?(): void
  onOpenProductivity?(): void
  onImportPptx?(): void
  onOpenMaterials?(): void
  onPreview(): void
  onExport(format: ExportFormat, singleHtmlMode?: SingleHtmlExportMode): void
}

export type { ExportFormat } from './ExportMenu'

interface ToolButtonProps {
  label: string
  title: string
  disabled?: boolean
  accent?: boolean
  onClick(): void
  children: React.ReactNode
}

function ToolButton({
  label,
  title,
  disabled,
  accent,
  onClick,
  children,
}: ToolButtonProps) {
  return (
    <button
      type="button"
      className={`tool-button${accent ? ' tool-button--accent' : ''}`}
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
      <span>{label}</span>
    </button>
  )
}

export function TopToolbar({
  busy,
  onNew,
  onNewSpatial,
  onNewFlow,
  onOpen,
  recentProjects,
  onOpenRecent,
  onSave,
  healthSummary,
  onOpenHealth,
  onOpenRecipes,
  onOpenProductivity,
  onImportPptx,
  onOpenMaterials,
  onPreview,
  onExport,
}: TopToolbarProps) {
  const editorChrome = useCourseEditorChrome()
  // The toolbar's drop-down menus close on a click elsewhere or Escape, like the workbench menus.
  const newMenuRef = useRef<HTMLDetailsElement>(null), recentMenuRef = useRef<HTMLDetailsElement>(null)
  const moreMenuRef = useRef<HTMLDetailsElement>(null)
  useDismissableDetails(newMenuRef)
  useDismissableDetails(recentMenuRef)
  useDismissableDetails(moreMenuRef)
  const dirty = useEditorStore(selectHasUnsavedCourseChanges)
  const canUndo = useEditorStore(selectCanUndoActiveSurface)
  const canRedo = useEditorStore(selectCanRedoActiveSurface)
  const activeSceneId = useEditorStore(selectActiveSceneId)
  const undo = useEditorStore((state) => state.undo)
  const redo = useEditorStore((state) => state.redo)
  const renameProject = useEditorStore((state) => state.renameProject)
  const courseDocument = useEditorStore(selectActiveCourseProjectDocument)
  const surfaces = courseDocument?.surfaces ?? []
  const projectTitle = courseDocument?.title ?? ''
  const hasFlowSurface = Boolean(courseDocument?.surfaces.some((surface) => surface.kind === 'flow'))
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(projectTitle)
  useEffect(() => setTitleDraft(projectTitle), [projectTitle])
  const commitTitle = () => {
    const normalized = titleDraft.trim()
    if (normalized) renameProject(normalized)
    else setTitleDraft(projectTitle)
    setEditingTitle(false)
  }
  const sceneIndex = surfaces.findIndex(
    (surface) => surface.id === activeSceneId,
  )

  return (
    <header className="toolbar" data-testid="top-toolbar">
      {editorChrome.workbench && editorChrome.mode === 'deep'
        ? <button type="button" className="toolbar__return-workbench" onClick={() => editorChrome.setMode('light')}>
            <ArrowLeft size={16} aria-hidden="true" />返回工作台
          </button>
        : <div className="toolbar__brand" title={APP_NAME}>
            <span className="toolbar__brand-mark"><Box size={18} strokeWidth={2.2} /></span>
            <span>{APP_NAME}</span>
          </div>}

      <div className="toolbar__group">
        <div className="new-project-split">
          <ToolButton label="新建" title="新建 H5 演示（Ctrl+N）" disabled={busy} onClick={onNew}>
            <FilePlus2 size={18} />
          </ToolButton>
          {onNewSpatial || onNewFlow ? (
            <details ref={newMenuRef} className="new-project-menu">
              <summary className="tool-button" title="更多新建选项" aria-label="更多新建选项">
                <ChevronDown size={14} />
              </summary>
              <div className="new-project-menu__list" role="menu">
                {onNewSpatial ? (
                  <button
                    type="button"
                    role="menuitem"
                    data-testid="new-spatial-project"
                    disabled={busy}
                    onClick={(event) => {
                      event.currentTarget.closest('details')?.removeAttribute('open')
                      onNewSpatial()
                    }}
                  >
                    空白无限画布
                  </button>
                ) : null}
                {onNewFlow ? (
                  <button
                    type="button"
                    role="menuitem"
                    data-testid="new-flow-project"
                    disabled={busy}
                    onClick={(event) => {
                      event.currentTarget.closest('details')?.removeAttribute('open')
                      onNewFlow()
                    }}
                  >
                    空白流式讲义
                  </button>
                ) : null}
              </div>
            </details>
          ) : null}
        </div>
        <ToolButton label="打开" title="打开工程（Ctrl+O）" disabled={busy} onClick={onOpen}>
          <FolderOpen size={18} />
        </ToolButton>
        {onImportPptx && <ToolButton label="导入 PPT" title="导入 PPT（.pptx）" disabled={busy} onClick={onImportPptx}>
          <FileUp size={18} />
        </ToolButton>}
        <details ref={recentMenuRef} className="recent-projects">
          <summary className="tool-button" title="打开最近工程">
            <History size={18} />
            <span>最近</span>
          </summary>
          <div className="recent-projects__menu">
            <div className="recent-projects__title">最近工程</div>
            {recentProjects.length === 0 ? (
              <div className="recent-projects__empty">还没有最近工程</div>
            ) : recentProjects.map((project) => (
              <button
                type="button"
                key={project.path}
                className="recent-projects__item"
                title={project.path}
                onClick={(event) => {
                  event.currentTarget.closest('details')?.removeAttribute('open')
                  onOpenRecent(project.path)
                }}
              >
                <span>{project.name}</span>
                <small>{project.path}</small>
              </button>
            ))}
          </div>
        </details>
        <ToolButton label="保存" title="保存（Ctrl+S）" disabled={busy} onClick={() => onSave(false)}>
          <Save size={18} />
        </ToolButton>
        <ToolButton label="另存为" title="另存为" disabled={busy} onClick={() => onSave(true)}>
          <SaveAll size={18} />
        </ToolButton>
      </div>

      <div className="toolbar__separator" />

      <div className="toolbar__group">
        <ToolButton
          label="撤销"
          title="撤销（Ctrl+Z）"
          disabled={busy || !canUndo}
          onClick={undo}
        >
          <Undo2 size={18} />
        </ToolButton>
        <ToolButton
          label="重做"
          title="重做（Ctrl+Y / Ctrl+Shift+Z）"
          disabled={busy || !canRedo}
          onClick={redo}
        >
          <Redo2 size={18} />
        </ToolButton>
      </div>

      <div className="toolbar__separator" />

      {(onOpenRecipes || onOpenProductivity || onOpenMaterials) && <details ref={moreMenuRef} className="toolbar-more-menu">
        <summary className="tool-button" aria-label="创作工具"><FileText size={18} /><span>创作工具</span></summary>
        <div className="toolbar-more-menu__panel" role="menu" aria-label="创作工具菜单">
          <button type="button" role="menuitem" disabled={busy} onClick={event => {
            event.currentTarget.closest('details')?.removeAttribute('open'); onOpenMaterials?.()
          }}><span><strong>教学材料库</strong><small>导入、搜索和管理当前工程的本地材料</small></span></button>
          <button type="button" role="menuitem" disabled={busy} onClick={event => {
            event.currentTarget.closest('details')?.removeAttribute('open'); onOpenRecipes?.()
          }}><span><strong>新建配方页</strong><small>封面、概念、例题和互动模板</small></span></button>
          <button type="button" role="menuitem" disabled={busy} onClick={event => {
            event.currentTarget.closest('details')?.removeAttribute('open'); onOpenProductivity?.()
          }}><span><strong>批量编辑与参考页</strong><small>查找替换、项目配色、样板改写</small></span></button>
        </div>
      </details>}

      <div className="toolbar__spacer" />

      <div className="toolbar__project">
        {editingTitle ? (
          <input
            className="toolbar__project-name-input"
            aria-label="名称"
            value={titleDraft}
            maxLength={80}
            autoFocus
            onChange={(event) => setTitleDraft(event.currentTarget.value)}
            onBlur={commitTitle}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
              if (event.key === 'Escape') {
                setTitleDraft(projectTitle)
                setEditingTitle(false)
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="toolbar__project-name"
            title="重命名"
            aria-label="重命名"
            onClick={() => setEditingTitle(true)}
          >
            <span>{projectTitle}{dirty ? ' *' : ''}</span>
            <Pencil size={11} aria-hidden="true" />
          </button>
        )}
        <span className="toolbar__scene-index">
          场景 {sceneIndex + 1} / {surfaces.length}
        </span>
      </div>

      <ToolButton
        label="工程检查"
        title={!healthSummary ? '打开工程检查' : healthSummary.total === 0
          ? '工程检查：未发现问题'
          : `工程检查：${healthSummary.error} 个错误，${healthSummary.warning} 个提醒`}
        disabled={busy}
        onClick={onOpenHealth}
      >
        <span className="tool-button__badge-anchor">
          <ShieldCheck size={18} />
          {healthSummary && healthSummary.total > 0 && (
            <small className={healthSummary.error > 0 ? 'is-error' : 'is-warning'}>
              {healthSummary.total > 99 ? '99+' : healthSummary.total}
            </small>
          )}
        </span>
      </ToolButton>

      <ToolButton
        label="整课预览"
        title="整课预览"
        disabled={busy}
        accent
        onClick={onPreview}
      >
        <Eye size={18} />
      </ToolButton>
      <ExportMenu busy={busy} hasFlowSurface={hasFlowSurface} onExport={onExport} />
    </header>
  )
}
