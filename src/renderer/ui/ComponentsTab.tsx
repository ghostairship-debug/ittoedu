import { Box, Check, ChevronLeft, Download, Info, Library, LocateFixed, MoreVertical, RefreshCw, Search, ShieldAlert, Trash2, Upload, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AvailableComponentCatalogPackage, AvailableHtmlComponent, ComponentCatalogSnapshot } from '../../shared/componentCatalog'
import { componentDefinitionBuiltinKey, componentSurface, componentSurfaces, type ComponentDefinition, type CourseProjectV10 } from '../../shared/contracts/component-platform/project'
import type { FlowDeepInsertPort } from './RightSidebar'
import { collectCourseComponentPackageUsage, type CourseComponentPackageUsage } from '../components/courseComponentPackageTransactions'
import { filterHtmlComponents, selectCurrentCatalogPackages, selectCurrentHtmlComponents, componentCatalogInstallStatus, selectProjectLibraryDefinitions,projectLibraryDefinition, createComponentLibraryCards, filterComponentLibraryCards, componentLibraryCardAvailability, componentLibraryPlacementLabel, type ComponentLibraryCardEntry } from '../components/componentLibraryModel'
import { componentDefinitionEntry, prepareComponentDefinitionEntryAtTarget, insertComponentPackagesAtTarget, type ComponentLibraryAddOptions, type ComponentPackageInsertionOptions } from '../components/insertComponentPackages'
import { settleCourseComponentInput, type CapturedCourseTarget } from '../documents/CourseV10DocumentBridge'
import { createComponentAuthoringActions } from '../components/commitComponentPackageAuthoring'
import { extractComponentLibraryEntry } from '../../core/components/library'
import { exportComponentLibraryArchive } from '../../core/components/library/archive'
import { COMPONENT_LIBRARY_CATEGORIES, createProjectDefinitionDiscoveryEntries, searchDiscoveryEntries } from '../../shared/componentDiscovery'
import { courseInsertionViewPlacement } from '../media/commitCourseMediaAuthoring'
import { selectActiveCourseProjectDocument, selectEditingScope, useEditorStore } from '../store/editorStore'
interface ComponentsTabProps {
  onFlowInsert?: FlowDeepInsertPort
  componentCatalog?: ComponentCatalogSnapshot
  onImportExternalComponents?(): void
  onRefreshComponentCatalog?(): void
  onAddCatalogComponents?(entries: AvailableComponentCatalogPackage[], options?: ComponentLibraryAddOptions): boolean | Promise<boolean>
  onUpdateCatalogComponent?(entry: AvailableComponentCatalogPackage): void
  onReplaceComponent?(definitionId: string): void
  onExtractSelection?(title: string, kind?: 'objects' | 'page' | 'structure', surfaceIds?: readonly string[]): Promise<void>
  onDeleteCatalogComponent?(entry: AvailableComponentCatalogPackage): Promise<void>
}
const EMPTY_CATALOG: ComponentCatalogSnapshot = { sources: [], packages: [], issues: [] }
const installStatusLabels = { available: '可加入工程', embedded: '已加入工程', 'update-available': '有新版本', 'embedded-newer': '工程版本更新' }
function CatalogThumbnail({entry}: {entry: AvailableComponentCatalogPackage}) { return entry.thumbnailDataUrl ? <img src={entry.thumbnailDataUrl} alt="" /> : <Box size={20} /> }
function closeContainingMenu(target: HTMLElement) { target.closest('details')?.removeAttribute('open') }
function ComponentDetailsDialog({data,entry,usage,onClose}: {data?: ComponentDefinition;entry?: AvailableComponentCatalogPackage;usage?: CourseComponentPackageUsage;onClose():void}) {
  useEffect(() => { const close=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose()};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close) },[onClose])
  return <div className="modal-backdrop" data-testid="component-details-dialog"><section className="modal component-details-dialog" role="dialog" aria-modal="true" aria-labelledby="component-details-title">
    <div className="component-details-dialog__header"><div><span>组件详情</span><h2 id="component-details-title">{data?.title ?? entry?.name ?? data?.id}</h2></div><button type="button" className="icon-button" aria-label="关闭组件详情" onClick={onClose}><X size={17}/></button></div>
    <dl className="component-details-dialog__list"><div><dt>组件 ID</dt><dd>{data?.id ?? entry?.packageId}</dd></div><div><dt>版本</dt><dd>{data?.library?.version ?? data?.version ?? entry?.version ?? '未标版本'}</dd></div><div><dt>来源</dt><dd>{entry?.sourceLabel ?? (data?.implementation.kind==='builtin'?'内置实现':'工程源码')}</dd></div>{usage&&<div><dt>工程实例</dt><dd>页面 {usage.sceneInstanceCount} · 全局 {usage.globalInstanceCount}</dd></div>}</dl>
    {entry?.description&&<p className="component-details-dialog__description">{entry.description}</p>}<div className="modal__actions"><button type="button" className="primary-button" onClick={onClose}>完成</button></div>
  </section></div>
}
/** Legacy HTML assets remain available for listing and deletion; AI reuse uses API5 packages. */
function HtmlComponentLibrarySection({ entries, onRefresh }: { entries: AvailableHtmlComponent[]; onRefresh?(): void }) {
  const [confirming, setConfirming] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const remove = async (entry: AvailableHtmlComponent) => {
    setDeleting(true)
    setError(null)
    try {
      const remove = window.desktopAPI?.deleteComponentCatalogHtmlComponent
      if (!remove) throw new Error('当前页面未运行在桌面环境中，不能删除资产库条目。')
      await remove({ sourceId: entry.sourceId, entry: entry.entry })
      setConfirming(null)
      onRefresh?.()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'HTML 组件删除失败。')
    } finally {
      setDeleting(false)
    }
  }
  return (
    <section className="component-library__html-components" aria-label="HTML 组件">
      <div className="component-library__results-heading">
        <div><strong>HTML 组件</strong><span>{entries.length} 个结果</span></div>
      </div>
      <p className="component-library__html-note">这里保留旧 HTML 资产，可查看条目信息，并删除“我的资产库”中的条目；检索会说明限制，这些条目当前尚无插入入口。</p>
      {error && <div className="component-library__issues" role="alert"><ShieldAlert size={16} /><span>{error}</span></div>}
      <div className="component-library__grid">
        {entries.map((entry) => {
          const key = `${entry.sourceId}:${entry.entry}`
          return (
            <article key={key} className="component-library-card" data-testid={`html-component-${entry.packageId}`}>
              <div className="component-library-card__copy">
                <div className="component-library-card__title">
                  <strong>{entry.name}</strong>
                  <span className="component-quality">HTML 组件</span>
                </div>
                {entry.description && <p>{entry.description}</p>}
                <div className="component-library-card__metadata">
                  <span>v{entry.version}</span>
                  <span>{entry.sourceLabel}</span>
                  {entry.sourceCourse && <span>来自 {entry.sourceCourse}</span>}
                  {entry.savedAt && <span>{new Date(entry.savedAt).toLocaleDateString('zh-CN')}</span>}
                </div>
              </div>
              {entry.removable && (
                <div className="component-library-card__actions">
                  <button type="button" className="secondary-button" disabled={deleting}
                    onClick={() => confirming === key ? void remove(entry) : setConfirming(key)}>
                    <Trash2 size={13} />{confirming === key ? '确认删除' : '删除'}
                  </button>
                </div>
              )}
            </article>
          )
        })}
      </div>
    </section>
  )
}

const libraryTypeLabels = { component: '组件', container: '容器', 'example-page': '示例页面', template: '组合模板', transition: '转场' }
const libraryEditableLabels = { parameters: '参数', structure: '内部内容与结构', source: '源码' }
const librarySubjectLabel = (entry: ComponentLibraryCardEntry) => entry.library?.subjects.length ? entry.library.subjects.join(' / ') : entry.sourceId === 'built-in' ? '通用' : '学科未标注'
const libraryStageLabel = (entry: ComponentLibraryCardEntry) => entry.library?.schoolStages.length ? entry.library.schoolStages.join(' / ') : entry.sourceId === 'built-in' ? '不限学段' : '学段未标注'

interface ComponentLibraryDialogProps {
  catalog: ComponentCatalogSnapshot
  components: Record<string, ComponentDefinition>
  project?: CourseProjectV10 | null
  navigationTargetId?: string | null
  onClose(): void
  onRefresh?(): void
  onAdd?(entries: AvailableComponentCatalogPackage[], options?: ComponentLibraryAddOptions): boolean | Promise<boolean>
  onUpdate?(entry: AvailableComponentCatalogPackage): void
  onDelete?(entry: AvailableComponentCatalogPackage): void | Promise<void>
}

export function ComponentLibraryDialog({ catalog, components, project, navigationTargetId, onClose, onRefresh, onAdd, onUpdate, onDelete }: ComponentLibraryDialogProps) {
  const cards = useMemo(() => createComponentLibraryCards(catalog.packages), [catalog.packages])
  const [query, setQuery] = useState(''), [category, setCategory] = useState(''), [source, setSource] = useState('')
  const [subject, setSubject] = useState(''), [schoolStage, setSchoolStage] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState(false), [addError, setAddError] = useState<string | null>(null)
  const [details, setDetails] = useState<ComponentLibraryCardEntry | null>(null)
  const [placement, setPlacement] = useState<'default' | 'local'>('default')
  const addAttempt = useRef<{ choices: string; id: string } | null>(null)
  const filters = { query, category, source, subject, schoolStage }
  const visible = filterComponentLibraryCards(cards, filters)
  const selected = cards.filter(entry => selectedIds.has(entry.selectionId))
  const sources = [...new Map(cards.map(entry => [entry.sourceId, entry.sourceLabel])).entries()]
  const subjects = [...new Set(cards.flatMap(entry => entry.library?.subjects ?? []))].filter(value => !['通用', '通用组件'].includes(value))
  const stages = [...new Set(cards.flatMap(entry => entry.library?.schoolStages ?? []))].filter(value => !['通用', '不限', '不限学段'].includes(value))
  const available = (entry: ComponentLibraryCardEntry) => componentLibraryCardAvailability(entry, project, navigationTargetId)
  const bulkIds = visible.filter(entry => entry.usage?.kind !== 'transition' && available(entry).available).map(entry => entry.selectionId)
  const allVisibleSelected = bulkIds.length > 0 && bulkIds.every(id => selectedIds.has(id))
  const selectedTransitionIds = new Set(cards.filter(entry => entry.usage?.kind === 'transition').map(entry => entry.selectionId))
  const hasPages = selected.some(entry => entry.workAsset?.kind === 'page' || entry.workAsset?.kind === 'structure')
  const selectedTeacher = selected.some(entry => entry.teacherController)
  const existingTeacher = Object.values(project?.instances ?? {}).some(instance => componentDefinitionBuiltinKey(components[instance.definitionId]) === 'guoling.navigation')
  const selectedUnavailable = selected.find(entry => !available(entry).available)
  const htmlComponents = useMemo(() => selectCurrentHtmlComponents(catalog.htmlComponents ?? []), [catalog.htmlComponents])
  const visibleHtml = filterHtmlComponents(htmlComponents, query)
  const localCount = selected.filter(entry => !entry.teacherController && entry.usage?.kind !== 'transition' && entry.usage?.kind !== 'background'
    && (!['page', 'structure'].includes(entry.workAsset?.kind ?? '') || placement === 'local')).length
  const description = [
    localCount ? `当前容器新增 ${localCount} 项` : '',
    hasPages && placement === 'default' ? `新增页面 ${selected.filter(entry => entry.workAsset?.kind === 'page' || entry.workAsset?.kind === 'structure').length} 项` : '',
    selected.some(entry => entry.usage?.kind === 'background') ? '添加到当前作用范围的背景层' : '',
    selectedTeacher ? existingTeacher ? '复用教师控制台' : '整课全局层添加教师控制台' : '',
    selected.some(entry => entry.usage?.kind === 'transition') ? '转场应用到所选导航动作' : '',
  ].filter(Boolean).join(' · ')

  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && !adding) { if (details) setDetails(null); else onClose() } }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [adding, details, onClose])
  const toggle = (entry: ComponentLibraryCardEntry) => setSelectedIds(current => {
    const next = new Set(current)
    if (next.has(entry.selectionId)) next.delete(entry.selectionId)
    else {
      if (entry.usage?.kind === 'transition') selectedTransitionIds.forEach(id => next.delete(id))
      next.add(entry.selectionId)
    }
    return next
  })
  const toggleAll = () => setSelectedIds(current => {
    const next = new Set(current)
    bulkIds.forEach(id => { if (allVisibleSelected) next.delete(id); else next.add(id) })
    return next
  })
  const add = async () => {
    if (!onAdd || adding || !selected.length || selectedUnavailable) return
    const choices = JSON.stringify([project?.id, [...selectedIds].sort(), placement])
    if (addAttempt.current?.choices !== choices) addAttempt.current = { choices, id: crypto.randomUUID() }
    setAdding(true); setAddError(null)
    const entries = selected.flatMap(entry => entry.catalogEntry ? [entry.catalogEntry] : [])
    const builtInAssetIds = selected.flatMap(entry => entry.workAsset ? [entry.workAsset.id] : [])
    const options: ComponentLibraryAddOptions = {
      ...(builtInAssetIds.length ? { builtInAssetIds } : {}),
      ...(selectedTeacher ? { includeTeacherController: true } : {}),
      ...(hasPages && placement === 'local' ? { placement: 'local' as const } : {}),
    }
    try {
      const completed = await onAdd(entries, { ...options, attemptId: addAttempt.current.id })
      if (!completed) { setAddError('添加未完成，选择已保留，请重试。'); return }
      setSelectedIds(new Set()); onClose()
    } catch (error) { setAddError(error instanceof Error ? error.message : String(error)) }
    finally { setAdding(false) }
  }

  return <div className="component-library" data-testid="component-library" role="dialog" aria-modal="true" aria-labelledby="component-library-title">
    <header className="component-library__header">
      <button type="button" className="secondary-button" disabled={adding} onClick={onClose}><ChevronLeft size={16} />返回编辑器</button>
      <div><h2 id="component-library-title">组件与资产库</h2><p>按用途查找，跨分类勾选，再从底部添加所选内容。</p></div>
      <button type="button" className="secondary-button" disabled={!onRefresh || adding} onClick={onRefresh}><RefreshCw size={14} />刷新</button>
    </header>
    <div className="component-library__tools">
      <label className="component-library__search"><Search size={16} aria-hidden="true" /><input type="search" aria-label="搜索组件" placeholder="搜索名称、用途或标签" value={query} onChange={event => setQuery(event.currentTarget.value)} /></label>
      <select aria-label="筛选来源" value={source} onChange={event => setSource(event.currentTarget.value)}><option value="">全部来源</option>{sources.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
      <select aria-label="筛选学科" value={subject} onChange={event => setSubject(event.currentTarget.value)}><option value="">全部学科</option>{subjects.map(value => <option key={value} value={value}>{value}</option>)}</select>
      <select aria-label="筛选学段" value={schoolStage} onChange={event => setSchoolStage(event.currentTarget.value)}><option value="">全部学段</option>{stages.map(value => <option key={value} value={value}>{value}</option>)}</select>
    </div>
    <div className="component-library__body">
      <nav className="component-library__subjects" aria-label="组件用途分类">
        <button type="button" aria-pressed={!category} className={!category ? 'is-active' : ''} onClick={() => setCategory('')}><span>全部组件与资产</span><small>{filterComponentLibraryCards(cards, { ...filters, category: '' }).length}</small></button>
        {COMPONENT_LIBRARY_CATEGORIES.map(value => <button type="button" key={value.id} aria-pressed={category === value.id} className={category === value.id ? 'is-active' : ''} onClick={() => setCategory(value.id)}><span>{value.label}</span><small>{filterComponentLibraryCards(cards, { ...filters, category: value.id }).length}</small></button>)}
      </nav>
      <main className="component-library__results">
        <div className="component-library__results-heading component-library__selection-tools"><div><strong>{COMPONENT_LIBRARY_CATEGORIES.find(value => value.id === category)?.label ?? '全部组件与资产'}</strong><span>{visible.length} 个结果 · 通用与未标注内容保留显示</span></div><button type="button" className="secondary-button" disabled={!bulkIds.length || adding} onClick={toggleAll}><Check size={13} />{allVisibleSelected ? '取消全选普通条目' : '全选普通条目'}</button></div>
        {catalog.issues.length > 0 && <div className="component-library__issues" role="status"><ShieldAlert size={16} /><span>{catalog.issues.map(issue => issue.message).join('；')}</span></div>}
        {visible.length === 0 ? <div className="empty-state component-library__empty">没有符合筛选条件的组件或资产。</div> : <div className="component-library__grid">{visible.map(entry => {
          const availability = available(entry), isSelected = selectedIds.has(entry.selectionId)
          const catalogEntry = entry.catalogEntry
          const status = catalogEntry ? componentCatalogInstallStatus(catalogEntry, projectLibraryDefinition(components, catalogEntry.packageId)) : undefined
          return <article key={entry.selectionId} className={`component-library-card${isSelected ? ' is-selected' : ''}${!availability.available ? ' is-unavailable' : ''}`} data-testid={catalogEntry ? `catalog-component-${entry.id}` : entry.teacherController ? 'library-teacher-controller' : `work-asset-${entry.id}`}>
            <label className={`component-library-card__select${!availability.available ? ' is-disabled' : ''}`}>
              <input type="checkbox" checked={isSelected} disabled={adding || !availability.available && !isSelected} aria-label={`选择${entry.title}`} onChange={() => toggle(entry)} />
              <span className="component-library-card__thumbnail">{catalogEntry ? <CatalogThumbnail entry={catalogEntry} /> : <Box size={24} />}</span>
              <div className="component-library-card__copy"><div className="component-library-card__title"><strong>{entry.title}</strong></div><div className="component-library-card__metadata"><span>{libraryTypeLabels[entry.library?.itemType ?? 'component']}</span><span>{entry.sourceLabel}</span><span>{librarySubjectLabel(entry)}</span></div><p>{entry.description}</p><div className="component-library-card__placement">{componentLibraryPlacementLabel(entry, placement === 'local')}</div><div className="component-library-card__metadata">{entry.library?.editable.map(value => <span key={value}>可改{libraryEditableLabels[value]}</span>)}</div>
                {status && <div className="component-library-card__status"><span>{installStatusLabels[status]}</span></div>}
                {entry.teacherController && existingTeacher && <div className="component-library-card__status"><span>已添加到工程 · 保留现有样式并复用</span></div>}
                {!availability.available && <p className="component-library-card__unavailable">{availability.reason}</p>}
              </div>
            </label>
            <div className="component-library-card__actions"><button type="button" className="secondary-button" onClick={() => setDetails(entry)}><Info size={13} />详情</button>
              {catalogEntry?.removable && onDelete && <button type="button" className="secondary-button" disabled={adding} onClick={() => void onDelete(catalogEntry)}><Trash2 size={13} />删除库条目</button>}
              {catalogEntry && status === 'update-available' && <button type="button" className="secondary-button" disabled={!onUpdate || adding} onClick={() => onUpdate?.(catalogEntry)}><RefreshCw size={13} />审阅更新</button>}
            </div>
          </article>
        })}</div>}
        {visibleHtml.length > 0 && !category && !source && !subject && !schoolStage && <HtmlComponentLibrarySection entries={visibleHtml} onRefresh={onRefresh} />}
      </main>
    </div>
    <footer className="component-library__footer">
      {addError && <div className="component-library__issues" role="alert">{addError}</div>}
      {selectedUnavailable && <div className="component-library__issues" role="status">{available(selectedUnavailable).reason}</div>}
      <div className="component-library__selection-summary"><span role="status">已选择 {selected.length} 项</span>{description && <small>{description}</small>}</div>
      {selected.length > 0 && <button type="button" className="secondary-button" disabled={adding} onClick={() => setSelectedIds(new Set())}>清空选择</button>}
      {hasPages && <label className="component-library__placement">页面与模板位置<select aria-label="容器与模板添加位置" value={placement} disabled={adding} onChange={event => setPlacement(event.currentTarget.value as 'default' | 'local')}><option value="default">添加为独立页面</option><option value="local">放入当前容器</option></select></label>}
      <button type="button" className="primary-button" disabled={!selected.length || !onAdd || adding || Boolean(selectedUnavailable)} onClick={() => void add()}>{adding ? '正在添加…' : `添加所选${selected.length ? `（${selected.length}）` : ''}`}</button>
    </footer>
    {details && <div className="modal-backdrop" data-testid="component-details-dialog"><section className="modal component-details-dialog" role="dialog" aria-modal="true" aria-labelledby="component-details-title"><div className="component-details-dialog__header"><div><span>{libraryTypeLabels[details.library?.itemType ?? 'component']}</span><h2 id="component-details-title">{details.title}</h2></div><button type="button" className="icon-button" aria-label="关闭组件详情" onClick={() => setDetails(null)}><X size={17} /></button></div><p className="component-details-dialog__description">{details.description}</p><dl className="component-details-dialog__list"><div><dt>来源</dt><dd>{details.sourceLabel}</dd></div><div><dt>身份</dt><dd>{details.id}</dd></div><div><dt>学科</dt><dd>{librarySubjectLabel(details)}</dd></div><div><dt>学段</dt><dd>{libraryStageLabel(details)}</dd></div><div><dt>版本</dt><dd>{details.library?.version ?? '随软件提供'}</dd></div><div><dt>添加位置</dt><dd>{componentLibraryPlacementLabel(details, placement === 'local')}</dd></div><div><dt>可编辑内容</dt><dd>{details.library?.editable.map(value => libraryEditableLabels[value]).join('、') || '使用现有编辑功能'}</dd></div></dl><div className="modal__actions"><button type="button" className="primary-button" onClick={() => setDetails(null)}>完成</button></div></section></div>}
  </div>
}

export function ComponentsTab({componentCatalog=EMPTY_CATALOG,onFlowInsert,onImportExternalComponents,onRefreshComponentCatalog,onAddCatalogComponents,onUpdateCatalogComponent,onReplaceComponent,onExtractSelection,onDeleteCatalogComponent}:ComponentsTabProps) {
  const project=useEditorStore(selectActiveCourseProjectDocument), kernel=useEditorStore(state=>state.courseKernel), view=useEditorStore(state=>state.courseView)
  const [libraryOpen,setLibraryOpen]=useState(false), [searchQuery,setSearchQuery]=useState(''),[detailsId,setDetailsId]=useState<string|null>(null),[extractName,setExtractName]=useState(''),[extracting,setExtracting]=useState(false)
  const [extractKind, setExtractKind] = useState<'objects' | 'page' | 'structure'>('objects')
  const [extractPages, setExtractPages] = useState<string[] | null>(null)
  const [copySources, setCopySources] = useState<Record<string, string>>({})
  const [pendingInsert, setPendingInsert] = useState<{ key: string; id: string; target: CapturedCourseTarget;
    entry: import('../../shared/contracts/component-platform/library').ComponentLibraryEntry;
    options: ComponentPackageInsertionOptions; error: unknown } | null>(null)
  const inserting = useRef(false)
  const selectedTemplatePages = extractPages ?? (view.surfaceId ? [view.surfaceId] : [])
  const components=project?.definitions ?? {}, packages=selectProjectLibraryDefinitions(components)
  const current=selectCurrentCatalogPackages(componentCatalog.packages)
  const facts = project ? createProjectDefinitionDiscoveryEntries(project, { definitionIds: packages.map(value => value.id), instanceIds: Object.keys(project.instances) }, current) : []
  const visible=searchDiscoveryEntries(facts.map(fact => ({ ...fact, definition: components[fact.id] })), searchQuery)
  const report=(error:unknown)=>kernel.setFeedback({errorMessage:error instanceof Error?error.message:String(error)})
  const sourceKey=(id:string)=>`${view.activeDocumentId}:${id}`
  const sourceId=(id:string)=>{const sources=facts.find(value=>value.id===id)?.sources??[],chosen=copySources[sourceKey(id)];return sources.some(value=>value.instanceId===chosen)?chosen:sources.length===1?sources[0].instanceId:undefined}
  const insert=async(id:string,destination:'document'|'paper'='document',copy=false)=>{
    if (inserting.current) return
    inserting.current = true
    try {
    const target=kernel.captureTarget(),state=useEditorStore.getState()
    const camera=(target.surfaceId ? componentSurface(target.project,target.surfaceId) : undefined)?.kind==='spatial'&&selectEditingScope(state)!=='global'
      ? state.readSpatialView(target.surfaceId??'',target.documentId).camera:null
    const fact=facts.find(value=>value.id===id)
    const catalogEntry=fact?.source.kind==='catalog'?current.find(value=>value.packageId===fact.action.input?.packageId&&value.sourceId===fact.action.input?.sourceId&&value.version===fact.action.input?.version):undefined
    if (onFlowInsert && selectEditingScope(state) !== 'global' && (target.surfaceId ? componentSurface(target.project,target.surfaceId) : undefined)?.kind === 'flow') {
      onFlowInsert({ destination, kind: 'component', label: '组件' }, { packageId: id,
        ...(copy || fact?.action.kind === 'copy' ? { sourceInstanceId: sourceId(id) } : { catalogEntry }) })
      return
    }
    const options={...courseInsertionViewPlacement(target, { scope: selectEditingScope(state), plane: state.courseView.editingPlane, camera }),destination,
      ...(copy||fact?.action.kind==='copy'?{sourceInstanceId:sourceId(id)}:{catalogEntry})}
    const key = JSON.stringify([target.documentId, target.epoch, target.rootInstanceId, target.surfaceId, target.activeStateId, target.editingContainerId, target.activation, state.courseView.editingPlane,
      target.selectionIdentity, target.instanceIds, id, destination, copy, options])
    let attempt = pendingInsert?.key === key ? pendingInsert : null
    if (pendingInsert) {
      const outcome = await settleCourseComponentInput(pendingInsert.error)
      if (outcome === 'pending') { report('上一次添加结果仍在核实，已准备内容保留；这次尚未添加。'); return }
      if (outcome === 'applied') {
        setPendingInsert(current => current === pendingInsert ? null : current)
        if (attempt) { kernel.setFeedback({ statusMessage: '上一次组件添加已经完成', errorMessage: null }); return }
      }
      else if (attempt) attempt = { ...attempt, target, options }
    }
    attempt ??= { key, id, target, entry: await prepareComponentDefinitionEntryAtTarget(kernel, target, id, options), options, error: null }
    const result = await insertComponentPackagesAtTarget(kernel, attempt.target, [attempt.entry], attempt.options)
    if (!result.ok) {
      if (result.inputFailure) {
        const retained = { ...attempt, error: result.inputFailure }
        setPendingInsert(retained)
        const outcome = await settleCourseComponentInput(result.inputFailure)
        if (outcome === 'applied') { setPendingInsert(current => current === retained ? null : current); return }
      }
      report(result.reason)
      return
    }
    setPendingInsert(current => current?.key === key ? null : current)
    }catch(error){report(error)} finally { inserting.current = false }
  }
  const extract=async()=>{setExtracting(true);try {if(onExtractSelection)await onExtractSelection(extractName,extractKind,selectedTemplatePages);else {
    const target=kernel.captureTarget();if(!extractName.trim()||extractKind==='objects'&&!target.instanceIds.length)throw new Error('请填写名称并选择对象。')
    const {entry,diagnostics}=extractComponentLibraryEntry(target.project,target.resources,{id:`library_${crypto.randomUUID()}`,title:extractName.trim(),kind:extractKind,
      ...(extractKind==='objects'?{rootIds:[...target.instanceIds]}:{surfaceIds:extractKind==='page'&&target.surfaceId?[target.surfaceId]:selectedTemplatePages})})
    if(!window.desktopAPI?.installComponentLibraryEntry)throw new Error('当前环境没有组件库保存入口。')
    await window.desktopAPI.installComponentLibraryEntry({bytes:exportComponentLibraryArchive(entry)});onRefreshComponentCatalog?.()
    kernel.setFeedback({statusMessage:'已存入我的资产库',errorMessage:diagnostics.length?diagnostics.map(item=>item.message).join('\n'):null})
  }setExtractName('')}catch(error){report(error)}finally{setExtracting(false)}}
  return <div className="components-tab" data-testid="components-tab">
    <div className="component-entry-actions"><button type="button" className="component-entry-action" data-testid="open-component-library" onClick={()=>setLibraryOpen(true)}><Library size={20}/><span><strong>打开组件与资产库</strong><small>按通用和学科浏览，可多选添加到画布</small></span></button><button type="button" className="component-entry-action" data-testid="import-external-components" disabled={!onImportExternalComponents} onClick={onImportExternalComponents}><Upload size={20}/><span><strong>导入外部组件</strong><small>保留源码与资源，可继续编辑</small></span></button></div>
    <div className="section-heading section-heading--spaced"><span>工程组件</span><span>{packages.length}</span></div>
    <div className="composition-fragment-actions"><select aria-label="提炼范围" value={extractKind} onChange={event=>{setExtractKind(event.currentTarget.value as typeof extractKind);setExtractPages(null)}}><option value="objects">所选对象组合</option><option value="page">当前页面模板</option><option value="structure">所选课程结构</option></select><input aria-label="资产名称" placeholder="为资产命名" value={extractName} onChange={event=>setExtractName(event.currentTarget.value)}/><button type="button" disabled={(extractKind==='objects'?!view.selectedInstanceIds.length:extractKind==='page'?!view.surfaceId:!selectedTemplatePages.length)||!extractName.trim()||extracting} onClick={()=>void extract()}>提炼到我的资产库</button></div>
    {extractKind==='structure'&&<fieldset><legend>保留顺序的页面</legend>{project && componentSurfaces(project).map(surface=><label key={surface.id}><input type="checkbox" checked={selectedTemplatePages.includes(surface.id)} onChange={event=>setExtractPages(event.currentTarget.checked?[...selectedTemplatePages,surface.id]:selectedTemplatePages.filter(id=>id!==surface.id))}/>{surface.title}</label>)}</fieldset>}
    <label className="component-project-search"><Search size={15}/><input type="search" aria-label="搜索工程组件" placeholder="搜索工程组件" value={searchQuery} onChange={event=>setSearchQuery(event.currentTarget.value)}/></label>
    {!visible.length?<div className="empty-state">{packages.length?'没有符合条件的组件。':'工程中还没有组件。请从组件库加入，或导入外部组件。'}</div>:<div className="project-component-list">{visible.map(fact=>{
      const data=fact.definition
      const id=data.id, usage=collectCourseComponentPackageUsage(project!,id),entry=current.find(value=>value.packageId===(data.library?.packageId ?? id)),status=entry?componentCatalogInstallStatus(entry,data):null
      return <article className="project-component-card" key={id} data-testid={`component-package-${id}`}><div className="project-component-card__main">
        <button type="button" className="component-card" data-testid={`component-${id}`} disabled={!fact.availability.available || fact.action.kind==='copy'&&!sourceId(id)}
          draggable={fact.availability.available&&(fact.action.kind==='template'||!!sourceId(id))} onDragStart={event=>{event.dataTransfer.effectAllowed='copy';event.dataTransfer.setData('application/x-courseware-element',`component:${id}`);event.dataTransfer.setData('text/plain',data.title??id);if(fact.action.kind==='copy'&&sourceId(id))event.dataTransfer.setData('application/x-courseware-component-source',sourceId(id)!);}} onClick={()=>void insert(id)}><span className="component-card__thumbnail"><Box size={20}/></span><span><strong>{data.title??id}</strong><small>{pendingInsert?.id === id && pendingInsert.target.documentId === view.activeDocumentId ? '核实／重试上次添加' : fact.action.label} · {data.library?.version ?? data.version ?? '工程定义'} · {usage.totalInstanceCount} 个实例</small></span><Box size={15}/></button>
        {!!fact.sources?.length&&<label>复制来源<select aria-label={`选择${data.title??id}的复制来源`} value={sourceId(id)??''} onChange={event=>setCopySources({...copySources,[sourceKey(id)]:event.currentTarget.value})}><option value="">请选择现有实例</option>{fact.sources.map(source=><option key={source.instanceId} value={source.instanceId}>{source.title}（{source.instanceId}）</option>)}</select></label>}
        {fact.action.kind==='template'&&!!fact.sources?.length&&<button type="button" disabled={!sourceId(id)} onClick={()=>void insert(id,'document',true)}>复制所选实例</button>}
        {!fact.availability.available&&<small role="status">{fact.availability.reason}</small>}
        {(project && view.surfaceId ? componentSurface(project,view.surfaceId) : undefined)?.kind==='flow'&&<button type="button" disabled={!fact.availability.available || fact.action.kind==='copy'&&!sourceId(id)} aria-label={`将${data.title??id}放到纸面上`} onClick={()=>void insert(id,'paper')}>放到纸面上</button>}
        <details className="project-component-menu"><summary aria-label={`管理${data.title??id}`}><MoreVertical size={17}/></summary><div className="project-component-menu__panel" role="menu">
          <button type="button" role="menuitem" onClick={event=>{closeContainingMenu(event.currentTarget);setDetailsId(id)}}><Info size={14}/>查看详情</button>
          <button type="button" role="menuitem" disabled={!usage.totalInstanceCount || !sourceId(id)} onClick={()=>void(async()=>{try{if(!window.desktopAPI)throw new Error('请在桌面软件中导出资产。');await window.desktopAPI.exportBinary({suggestedName:`${data.title??id}.h5component`,extension:'h5component',bytes:exportComponentLibraryArchive(componentDefinitionEntry(kernel,id,kernel.captureTarget(),sourceId(id)))})}catch(error){report(error)}})()}><Download size={14}/>导出所选实例资产</button>
          <button type="button" role="menuitem" disabled={status!=='update-available'||!onUpdateCatalogComponent} onClick={()=>entry&&onUpdateCatalogComponent?.(entry)}><RefreshCw size={14}/>更新组件</button>
          <button type="button" role="menuitem" disabled={!onReplaceComponent} onClick={()=>onReplaceComponent?.(id)}><Upload size={14}/>替换组件包</button>
          <button type="button" role="menuitem" disabled={!usage.totalInstanceCount} onClick={()=>{const ref=usage.references[0];kernel.selectInstances([ref.instanceId],ref.surfaceId??view.surfaceId)}}><LocateFixed size={14}/>定位使用位置</button>
          <button type="button" role="menuitem" className="is-danger" disabled={usage.totalInstanceCount>0} onClick={()=>void createComponentAuthoringActions(kernel).deleteComponentPackage(id)}><Trash2 size={14}/>从工程移除</button>
        </div></details></div></article>
    })}</div>}
    {libraryOpen&&<ComponentLibraryDialog catalog={componentCatalog} components={components} project={project} navigationTargetId={view.selectedInstanceId} onClose={()=>setLibraryOpen(false)} onRefresh={onRefreshComponentCatalog} onAdd={onAddCatalogComponents} onUpdate={onUpdateCatalogComponent} onDelete={onDeleteCatalogComponent}/>}
    {detailsId&&components[detailsId]&&<ComponentDetailsDialog data={components[detailsId]} entry={current.find(entry=>entry.packageId===(components[detailsId].library?.packageId ?? detailsId))} usage={collectCourseComponentPackageUsage(project!,detailsId)} onClose={()=>setDetailsId(null)}/>}
  </div>
}
