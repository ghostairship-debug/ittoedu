import type { LessonWorkspaceViewProps } from './lessonWorkspaceViewTypes'

export function WorkspaceSessionHost({ props }: { props: LessonWorkspaceViewProps }) {
  const { state, tabs } = props
  return <main className="lesson-workspace-chat" aria-label="AI 助手">
    {props.renderAssistant
      ? props.renderAssistant(state.workspace, tabs.activeDocumentTarget(), tabs.isCourseActive, tabs.drainAll)
      : <p role="alert">创作助手服务不可用，请重新打开应用。</p>}
  </main>
}
