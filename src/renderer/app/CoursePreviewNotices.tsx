/** Local/runtime and portability findings stay available without covering the player. */
export function CoursePreviewNotices({ messages }: { messages: readonly string[] }) {
  if (!messages.length) return null
  return <details className="course-preview-notices" data-testid="course-preview-notices">
    <summary>播放说明（{messages.length}）</summary>
    <ul>{messages.map(message => <li key={message}>{message}</li>)}</ul>
  </details>
}
