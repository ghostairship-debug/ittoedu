import { useEffect, useState } from 'react'
import { File, FileText, Folder, Presentation } from 'lucide-react'
import type { LessonDesktopRequest, LessonDesktopResult, LessonDirectoryEntry } from '../../../shared/lessonDesktopContract'
import type { WorkspaceFilesAPI } from '../../../shared/workbench/workspaceFiles'
import type { SaveDirectoryContext } from '../../../shared/workbench/desktop'
import { WorkspaceFilesTree } from './WorkspaceFilesTree'
function fileIcon(name: string) { return /\.md$/i.test(name) ? <FileText size={15} /> : /\.h5lesson$/i.test(name) ? <Presentation size={15} /> : <File size={15} /> }
export function LessonDirectoryTree(props: {
  directory: string; operation(request: LessonDesktopRequest): Promise<LessonDesktopResult>; files?: WorkspaceFilesAPI; refreshVersion?: number
  onFile(entry: LessonDirectoryEntry): void; onDirectory(path: string): void
  onScope?(path: string, kind: 'folder' | 'file', workspaceId?: string): void
  onSaveDirectoryChange?(directory: SaveDirectoryContext | null): void
}) {
  return props.files ? <WorkspaceFilesTree {...props} files={props.files} /> : <ReadOnlyTree {...props} refreshVersion={props.refreshVersion ?? 0} />
}
function ReadOnlyTree({ directory, operation, onFile, onDirectory, onScope, refreshVersion }: { directory: string; operation(request: LessonDesktopRequest): Promise<LessonDesktopResult>; onFile(entry: LessonDirectoryEntry): void; onDirectory(path: string): void; onScope?(path: string, kind: 'folder' | 'file', workspaceId?: string): void; refreshVersion: number }) {
  const [entries, setEntries] = useState<LessonDirectoryEntry[]>([]), [expanded, setExpanded] = useState(new Set<string>()), [error, setError] = useState('')
  useEffect(() => { let live = true; void operation({ operation: 'list-directory', directory }).then(result => { if (live) setEntries(result.entries ?? []) }).catch(reason => { if (live) setError((reason as Error).message) }); return () => { live = false } }, [directory, operation, refreshVersion])
  return <ul className="lesson-directory-tree">{error && <li role="alert">{error}</li>}{entries.map(entry => <li key={entry.path}><button type="button" className="lesson-tree-row" onClick={() => { onScope?.(entry.path, entry.kind === 'file' ? 'file' : 'folder'); if (entry.kind === 'file') onFile(entry); else { onDirectory(entry.path); setExpanded(current => { const next = new Set(current); if (next.has(entry.path)) next.delete(entry.path); else next.add(entry.path); return next }) } }}>{entry.kind === 'directory' ? <Folder size={15} /> : fileIcon(entry.name)}<span>{entry.name}</span></button>{entry.kind === 'directory' && expanded.has(entry.path) && <ReadOnlyTree directory={entry.path} operation={operation} onFile={onFile} onDirectory={onDirectory} onScope={onScope} refreshVersion={refreshVersion} />}</li>)}</ul>
}
