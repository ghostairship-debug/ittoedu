import { Box, Check, ChevronLeft, Download, Info, Library, LocateFixed, MoreVertical, RefreshCw, Search, ShieldAlert, Trash2, Upload, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { AvailableComponentCatalogPackage, AvailableHtmlComponent, ComponentCatalogSnapshot } from '../../shared/componentCatalog'
import type { ComponentDefinition } from '../../shared/contracts/component-platform/project'
import type { FlowDeepInsertPort } from './RightSidebar'
import { collectCourseComponentPackageUsage, type CourseComponentPackageUsage } from '../components/courseComponentPackageTransactions'
import { collectComponentLibrarySubjects, filterComponentLibraryPackages, filterHtmlComponents, selectCurrentCatalogPackages, selectCurrentHtmlComponents, componentCatalogInstallStatus } from '../components/componentLibraryModel'
import { componentDefinitionEntry, insertComponentDefinitionAtTarget } from '../components/insertComponentPackages'
import { createComponentAuthoringActions } from '../components/commitComponentPackageAuthoring'
import { extractComponentLibraryEntry } from '../../core/components/library'
import { exportComponentLibraryArchive } from '../../core/components/library/archive'
import { selectActiveCourseProjectDocument, selectEditingScope, useEditorStore } from '../store/editorStore'
interface ComponentsTabProps {
  onFlowInsert?: FlowDeepInsertPort
  componentCatalog?: ComponentCatalogSnapshot
  onImportExternalComponents?(): void
  onRefreshComponentCatalog?(): void
  onAddCatalogComponents?(entries: AvailableComponentCatalogPackage[]): boolean | Promise<boolean>
  onUpdateCatalogComponent?(entry: AvailableComponentCatalogPackage): void
  onReplaceComponent?(definitionId: string): void
  onExtractSelection?(title: string): Promise<void>
  onDeleteCatalogComponent?(entry: AvailableComponentCatalogPackage): Promise<void>
}
const EMPTY_CATALOG: ComponentCatalogSnapshot = { sources: [], packages: [], issues: [] }
const installStatusLabels = { available: '可加入工程', embedded: '已加入工程', 'update-available': '有新版本', 'embedded-newer': '工程版本更新' }
const qualityLabels = { experimental: '试验', candidate: '候选', stable: '稳定', deprecated: '已弃用' }
function CatalogThumbnail({entry}: {entry: AvailableComponentCatalogPackage}) { return entry.thumbnailDataUrl ? <img src={entry.thumbnailDataUrl} alt="" /> : <Box size={20} /> }
function closeContainingMenu(target: HTMLElement) { target.closest('details')?.removeAttribute('open') }
function ComponentDetailsDialog({data,entry,usage,onClose}: {data?: ComponentDefinition;entry?: AvailableComponentCatalogPackage;usage?: CourseComponentPackageUsage;onClose():void}) {
  useEffect(() => { const close=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose()};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close) },[onClose])
  return <div className="modal-backdrop" data-testid="component-details-dialog"><section className="modal component-details-dialog" role="dialog" aria-modal="true" aria-labelledby="component-details-title">
    <div className="component-details-dialog__header"><div><span>组件详情</span><h2 id="component-details-title">{data?.title ?? entry?.name ?? data?.id}</h2></div><button type="button" className="icon-button" aria-label="关闭组件详情" onClick={onClose}><X size={17}/></button></div>
    <dl className="component-details-dialog__list"><div><dt>组件 ID</dt><dd>{data?.id ?? entry?.packageId}</dd></div><div><dt>版本</dt><dd>{data?.version ?? entry?.version ?? '未标版本'}</dd></div><div><dt>来源</dt><dd>{entry?.sourceLabel ?? (data?.implementation.kind==='builtin'?'内置实现':'工程源码')}</dd></div>{usage&&<div><dt>工程实例</dt><dd>页面 {usage.sceneInstanceCount} · 全局 {usage.globalInstanceCount}</dd></div>}</dl>
    {entry?.description&&<p className="component-details-dialog__description">{entry.description}</p>}<div className="modal__actions"><button type="button" className="primary-button" onClick={onClose}>完成</button></div>
  </section></div>
}
/** HTML components saved from courses; AI reuses them by name, the panel only lists and deletes them. */
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
      <p className="component-library__html-note">从课件存入资产库的组件，AI 可按名称检索并放进页面；这里可以查看和删除“我的资产库”中的条目。</p>
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

interface ComponentLibraryDialogProps {
  catalog: ComponentCatalogSnapshot
  components: Record<string, ComponentDefinition>
  onClose(): void
  onRefresh?(): void
  onAdd?(entries: AvailableComponentCatalogPackage[]): boolean | Promise<boolean>
  onUpdate?(entry: AvailableComponentCatalogPackage): void
  onDelete?(entry: AvailableComponentCatalogPackage): void | Promise<void>
}

export function ComponentLibraryDialog({
  catalog,
  components,
  onClose,
  onRefresh,
  onAdd,
  onUpdate,
  onDelete,
}: ComponentLibraryDialogProps) {
  const entries = useMemo(
    () => selectCurrentCatalogPackages(
      catalog.packages,
    ),
    [catalog.packages],
  )
  const subjects = useMemo(() => collectComponentLibrarySubjects(entries), [entries])
  const schoolStages = useMemo(() => [...new Set(entries.flatMap((entry) => entry.schoolStage))]
    .sort((left, right) => left.localeCompare(right, 'zh-CN')), [entries])
  const categories = useMemo(() => [...new Set(entries.flatMap((entry) => entry.category ? [entry.category] : []))]
    .sort((left, right) => left.localeCompare(right, 'zh-CN')), [entries])
  const [query, setQuery] = useState('')
  const [subject, setSubject] = useState<string | null>(null)
  const [schoolStage, setSchoolStage] = useState('')
  const [category, setCategory] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [detailsEntry, setDetailsEntry] = useState<AvailableComponentCatalogPackage | null>(null)
  const visibleEntries = useMemo(() => filterComponentLibraryPackages(entries, {
    query,
    subject,
    schoolStage,
    category,
  }), [category, entries, query, schoolStage, subject])
  const selectableVisibleIds = visibleEntries
    .map((entry) => entry.packageId)
  const selectedEntries = entries.filter((entry) => selectedIds.has(entry.packageId))
  const htmlComponents = useMemo(() => selectCurrentHtmlComponents(catalog.htmlComponents ?? []), [catalog.htmlComponents])
  const visibleHtmlComponents = useMemo(() => filterHtmlComponents(htmlComponents, query), [htmlComponents, query])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !detailsEntry && !adding) onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [adding, detailsEntry, onClose])

  const toggleSelection = (packageId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(packageId)) next.delete(packageId)
      else next.add(packageId)
      return next
    })
  }

  const toggleAllVisible = () => {
    setSelectedIds((current) => {
      const next = new Set(current)
      const shouldSelect = selectableVisibleIds.some((id) => !next.has(id))
      selectableVisibleIds.forEach((id) => {
        if (shouldSelect) next.add(id)
        else next.delete(id)
      })
      return next
    })
  }

  return (
    <div className="component-library" data-testid="component-library" role="dialog" aria-modal="true" aria-labelledby="component-library-title">
      <header className="component-library__header">
        <button type="button" className="secondary-button" disabled={adding} onClick={onClose}>
          <ChevronLeft size={16} />返回编辑器
        </button>
        <div>
          <h2 id="component-library-title">组件与资产库</h2>
          <p>选择后直接添加到当前画布；已加入工程的组件会复用现有定义。</p>
        </div>
        <button type="button" className="secondary-button" disabled={!onRefresh} onClick={onRefresh}>
          <RefreshCw size={14} />刷新
        </button>
      </header>

      <div className="component-library__tools">
        <label className="component-library__search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            aria-label="搜索组件"
            placeholder="搜索名称、用途或标签"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        <select aria-label="筛选学段" value={schoolStage} onChange={(event) => setSchoolStage(event.currentTarget.value)}>
          <option value="">全部学段</option>
          {schoolStages.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <select aria-label="筛选用途" value={category} onChange={(event) => setCategory(event.currentTarget.value)}>
          <option value="">全部用途</option>
          {categories.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </div>

      <div className="component-library__body">
        <nav className="component-library__subjects" aria-label="组件学科分类">
          <button type="button" className={subject === null ? 'is-active' : ''} onClick={() => setSubject(null)}>
            <span>全部组件</span><small>{entries.length}</small>
          </button>
          {subjects.map((value) => (
            <button type="button" key={value} className={subject === value ? 'is-active' : ''} onClick={() => setSubject(value)}>
              <span>{value}</span>
              <small>{entries.filter((entry) =>
                filterComponentLibraryPackages([entry], { query: '', subject: value, schoolStage: '', category: '' }).length > 0,
              ).length}</small>
            </button>
          ))}
        </nav>

        <main className="component-library__results">
          <div className="component-library__results-heading">
            <div><strong>{subject ?? '全部组件'}</strong><span>{visibleEntries.length} 个结果</span></div>
            <button
              type="button"
              className="secondary-button"
              disabled={selectableVisibleIds.length === 0}
              onClick={toggleAllVisible}
            >
              <Check size={13} />全选当前结果
            </button>
          </div>
          {catalog.issues.length > 0 && (
            <div className="component-library__issues" role="status"><ShieldAlert size={16} /><span>{catalog.issues.map(issue => issue.message).join('；')}</span></div>
          )}
          {addError && <div className="component-library__issues" role="alert">{addError}</div>}
          {visibleEntries.length === 0 ? (
            <div className="empty-state component-library__empty">
              {entries.length === 0 ? '当前没有可用的内置组件。' : '没有符合筛选条件的组件。'}
            </div>
          ) : (
            <div className="component-library__grid">
              {visibleEntries.map((entry) => {
                const status = componentCatalogInstallStatus(entry, components[entry.packageId])
                const selectable = true
                const selected = selectedIds.has(entry.packageId)
                return (
                  <article
                    key={entry.packageId}
                    className={`component-library-card${selected ? ' is-selected' : ''}`}
                    data-testid={`catalog-component-${entry.packageId}`}
                  >
                    <label className={`component-library-card__select${selectable ? '' : ' is-disabled'}`}>
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={!selectable}
                        aria-label={`选择${entry.name}`}
                        onChange={() => toggleSelection(entry.packageId)}
                      />
                      <span className="component-library-card__thumbnail"><CatalogThumbnail entry={entry} /></span>
                    </label>
                    <div className="component-library-card__copy">
                      <div className="component-library-card__title">
                        <strong>{entry.name}</strong>
                        <span className={`component-quality component-quality--${entry.quality}`}>{qualityLabels[entry.quality]}</span>
                      </div>
                      <p>{entry.description}</p>
                      <div className="component-library-card__metadata">
                        <span>v{entry.version}</span>
                        <span>{entry.subject.length > 0 ? entry.subject.join(' / ') : '通用'}</span>
                        {entry.schoolStage.length > 0 && <span>{entry.schoolStage.join(' / ')}</span>}
                      </div>
                      <div className="component-library-card__status">
                        <span>{installStatusLabels[status]}</span>
                      </div>
                    </div>
                    <div className="component-library-card__actions">
                      <button type="button" className="secondary-button" onClick={() => setDetailsEntry(entry)}>
                        <Info size={13} />详情
                      </button>
                      {entry.removable && onDelete && <button type="button" className="secondary-button" onClick={() => void onDelete(entry)}><Trash2 size={13} />删除库条目</button>}
                      {status === 'update-available' && (
                        <button type="button" className="secondary-button" disabled={!onUpdate} onClick={() => onUpdate?.(entry)}>
                          <RefreshCw size={13} />审阅更新
                        </button>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
          )}
          {visibleHtmlComponents.length > 0 && (
            <HtmlComponentLibrarySection entries={visibleHtmlComponents} onRefresh={onRefresh} />
          )}
        </main>
      </div>

      <footer className="component-library__footer">
        <span>已选择 {selectedEntries.length} 个组件</span>
        <button
          type="button"
          className="primary-button"
          disabled={selectedEntries.length === 0 || !onAdd || adding}
          onClick={() => {
            if (!onAdd || adding) return
            setAdding(true); setAddError(null)
            void Promise.resolve().then(() => onAdd(selectedEntries))
              .then((completed) => {
                if (!completed) return
                setSelectedIds(new Set())
                onClose()
              })
              .catch(error => setAddError(error instanceof Error ? error.message : String(error)))
              .finally(() => setAdding(false))
          }}
        >
          {adding ? '正在添加…' : `添加到画布${selectedEntries.length > 0 ? `（${selectedEntries.length}）` : ''}`}
        </button>
      </footer>
      {detailsEntry && (
        <ComponentDetailsDialog entry={detailsEntry} onClose={() => setDetailsEntry(null)} />
      )}
    </div>
  )
}

export function ComponentsTab({componentCatalog=EMPTY_CATALOG,onImportExternalComponents,onRefreshComponentCatalog,onAddCatalogComponents,onUpdateCatalogComponent,onReplaceComponent,onExtractSelection,onDeleteCatalogComponent}:ComponentsTabProps) {
  const project=useEditorStore(selectActiveCourseProjectDocument), kernel=useEditorStore(state=>state.courseKernel), view=useEditorStore(state=>state.courseView)
  const [libraryOpen,setLibraryOpen]=useState(false), [searchQuery,setSearchQuery]=useState(''),[detailsId,setDetailsId]=useState<string|null>(null),[extractName,setExtractName]=useState(''),[extracting,setExtracting]=useState(false)
  const components=project?.definitions ?? {}, packages=Object.values(components).sort((a,b)=>(a.title??a.id).localeCompare(b.title??b.id,'zh-CN'))
  const current=selectCurrentCatalogPackages(componentCatalog.packages), query=searchQuery.trim().toLocaleLowerCase()
  const visible=packages.filter(data=>[data.title,data.id,data.version].join(' ').toLocaleLowerCase().includes(query))
  const report=(error:unknown)=>kernel.setFeedback({errorMessage:error instanceof Error?error.message:String(error)})
  const insert=(id:string,destination:'document'|'paper'='document')=>{
    const target=kernel.captureTarget(),state=useEditorStore.getState()
    const camera=target.project.surfaces.find(surface=>surface.id===target.surfaceId)?.kind==='spatial'&&selectEditingScope(state)!=='global'
      ? state.readSpatialView(target.surfaceId??'',target.documentId).camera:null
    void insertComponentDefinitionAtTarget(kernel,target,id,undefined,{destination,...(camera?{center:{x:camera.x,y:camera.y}}:{})}).then(result=>{if(!result.ok)report(result.reason)})
  }
  const extract=async()=>{setExtracting(true);try {if(onExtractSelection)await onExtractSelection(extractName);else {
    const target=kernel.captureTarget();if(!extractName.trim()||!target.instanceIds.length)throw new Error('请填写名称并选择对象。')
    const {entry,diagnostics}=extractComponentLibraryEntry(target.project,target.resources,{id:`library_${crypto.randomUUID()}`,title:extractName.trim(),rootIds:[...target.instanceIds]})
    if(!window.desktopAPI?.installComponentLibraryEntry)throw new Error('当前环境没有组件库保存入口。')
    await window.desktopAPI.installComponentLibraryEntry({bytes:exportComponentLibraryArchive(entry)});onRefreshComponentCatalog?.()
    kernel.setFeedback({statusMessage:'已存入我的资产库',errorMessage:diagnostics.length?diagnostics.map(item=>item.message).join('\n'):null})
  }setExtractName('')}catch(error){report(error)}finally{setExtracting(false)}}
  return <div className="components-tab" data-testid="components-tab">
    <div className="component-entry-actions"><button type="button" className="component-entry-action" data-testid="open-component-library" onClick={()=>setLibraryOpen(true)}><Library size={20}/><span><strong>打开组件与资产库</strong><small>按通用和学科浏览，可多选添加到画布</small></span></button><button type="button" className="component-entry-action" data-testid="import-external-components" disabled={!onImportExternalComponents} onClick={onImportExternalComponents}><Upload size={20}/><span><strong>导入外部组件</strong><small>保留源码与资源，可继续编辑</small></span></button></div>
    <div className="section-heading section-heading--spaced"><span>工程组件</span><span>{packages.length}</span></div>
    <div className="composition-fragment-actions"><input aria-label="资产名称" placeholder="为所选对象命名" value={extractName} onChange={event=>setExtractName(event.currentTarget.value)}/><button type="button" disabled={!view.selectedInstanceIds.length||!extractName.trim()||extracting} onClick={()=>void extract()}>提炼到我的资产库</button></div>
    <label className="component-project-search"><Search size={15}/><input type="search" aria-label="搜索工程组件" placeholder="搜索工程组件" value={searchQuery} onChange={event=>setSearchQuery(event.currentTarget.value)}/></label>
    {!visible.length?<div className="empty-state">{packages.length?'没有符合条件的组件。':'工程中还没有组件。请从组件库加入，或导入外部组件。'}</div>:<div className="project-component-list">{visible.map(data=>{
      const id=data.id, usage=collectCourseComponentPackageUsage(project!,id),entry=current.find(value=>value.packageId===id),status=entry?componentCatalogInstallStatus(entry,data):null
      return <article className="project-component-card" key={id} data-testid={`component-package-${id}`}><div className="project-component-card__main">
        <button type="button" className="component-card" data-testid={`component-${id}`} draggable={usage.totalInstanceCount>0} onDragStart={event=>{event.dataTransfer.effectAllowed='copy';event.dataTransfer.setData('application/x-courseware-element',`component:${id}`);event.dataTransfer.setData('text/plain',data.title??id)}} onClick={()=>insert(id)}><span className="component-card__thumbnail"><Box size={20}/></span><span><strong>{data.title??id}</strong><small>{data.version??'工程定义'} · {usage.totalInstanceCount} 个实例</small></span><Box size={15}/></button>
        {project?.surfaces.find(surface=>surface.id===view.surfaceId)?.kind==='flow'&&<button type="button" aria-label={`将${data.title??id}放到纸面上`} onClick={()=>insert(id,'paper')}>放到纸面上</button>}
        <details className="project-component-menu"><summary aria-label={`管理${data.title??id}`}><MoreVertical size={17}/></summary><div className="project-component-menu__panel" role="menu">
          <button type="button" role="menuitem" onClick={event=>{closeContainingMenu(event.currentTarget);setDetailsId(id)}}><Info size={14}/>查看详情</button>
          <button type="button" role="menuitem" disabled={!usage.totalInstanceCount} onClick={()=>void(async()=>{try{if(!window.desktopAPI)throw new Error('请在桌面软件中导出资产。');await window.desktopAPI.exportBinary({suggestedName:`${data.title??id}.h5component`,extension:'h5component',bytes:exportComponentLibraryArchive(componentDefinitionEntry(kernel,id))})}catch(error){report(error)}})()}><Download size={14}/>导出结构资产</button>
          <button type="button" role="menuitem" disabled={status!=='update-available'||!onUpdateCatalogComponent} onClick={()=>entry&&onUpdateCatalogComponent?.(entry)}><RefreshCw size={14}/>更新组件</button>
          <button type="button" role="menuitem" disabled={!onReplaceComponent} onClick={()=>onReplaceComponent?.(id)}><Upload size={14}/>替换组件包</button>
          <button type="button" role="menuitem" disabled={!usage.totalInstanceCount} onClick={()=>{const ref=usage.references[0];kernel.selectInstances([ref.instanceId],ref.surfaceId??view.surfaceId)}}><LocateFixed size={14}/>定位使用位置</button>
          <button type="button" role="menuitem" className="is-danger" disabled={usage.totalInstanceCount>0} onClick={()=>void createComponentAuthoringActions(kernel).deleteComponentPackage(id)}><Trash2 size={14}/>从工程移除</button>
        </div></details></div></article>
    })}</div>}
    {libraryOpen&&<ComponentLibraryDialog catalog={componentCatalog} components={components} onClose={()=>setLibraryOpen(false)} onRefresh={onRefreshComponentCatalog} onAdd={onAddCatalogComponents} onUpdate={onUpdateCatalogComponent} onDelete={onDeleteCatalogComponent}/>}
    {detailsId&&components[detailsId]&&<ComponentDetailsDialog data={components[detailsId]} entry={current.find(entry=>entry.packageId===detailsId)} usage={collectCourseComponentPackageUsage(project!,detailsId)} onClose={()=>setDetailsId(null)}/>}
  </div>
}
