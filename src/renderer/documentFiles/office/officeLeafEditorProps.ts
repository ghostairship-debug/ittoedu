import type { OfficeDocumentSnapshot } from '../../../shared/workbench/officeDocument'
import type { FileArtifactBinding } from '../../../shared/workbench/mediaFiles'
import type { OfficeEditContent } from '../../../shared/workbench/officeFiles'

export interface OfficeLeafEditorProps {
  snapshot: OfficeDocumentSnapshot
  name: string
  active?: boolean
  onEdit(binding: FileArtifactBinding, content: OfficeEditContent): Promise<OfficeDocumentSnapshot>
  onUndo(): Promise<void>
  onRedo(): Promise<void>
  onDirtyChange?(dirty: boolean): void
  onFocusChange?(focus: { paragraph?: number; sheet?: string; cell?: string; part?: string }): void
}
