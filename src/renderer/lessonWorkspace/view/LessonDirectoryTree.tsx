import { useEffect, useState } from 'react'
import { ChevronRight, File, FileText, Folder, FolderOpen, Presentation } from 'lucide-react'
import type { LessonDesktopRequest, LessonDesktopResult, LessonDirectoryEntry } from '../../../shared/lessonDesktopContract'

function fileIcon(name: string) {
  if (/\.md$/i.test(name)) return <FileText size={15} aria-hidden="true" className="lesson-tree-icon lesson-tree-icon--md" />
  if (/\.h5lesson$/i.test(name)) return <Presentation size={15} aria-hidden="true" className="lesson-tree-icon lesson-tree-icon--course" />
  return <File size={15} aria-hidden="true" className="lesson-tree-icon" />
}

export function LessonDirectoryTree({ directory, operation, onFile, onDirectory }: {
  directory: string
  operation(request: LessonDesktopRequest): Promise<LessonDesktopResult>
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
  const toggle = (path: string) => {
    setExpanded(current => { const next = new Set(current); if (next.has(path)) next.delete(path); else next.add(path); return next })
  }
  return <ul className="lesson-directory-tree">{error && <li role="alert">{error}</li>}{entries.map(entry => {
    const isOpen = expanded.has(entry.path)
    return <li key={entry.path} data-kind={entry.kind} data-open={entry.kind === 'directory' ? isOpen : undefined}>
      {entry.kind === 'directory'
        ? <>
          <button type="button" className="lesson-tree-chevron" aria-label={isOpen ? `收起 ${entry.name}` : `展开 ${entry.name}`} aria-expanded={isOpen} onClick={() => { onDirectory(entry.path); toggle(entry.path) }}><ChevronRight size={14} aria-hidden="true" /></button>
          <button type="button" className="lesson-tree-row" title={entry.path} aria-label={entry.name} onClick={() => { onDirectory(entry.path); toggle(entry.path) }}>{isOpen ? <FolderOpen size={15} aria-hidden="true" className="lesson-tree-icon" /> : <Folder size={15} aria-hidden="true" className="lesson-tree-icon" />}<span>{entry.name}</span></button>
          {isOpen && <LessonDirectoryTree directory={entry.path} operation={operation} onFile={onFile} onDirectory={onDirectory} />}
        </>
        : <button type="button" className="lesson-tree-row lesson-tree-row--file" title={entry.path} onClick={() => onFile(entry)}>{fileIcon(entry.name)}<span>{entry.name}</span></button>}
    </li>
  })}</ul>
}
