import { CourseEditorChromeContext } from '../../documents/CourseEditorChromeContext'
import { useContentEditorMode } from '../../documents/useContentEditorMode'
import { useLayoutEffect, useState } from 'react'
import { officeFocus } from '../../workbench/officeFocus'
import type { LessonWorkspaceViewProps } from './lessonWorkspaceViewTypes'
import type { WorkbenchLayoutController } from './useWorkbenchLayoutPrefs'
import type { LessonWorkspace } from '../../../shared/lessonWorkspace'
import { WorkspaceDocumentTabs } from './WorkspaceDocumentTabs'
import { WorkspaceDocumentStatus } from './WorkspaceDocumentStatus'
import { LessonDocumentEditor } from '../../documentFiles/LessonDocumentEditor'
import { MediaFileEditor } from '../../documentFiles/media/MediaFileEditor'
import { PptxFileEditor } from '../../documentFiles/office/PptxFileEditor'
import { DocxFilePreview } from '../../documentFiles/office/DocxFilePreview'
import { DocxFileEditor } from '../../documentFiles/office/DocxFileEditor'
import { XlsxFileEditor } from '../../documentFiles/office/XlsxFileEditor'
import './officeFileView.css'
import { usePptxPicker } from './usePptxPicker'
import { CourseImportMenu } from '../../ui/CourseImportMenu'
function relativeFile(lesson: LessonWorkspace, filename: string) {
  const root = lesson.identity.normalizedDirectory.replace(/[\\/]$/, "");
  const lower = (value: string) => value.replace(/\\/g, "/").toLowerCase();
  return lower(filename).startsWith(`${lower(root)}/`)
    ? filename.replace(/\\/g, "/").slice(root.length + 1)
    : null;
}

export function WorkspaceContentHost({ props, layout, editorFocus, enterEditor, exitEditor }: {
 props: LessonWorkspaceViewProps; layout: WorkbenchLayoutController; editorFocus: boolean; enterEditor(): void; exitEditor(): void;
}) {
  const { state, actions, tabs } = props;
  const [externalNotice, setExternalNotice] = useState<string | null>(null);
  const [layoutPreview, setLayoutPreview] = useState<string | null>(null);
  const activeFileTab =
    tabs.tabs.find((tab) => tab.id === tabs.activeTab) ?? null;
  useLayoutEffect(() => {
    officeFocus.setOpenFiles(tabs.tabs.map(tab => {
      const binding = tab.pptxSnapshot?.binding ?? tab.officeSnapshot?.binding ?? tab.mediaSnapshot?.binding
      return { path: tab.path, name: tab.name, format: tab.name.split('.').pop()?.toLowerCase() ?? tab.kind,
        fileVersion: binding?.fileVersion, bindingVersion: binding?.bindingVersion, documentId: tab.documentId }
    }), activeFileTab?.path ?? null)
  }, [tabs.tabs, tabs.activeTab])
  const fileSession = tabs.activeDocumentTarget()?.getEditor()?.session;
  const chrome = useContentEditorMode(activeFileTab?.documentId ?? null, editorFocus, enterEditor, exitEditor);
  const showDocumentHeader = (activeFileTab?.kind === 'material' || activeFileTab?.kind === 'media') && !editorFocus;
  const pptx = usePptxPicker(file => {
    void actions.run(async () => { if (!await actions.newCourseFromPptx(file)) return; layout.setContentClosed(false); actions.setMobilePane('workbench') });
  });
  const openActiveExternal = async () => {
    if (!activeFileTab) return;
    setExternalNotice(null);
    try {
      const result = await props.operation({
        operation: "open-external",
        path: activeFileTab.path,
      });
      if (result.opened === false)
        setExternalNotice(
          `无法用系统应用打开 ${activeFileTab.name}：${result.openError ?? "没有可用的关联程序"}`,
        );
    } catch (error) {
      setExternalNotice(
        `无法用系统应用打开 ${activeFileTab.name}：${(error as Error).message}`,
      );
    }
  };

  return (
    <CourseEditorChromeContext.Provider value={{
      ...chrome,
      workbench: {
        documentStatus: <WorkspaceDocumentStatus api={props.documentPort.documents} documentId={activeFileTab?.documentId} session={fileSession} />,
      },
    }}>
    <section
      className="lesson-workspace-workbench"
      aria-label="课例工作台"
    >
      {showDocumentHeader && <div className="workbench-layout-bar">
        <span
          className="workbench-layout-bar__title"
          title={activeFileTab?.path || undefined}
        >
          {activeFileTab?.name ?? "内容区"}
        </span>
        <WorkspaceDocumentStatus api={props.documentPort.documents} documentId={activeFileTab?.documentId} session={fileSession} />
        <button type="button" title="关闭内容区（不关闭文件）" onClick={layout.toggleContentClosed}>关闭内容</button>
        {activeFileTab?.path && <button type="button" className="workbench-open-external"
          title={`在系统应用中打开 ${activeFileTab.path}`} onClick={() => { void openActiveExternal() }}>外部打开 ↗</button>}
      </div>}
      {externalNotice && !editorFocus && (
        <p role="alert" className="workbench-external-notice">
          {externalNotice}
        </p>
      )}
      <WorkspaceDocumentTabs props={props} layout={layout} hidden={editorFocus} />
      {pptx.element}
      {tabs.tabs.length === 0 && <section className="lesson-workbench-empty" aria-label="没有打开的文件">
        <h2>在这里完成你的作品</h2>
        <p>打开文件开始编辑，或在 果铃AI中描述目标，边创作边完善。</p>
        <div className="lesson-chat-empty-actions">
          <button type="button" onClick={() => void actions.run(() => tabs.createMarkdown())}>新建 MD 文档</button>
          <button type="button" onClick={() => void actions.run(() => tabs.createText())}>新建 TXT 文档</button>
          <button type="button" onClick={() => void actions.run(actions.newCourse)}>新建 果铃工程</button>
          <CourseImportMenu busy={state.busy} onPptx={pptx.pick}
            onFlow={props.onImportFlow ? () => props.onImportFlow?.() : undefined}
            onHtml={props.onImportHtml ? () => props.onImportHtml?.() : undefined} />
          <button type="button" onClick={() => void actions.run(() => actions.openWorkspace())}>打开文件夹</button>
        </div>
      </section>}

      {state.lesson && (
        <div
          className="lesson-file-tab"
          hidden={tabs.activeTab !== "materials"}
        >
          {props.renderMaterials?.(state.lesson) ?? (
            <section className="lesson-workbench-empty">
              <p className="lesson-eyebrow">材料</p>
              <h2>添加本课例需要的材料</h2>
              <p>材料会整理到当前课例，供后续教学策划和生成使用。</p>
            </section>
          )}
        </div>
      )}
      <div className="lesson-course-tab" hidden={!tabs.isCourseActive}>
        {props.children}
      </div>
      {tabs.tabs.filter(tab => tab.kind !== "course").map((tab) => (
        <div
          key={tab.id}
          hidden={tabs.activeTab !== tab.id}
          className={`lesson-file-tab${tab.kind === "document" && /\.html?$/i.test(tab.path || tab.name) ? " lesson-file-tab--html" : tab.kind === "document" && /\.(md|markdown)$/i.test(tab.path || tab.name) ? " lesson-file-tab--markdown" : ""}`}
        >
          {tab.kind === "document" ? (
            tab.lesson && relativeFile(tab.lesson, tab.path) ? (
              <LessonDocumentEditor
                ref={tabs.editorRef(tab.id)}
                sessionKey={tab.id}
                active={tabs.activeTab === tab.id}
                documentId={tab.documentId}
                documentRef={{
                  kind: "lesson",
                  lessonId: tab.lesson.identity.lessonId,
                  lessonDirectory: tab.lesson.identity.normalizedDirectory,
                  relativePath: relativeFile(tab.lesson, tab.path)!,
                }}
                port={props.documentPort}
                onClosed={() => tabs.removeTab(tab.id)}
                onDirtyChange={(dirty) => tabs.updateDirty(tab.id, dirty)}
                onSelectionChange={() => tabs.selectionChanged(tab.id)}
                onContextualCommand={(instruction, target) => tabs.sendContextualCommand(tab.id, instruction, target)}
              />
            ) : (
              <LessonDocumentEditor
                ref={tabs.editorRef(tab.id)}
                sessionKey={tab.id}
                active={tabs.activeTab === tab.id}
                documentId={tab.documentId}
                documentRef={{ kind: "file", path: tab.path || tab.name }}
                port={props.documentPort}
                onClosed={() => tabs.removeTab(tab.id)}
                onDirtyChange={(dirty) => tabs.updateDirty(tab.id, dirty)}
                onSelectionChange={() => tabs.selectionChanged(tab.id)}
                onContextualCommand={(instruction, target) => tabs.sendContextualCommand(tab.id, instruction, target)}
              />
            )
          ) : tab.kind === 'presentation' || tab.kind === 'word' || tab.kind === 'spreadsheet' ? (
            <div className="office-file-view">
              {tab.officePending && <p className={`office-file-view__message${tab.pptxSnapshot || tab.officeSnapshot || tab.docxSnapshot ? ' office-file-view__message--transient' : ''}`} role="status">
                {tab.officeMessage}{tab.officeStale ? ' 当前仍显示上一版本，载入完成后更新。' : ''}
              </p>}
              {tab.officeError && <p className="office-file-view__message" role="alert">{tab.officeError}</p>}
              {tab.kind === 'word' && <div className="office-file-view__modes">
                <button type="button" aria-pressed={layoutPreview !== tab.id} onClick={() => setLayoutPreview(null)}>正文编辑</button>
                <button type="button" disabled={tab.officePending} aria-pressed={layoutPreview === tab.id} onClick={() => void actions.run(async () => {
                  if (!await tabs.drainAll()) return
                  await tabs.reloadDocx(tab.id); setLayoutPreview(tab.id)
                })}>版式预览</button>
              </div>}
              {tab.pptxSnapshot?.editingError && <p className="office-file-view__message" role="alert">{tab.pptxSnapshot.editingError}</p>}
              {tab.kind === 'presentation' && tab.pptxSnapshot ? <PptxFileEditor
                ref={tabs.officeEditorRef(tab.id)} snapshot={tab.pptxSnapshot} name={tab.name} active={tabs.activeTab === tab.id && !layout.prefs.contentClosed}
                onCommit={(binding, bytes) => tabs.commitPptx(tab.id, binding, bytes)}
                onEdit={edits => tabs.editPptx(tab.id, edits)}
                onFocusChange={focus => officeFocus.updateLocation(tab.path, focus)}
                onUndo={() => tabs.movePptxHistory(tab.id, 'undo')} onRedo={() => tabs.movePptxHistory(tab.id, 'redo')}
                onDirtyChange={dirty => tabs.updateDirty(tab.id, dirty)}
                onReload={async () => { await tabs.reloadPptx(tab.id) }}
                onOpenExternal={async () => {
                  const result = await props.operation({ operation: 'open-external', path: tab.path })
                  if (result.opened === false) throw new Error(result.openError ?? '没有可用的关联程序')
                }}
                onImportToCourse={async () => {
                  const snapshot = await tabs.reloadPptx(tab.id)
                  const file = new File([Uint8Array.from(snapshot.bytes)], snapshot.binding.path.split(/[\\/]/).pop() ?? tab.name,
                    { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })
                  if (await actions.newCourseFromPptx(file)) { layout.setContentClosed(false); actions.setMobilePane('workbench') }
                }} /> : tab.kind === 'word' && layoutPreview !== tab.id && tab.officeSnapshot ? <DocxFileEditor
                  ref={tabs.officeEditorRef(tab.id)} snapshot={tab.officeSnapshot} name={tab.name} active={tabs.activeTab === tab.id && !layout.prefs.contentClosed}
                  onEdit={(binding, content) => tabs.editOffice(tab.id, binding, content)}
                  onFocusChange={({ cell, ...focus }) => officeFocus.updateLocation(tab.path, { ...focus, ...(cell ? { range: cell } : {}) })}
                  onUndo={async () => { await tabs.moveOfficeHistory(tab.id, 'undo') }} onRedo={async () => { await tabs.moveOfficeHistory(tab.id, 'redo') }}
                  onDirtyChange={dirty => tabs.updateDirty(tab.id, dirty)}
                /> : tab.kind === 'spreadsheet' && tab.officeSnapshot ? <XlsxFileEditor
                  ref={tabs.officeEditorRef(tab.id)} snapshot={tab.officeSnapshot} name={tab.name} active={tabs.activeTab === tab.id && !layout.prefs.contentClosed}
                  onEdit={(binding, content) => tabs.editOffice(tab.id, binding, content)}
                  onFocusChange={({ cell, ...focus }) => officeFocus.updateLocation(tab.path, { ...focus, ...(cell ? { range: cell } : {}) })}
                  onUndo={async () => { await tabs.moveOfficeHistory(tab.id, 'undo') }} onRedo={async () => { await tabs.moveOfficeHistory(tab.id, 'redo') }}
                  onDirtyChange={dirty => tabs.updateDirty(tab.id, dirty)}
                /> : tab.kind === 'word' && layoutPreview === tab.id && tab.docxSnapshot ? <DocxFilePreview
                  bytes={tab.docxSnapshot.pdfBytes} name={tab.name} pageCount={tab.docxSnapshot.pageCount}
                  sourceSha256={tab.docxSnapshot.sourceSha256} engine={tab.docxSnapshot.engine} notices={tab.docxSnapshot.notices}
                  active={tabs.activeTab === tab.id && !layout.prefs.contentClosed}
                  onReload={async () => { await tabs.reloadDocx(tab.id) }}
                  onOpenExternal={async () => {
                    const result = await props.operation({ operation: 'open-external', path: tab.path })
                    if (result.opened === false) throw new Error(result.openError ?? '没有可用的关联程序')
                  }} /> : <section className="office-file-view__pending" aria-label={`${tab.name} 原件载入`}>
                    <h2>{tab.name}</h2>
                    <p>{tab.kind === 'word' ? 'Word 原件编辑' : tab.kind === 'spreadsheet' ? 'Excel 工作簿编辑' : '演示文稿原件'}</p>
                    <div className="lesson-chat-empty-actions">
                      <button type="button" disabled={tab.officePending} onClick={() => void actions.run(async () => {
                        if (tab.kind === 'presentation') await tabs.reloadPptx(tab.id)
                        else await tabs.reloadOffice(tab.id)
                      })}>重新载入</button>
                      <button type="button" onClick={() => void actions.run(async () => {
                        const result = await props.operation({ operation: 'open-external', path: tab.path })
                        if (result.opened === false) throw new Error(result.openError ?? '没有可用的关联程序')
                      })}>用系统应用打开</button>
                      {tab.officePending && <button type="button" onClick={() => { void tabs.closeTab(tab) }}>取消并关闭</button>}
                    </div>
                  </section>}
            </div>
          ) : tab.kind === 'media' && tab.mediaSnapshot ? (
            <MediaFileEditor
              ref={tabs.mediaEditorRef(tab.id)}
              snapshot={tab.mediaSnapshot}
              port={{
                release: binding => window.desktopAPI?.releaseMediaFileDraft?.(binding),
                preview: (binding, operations) => tabs.mediaFiles({ type: 'media-file.preview', binding, operations: [...operations] }),
                save: (binding, operations) => tabs.mediaFiles({ type: 'media-file.save', binding, operations: [...operations] }),
                reload: binding => tabs.mediaFiles({ type: 'media-file.reload', binding }),
              }}
              onSaved={snapshot => tabs.updateMediaSnapshot(tab.id, snapshot)}
              onDirtyChange={dirty => tabs.updateDirty(tab.id, dirty)}
            />
          ) : (
            (props.renderMaterial?.(tab.path, tab.lesson) ?? (
              <p>此文件的预览暂不可用：{tab.path}</p>
            ))
          )}
        </div>
      ))}
    </section>
    </CourseEditorChromeContext.Provider>
  );

}
