import { CourseEditorChromeContext } from '../../documents/CourseEditorChromeContext'
import { useContentEditorMode } from '../../documents/useContentEditorMode'
import { useState } from 'react'
import type { LessonWorkspaceViewProps } from './lessonWorkspaceViewTypes'
import type { WorkbenchLayoutController } from './useWorkbenchLayoutPrefs'
import type { LessonWorkspace } from '../../../shared/lessonWorkspace'
import { WorkspaceDocumentTabs } from './WorkspaceDocumentTabs'
import { WorkspaceDocumentStatus } from './WorkspaceDocumentStatus'
import { LessonDocumentEditor } from '../../documentFiles/LessonDocumentEditor'
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
  const activeFileTab =
    tabs.tabs.find((tab) => tab.id === tabs.activeTab) ?? null;
  const chrome = useContentEditorMode(activeFileTab?.documentId ?? null, editorFocus, enterEditor, exitEditor);
  const showDocumentHeader = activeFileTab?.kind === 'material' && !editorFocus;
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
        documentStatus: <WorkspaceDocumentStatus api={props.documentPort.documents} documentId={activeFileTab?.documentId} />,
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
        <WorkspaceDocumentStatus api={props.documentPort.documents} documentId={activeFileTab?.documentId} />
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
      {tabs.tabs.length === 0 && <section className="lesson-workbench-empty" aria-label="没有打开的文件">
        <h2>从一份文档开始</h2>
        <p>新建文档或打开文件夹；会话可以独立继续。</p>
        <div className="lesson-chat-empty-actions">
          <button type="button" onClick={() => void actions.run(() => tabs.createMarkdown())}>新建 Markdown</button>
          <button type="button" onClick={() => void actions.run(actions.newCourse)}>新建课件</button>
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
          className="lesson-file-tab"
        >
          {tab.kind === "document" ? (
            tab.lesson && relativeFile(tab.lesson, tab.path) ? (
              <LessonDocumentEditor
                ref={tabs.editorRef(tab.id)}
                sessionKey={tab.id}
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
                documentId={tab.documentId}
                documentRef={{ kind: "file", path: tab.path || tab.name }}
                port={props.documentPort}
                onClosed={() => tabs.removeTab(tab.id)}
                onDirtyChange={(dirty) => tabs.updateDirty(tab.id, dirty)}
                onSelectionChange={() => tabs.selectionChanged(tab.id)}
                onContextualCommand={(instruction, target) => tabs.sendContextualCommand(tab.id, instruction, target)}
              />
            )
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
