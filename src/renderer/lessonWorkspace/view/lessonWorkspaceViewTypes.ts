import type { WorkspaceFilesAPI } from '../../../shared/workbench/workspaceFiles'
import type { ReactNode } from 'react'
import type { LessonProject, LessonWorkspace } from '../../../shared/lessonWorkspace'
import type { LessonDesktopRequest, LessonDesktopResult, LessonDirectoryEntry } from '../../../shared/lessonDesktopContract'
import type { RecoverableDocumentFilePort } from '../../documentFiles/documentFileSession'
import type { SaveDirectoryContext } from '../../../shared/workbench/desktop'
import type { DocumentTabsController, ActiveDocumentTarget } from '../controller/useDocumentTabsController'
export interface LessonWorkspaceViewProps {
  workspaceFiles?: WorkspaceFilesAPI;
  state: {
    workspace: string | null;
    standalone: boolean;
    recent: string[];
    selectedDirectory: string | null;
    lessons: LessonWorkspace[];
    lesson: LessonWorkspace | null;
    name: string;
    creating: boolean;
    error: string | null;
    busy: boolean;
    treeVersion: number;
    explorerOpen: boolean;
    mobilePane: "navigation" | "chat" | "workbench";
    projects: LessonProject[];
    activeDirectory:
      | { kind: "workspace" }
      | { kind: "project"; project: LessonProject }
      | null;
    projectFolder: string | null;
    projectName: string;
    projectNotice: string | null;
  };
  actions: {
    run(action: () => Promise<void>): Promise<void>;
    openWorkspace(directory?: string, create?: boolean): Promise<void>;
    activate(
      lesson: LessonWorkspace,
    ): Promise<void>;
    createLesson(): Promise<void>;
    openFile(entry: LessonDirectoryEntry): Promise<void>;
    newStandaloneProject(): Promise<void>;
    newCourse(): Promise<void>;
    setSelectedDirectory(value: string | null): void;
    setName(value: string): void;
    setCreating(value: boolean): void;
    refreshTree(): void;
    setExplorerOpen(value: boolean): void;
    setMobilePane(value: "navigation" | "chat" | "workbench"): void;
    createLessonProject(): Promise<void>;
    removeProject(project: LessonProject): Promise<void>;
    pickProjectFolder(): Promise<void>;
    cancelProjectPick(): void;
    openDirectoryContext(
      target:
        | { kind: "workspace" }
        | { kind: "project"; project: LessonProject },
    ): void;
    setProjectName(value: string): void;
    setProjectNotice(value: string | null): void;
  };
  operation(request: LessonDesktopRequest): Promise<LessonDesktopResult>;
  documentPort: RecoverableDocumentFilePort;
  onSaveDirectoryChange?(directory: SaveDirectoryContext | null): void;
  tabs: DocumentTabsController;
  projectPath: string | null;
  renderAssistant?(root: string | null, documentTarget: ActiveDocumentTarget | undefined, isCourse: boolean, drainDocuments: () => Promise<boolean>): ReactNode;
  renderMaterial?(path: string, lesson: LessonWorkspace | null): ReactNode;
  renderMaterials?(lesson: LessonWorkspace): ReactNode;
  children: ReactNode;
}

