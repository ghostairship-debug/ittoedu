import { useEffect, useState } from 'react'
import type { LessonDesktopRequest, LessonDirectoryEntry } from '../../../shared/lessonDesktopContract'

export function LessonDirectoryTree({ directory, operation, onFile, onDirectory }: {
  directory: string
  operation(request: LessonDesktopRequest): Promise<{ entries?: LessonDirectoryEntry[] }>
  onFile(entry: LessonDirectoryEntry): void
  onDirectory(path: string): void
}) {
  const [entries, setEntries] = useState<LessonDirectoryEntry[]>([])
  const [expanded, setExpanded] = useState(new Set<string>())
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void operation({ operation: 'list-directory', directory }).then(result => { if (live) setEntries(result.entries ?? []) }).catch(reason => { if (live) setError((reason as Error).message) })
    return () => { live = false }
  }, [directory, operation])
  return <ul className="lesson-directory-tree">{error && <li role="alert">{error}</li>}{entries.map(entry => <li key={entry.path}>
    <button type="button" title={entry.path} onClick={() => {
      if (entry.kind === 'file') onFile(entry)
      else {
        onDirectory(entry.path)
        setExpanded(current => { const next = new Set(current); if (next.has(entry.path)) next.delete(entry.path); else next.add(entry.path); return next })
      }
    }}><span aria-hidden="true">{entry.kind === 'directory' ? expanded.has(entry.path) ? '▾' : '▸' : '·'}</span><span>{entry.name}</span></button>
    {entry.kind === 'directory' && expanded.has(entry.path) && <LessonDirectoryTree directory={entry.path} operation={operation} onFile={onFile} onDirectory={onDirectory} />}
  </li>)}</ul>
}
