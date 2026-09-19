import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeftRight,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderPlus,
  HardDrive,
  MessageCircle,
  MessageSquare,
  MessagesSquare,
  PanelsTopLeft,
  SquarePen,
} from "lucide-react";
import {
  conversationOwnerOf,
  type ConversationOwner,
  type LessonConversation,
  type LessonProject,
  type LessonWorkspace,
} from "../../../shared/lessonWorkspace";
import type {
  LessonDesktopRequest,
  LessonDesktopResult,
  LessonDirectoryEntry,
} from "../../../shared/lessonDesktopContract";
import { LessonDocumentEditor } from "../../documentFiles/LessonDocumentEditor";
import type { RecoverableDocumentFilePort } from "../../documentFiles/documentFileSession";
import type { DocumentChatTarget } from "../../documentFiles/documentAiTaskController";
import type {
  DocumentTabsController,
  LessonFileTab,
} from "../controller/useDocumentTabsController";
import { LessonDirectoryTree } from "./LessonDirectoryTree";
import { contentDockResizeSign, WorkbenchSplitter } from "./WorkbenchSplitter";
import {
  useWorkbenchLayoutPrefs,
  type ContentDock,
} from "./useWorkbenchLayoutPrefs";

export interface LessonWorkspaceViewProps {
  state: {
    workspace: string | null;
    standalone: boolean;
    recent: string[];
    selectedDirectory: string | null;
    lessons: LessonWorkspace[];
    lesson: LessonWorkspace | null;
    conversations: LessonConversation[];
    conversation: LessonConversation | null;
    name: string;
    creating: boolean;
    error: string | null;
    busy: boolean;
    treeVersion: number;
    explorerOpen: boolean;
    conversationsOpen: boolean;
    workflowOpen: boolean;
    mobilePane: "navigation" | "chat" | "workbench";
    projects: LessonProject[];
    directoryConversations: LessonConversation[];
    projectConversations: Record<string, LessonConversation[]>;
    directoryConversation: LessonConversation | null;
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
      conversation?: LessonConversation,
    ): Promise<void>;
    selectConversation(conversation: LessonConversation): Promise<void>;
    createLesson(): Promise<void>;
    openFile(entry: LessonDirectoryEntry): Promise<void>;
    newStandaloneProject(): Promise<void>;
    setSelectedDirectory(value: string | null): void;
    setName(value: string): void;
    setCreating(value: boolean): void;
    refreshTree(): void;
    setExplorerOpen(value: boolean): void;
    setConversationsOpen(value: boolean): void;
    setWorkflowOpen(value: boolean): void;
    setMobilePane(value: "navigation" | "chat" | "workbench"): void;
    setConversations(value: LessonConversation[]): void;
    clearConversation(): void;
    createLessonProject(): Promise<void>;
    removeProject(project: LessonProject): Promise<void>;
    pickProjectFolder(): Promise<void>;
    cancelProjectPick(): void;
    openDirectoryContext(
      target:
        | { kind: "workspace" }
        | { kind: "project"; project: LessonProject },
    ): void;
    createDirectoryConversation(
      target?:
        | { kind: "workspace" }
        | { kind: "project"; project: LessonProject },
      title?: string,
    ): Promise<void>;
    selectDirectoryConversation(conversation: LessonConversation): void;
    clearDirectoryContext(): void;
    setProjectName(value: string): void;
    setProjectNotice(value: string | null): void;
    setDirectoryConversations(value: LessonConversation[]): void;
    setProjectConversations(
      path: string,
      conversations: LessonConversation[],
    ): void;
  };
  operation(request: LessonDesktopRequest): Promise<LessonDesktopResult>;
  documentPort: RecoverableDocumentFilePort;
  tabs: DocumentTabsController;
  projectPath: string | null;
  renderChat(
    lesson: LessonWorkspace,
    conversation: LessonConversation,
    documentTarget?: DocumentChatTarget,
  ): ReactNode;
  renderDirectoryChat?(
    root: string,
    conversation: LessonConversation,
    documentTarget?: DocumentChatTarget,
  ): ReactNode;
  renderMaterial?(path: string, lesson: LessonWorkspace | null): ReactNode;
  renderMaterials?(lesson: LessonWorkspace): ReactNode;
  renderWorkflow?(
    lesson: LessonWorkspace,
    conversation: LessonConversation,
  ): ReactNode;
  children: ReactNode;
}

const basename = (path: string) =>
  path
    .replace(/[\\/]$/, "")
    .split(/[\\/]/)
    .pop() || path;
const join = (directory: string, name: string) =>
  `${directory.replace(/[\\/]$/, "")}/${name}`;
const lower = (value: string) => value.replace(/\\/g, "/").toLowerCase();
function relativeFile(lesson: LessonWorkspace, filename: string) {
  const root = lesson.identity.normalizedDirectory.replace(/[\\/]$/, "");
  const lower = (value: string) => value.replace(/\\/g, "/").toLowerCase();
  return lower(filename).startsWith(`${lower(root)}/`)
    ? filename.replace(/\\/g, "/").slice(root.length + 1)
    : null;
}

const DOCK_OPTIONS: { dock: ContentDock; label: string }[] = [
  { dock: "right", label: "内容在右" },
  { dock: "left", label: "内容在左" },
  { dock: "bottom", label: "内容在下" },
  { dock: "top", label: "内容在上" },
];

export function LessonWorkspaceView(props: LessonWorkspaceViewProps) {
  const { state, actions, tabs } = props;
  const layout = useWorkbenchLayoutPrefs();
  const columnsRef = useRef<HTMLDivElement | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    new Set(),
  );
  const [switcherMenuOpen, setSwitcherMenuOpen] = useState(false);
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false);
  const [newTabMenuOpen, setNewTabMenuOpen] = useState(false);
  const [newDocName, setNewDocName] = useState("");
  const [editorFocus, setEditorFocus] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyMatches, setHistoryMatches] = useState<
    { conversationId: string; excerpt: string }[]
  >([]);
  const savedLayoutRef = useRef<{
    contentDock: ContentDock;
    contentClosed: boolean;
    chatClosed: boolean;
  } | null>(null);
  const [externalNotice, setExternalNotice] = useState<string | null>(null);
  const activeFileTab =
    tabs.tabs.find((tab) => tab.path === tabs.activeTab) ?? null;
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
  // 课例激活（新建/打开/树点 h5lesson）即展开内容区；仅在课例或会话身份变化时触发，不打扰教师手动收起。
  useEffect(() => {
    if (state.lesson && state.conversation) layout.setContentClosed(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.lesson?.identity.lessonId, state.conversation?.conversationId]);
  const workspaceName = state.workspace ? basename(state.workspace) : "";
  /** 新对话归属作用域显示名：选中的项目，或整个工作空间。 */
  const scopeLabel =
    state.activeDirectory?.kind === "project"
      ? state.activeDirectory.project.name
      : "整个工作空间";
  const toggleGroup = (key: string) =>
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const dock = layout.prefs.contentDock;
  const stacked = dock === "top" || dock === "bottom";
  const contentOpen = !layout.prefs.contentClosed;
  /** 目录会话渲染根：按会话真实归属取项目文件夹或工作空间根。 */
  const directoryRootOf = (conversation: LessonConversation): string => {
    try {
      const owner = conversationOwnerOf(conversation);
      if (owner.kind === "project") return owner.projectPath;
      if (owner.kind === "workspace") return owner.workspaceRoot;
    } catch {
      /* 旧记录身份不完整时退回工作空间根 */
    }
    return state.workspace ?? "";
  };

  /** 在编辑器中打开：全屏编辑模式。只改 CSS 投影，不停靠换向、不卸载对话。 */
  const enterEditor = () => {
    if (editorFocus) return;
    savedLayoutRef.current = {
      contentDock: layout.prefs.contentDock,
      contentClosed: layout.prefs.contentClosed,
      chatClosed: layout.prefs.chatClosed,
    };
    setEditorFocus(true);
    layout.setContentClosed(false);
  };
  const exitEditor = () => {
    setEditorFocus(false);
    const saved = savedLayoutRef.current;
    savedLayoutRef.current = null;
    if (saved) layout.setContentClosed(saved.contentClosed);
  };
  /** ＋新建：在工作空间根目录创建 Markdown 文档并直接打开为标签页。 */
  const createMarkdown = async () => {
    const directory = state.workspace;
    if (!directory) return;
    const raw = newDocName.trim() || "未命名文档";
    const name = /\.md$/i.test(raw) ? raw : `${raw}.md`;
    const result = await props.operation({
      operation: "create-file",
      directory,
      name,
    });
    const path = join(result.directory ?? directory, name);
    props.tabs.openTab({
      path,
      name,
      kind: "document",
      lesson: state.lesson,
    });
    actions.refreshTree();
    setNewDocName("");
    setNewTabMenuOpen(false);
  };

  const resizeContentByPx = (deltaPx: number) => {
    const host = columnsRef.current;
    if (!host) return;
    const axis = stacked ? host.clientHeight : host.clientWidth;
    if (!axis) return;
    const current = stacked
      ? layout.prefs.contentHeight
      : layout.prefs.contentWidth;
    layout.setContentSize(current + (deltaPx / axis) * 100);
  };

  const contentSplitterDrag = (deltaPx: number) => {
    resizeContentByPx(contentDockResizeSign(dock) * deltaPx);
  };
  async function searchHistory() {
    const query = historyQuery.trim();
    const root = state.workspace;
    if (!query || !root) return;
    const owners: ConversationOwner[] = [
      { kind: "workspace", workspaceRoot: lower(root) },
      ...state.projects.map((project) => ({
        kind: "project" as const,
        workspaceRoot: lower(root),
        projectPath: project.normalizedPath,
      })),
    ];
    const found: { conversationId: string; excerpt: string }[] = [];
    for (const owner of owners) {
      const result = await props.operation({
        operation: "search-conversations",
        owner,
        query,
      });
      found.push(...(result.matches ?? []));
    }
    setHistoryMatches(found);
  }
  function pickHistory(conversationId: string) {
    const record = [
      ...state.directoryConversations,
      ...Object.values(state.projectConversations).flat(),
    ].find((item) => item.conversationId === conversationId);
    if (record) actions.selectDirectoryConversation(record);
  }

  const nav = state.workspace && (
    <nav
      className="lesson-workspace-navigation"
      aria-label="目录与会话"
      style={{ width: layout.prefs.navWidth }}
    >
      <section
        className="lesson-workspace-pane lesson-workspace-files"
        data-collapsed={!layout.prefs.explorerOpen}
      >
        <header>
          <button
            type="button"
            className="lesson-section-heading"
            aria-expanded={layout.prefs.explorerOpen}
            onClick={() => layout.setExplorerOpen(!layout.prefs.explorerOpen)}
          >
            <span>资源管理器</span>
            <span className="lesson-section-tag">工作空间</span>
            <span aria-hidden="true">
              {layout.prefs.explorerOpen ? "⌄" : "›"}
            </span>
          </button>
          <button
            type="button"
            className="lesson-icon-button"
            title="刷新工作空间根目录"
            aria-label="刷新工作空间根目录"
            onClick={actions.refreshTree}
          >
            ↻
          </button>
        </header>
        {layout.prefs.explorerOpen && (
          <div className="lesson-pane-body">
            <p className="lesson-workspace-root" title={state.workspace}>
              {state.workspace}
            </p>
            <LessonDirectoryTree
              key={state.treeVersion}
              directory={state.workspace}
              operation={props.operation}
              onFile={(entry) => {
                layout.setContentClosed(false);
                void actions.openFile(entry);
              }}
              onDirectory={actions.setSelectedDirectory}
            />
          </div>
        )}
      </section>
      <section
        className="lesson-workspace-pane lesson-workspace-sessions"
        data-collapsed={!layout.prefs.conversationsOpen}
      >
        <header>
          <button
            type="button"
            className="lesson-section-heading"
            aria-expanded={layout.prefs.conversationsOpen}
            onClick={() =>
              layout.setConversationsOpen(!layout.prefs.conversationsOpen)
            }
          >
            <span>项目与会话</span>
            <span aria-hidden="true">
              {layout.prefs.conversationsOpen ? "⌄" : "›"}
            </span>
          </button>
        </header>
        {layout.prefs.conversationsOpen && (
          <div className="lesson-pane-body">
            <div className="lesson-session-tools">
              <label className="lesson-history-search">
                查找会话
                <input
                  aria-label="查找会话"
                  value={historyQuery}
                  onChange={(event) => setHistoryQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void searchHistory();
                    }
                  }}
                  placeholder="按标题或消息查找"
                />
              </label>
              <button
                type="button"
                disabled={state.busy || !historyQuery.trim()}
                onClick={() => void searchHistory()}
              >
                查找
              </button>
              <button
                type="button"
                className="lesson-primary-action"
                disabled={state.busy}
                title={`新对话将归入：${scopeLabel}`}
                onClick={() => {
                  void actions.run(() => actions.createDirectoryConversation());
                }}
              >
                <SquarePen size={14} aria-hidden="true" />
                新对话
              </button>
              {historyMatches.length > 0 && (
                <ul className="lesson-history-matches" aria-label="会话查找结果">
                  {historyMatches.map((match) => (
                    <li key={match.conversationId}>
                      <button
                        type="button"
                        onClick={() => pickHistory(match.conversationId)}
                      >
                        {match.excerpt}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                disabled={state.busy}
                title="添加项目文件夹：先弹系统对话框选择文件夹位置"
                onClick={() => {
                  void actions.run(() => actions.pickProjectFolder());
                }}
              >
                <FolderPlus size={14} aria-hidden="true" />
                新建项目
              </button>
            </div>
            {state.projectFolder && (
              <form
                className="lesson-create-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void actions.run(() => actions.createLessonProject());
                }}
              >
                <label>
                  项目名称
                  <input
                    value={state.projectName}
                    onChange={(event) =>
                      actions.setProjectName(event.target.value)
                    }
                    required
                  />
                </label>
                <p title={state.projectFolder}>
                  项目文件夹：{state.projectFolder}
                </p>
                <button
                  type="submit"
                  className="lesson-primary-action"
                  disabled={state.busy || !state.projectName.trim()}
                >
                  创建项目
                </button>
                <button
                  type="button"
                  disabled={state.busy}
                  onClick={() => {
                    void actions.run(() => actions.pickProjectFolder());
                  }}
                >
                  重新选择…
                </button>
                <button
                  type="button"
                  onClick={() => actions.cancelProjectPick()}
                >
                  取消
                </button>
              </form>
            )}
            {state.projectNotice && (
              <p role="status" className="lesson-project-notice">
                {state.projectNotice}
              </p>
            )}
            {state.projects.length === 0 && !state.projectFolder && (
              <p className="lesson-section-note">
                还没有项目；点上方「新建项目」选择工作空间内的真实文件夹，新对话默认归入整个工作空间。
              </p>
            )}
            <div className="lesson-project-groups">
              {state.projects.map((project) => {
                const key = lower(project.normalizedPath);
                const open = !collapsedGroups.has(key);
                const conversations = state.projectConversations[key] ?? [];
                const scopeActive =
                  state.activeDirectory?.kind === "project" &&
                  lower(state.activeDirectory.project.normalizedPath) === key;
                return (
                  <div
                    className="lesson-project-group"
                    key={key}
                    data-open={open}
                  >
                    <div className="lesson-project-group-row">
                      <button
                        type="button"
                        className="lesson-tree-chevron"
                        aria-expanded={open}
                        aria-label={`${open ? "收起" : "展开"}项目 ${project.name}`}
                        onClick={() => toggleGroup(key)}
                      >
                        <ChevronRight size={14} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="lesson-project-scope"
                        title={project.normalizedPath}
                        aria-pressed={scopeActive}
                        onClick={() =>
                          actions.openDirectoryContext({
                            kind: "project",
                            project,
                          })
                        }
                      >
                        <Folder
                          size={15}
                          aria-hidden="true"
                          className="lesson-tree-icon"
                        />
                        {project.name}
                      </button>
                      <button
                        type="button"
                        className="lesson-icon-button lesson-project-remove"
                        aria-label={`移除项目 ${project.name}`}
                        disabled={state.busy}
                        onClick={() => {
                          if (
                            window.confirm(
                              `仅从列表移除项目“${project.name}”，不会删除工作空间中的任何文件。`,
                            )
                          )
                            void actions.run(() =>
                              actions.removeProject(project),
                            );
                        }}
                      >
                        移除
                      </button>
                    </div>
                    {open && (
                      <div className="lesson-project-group-body">
                        {conversations.length === 0 ? (
                          <p className="lesson-section-note">还没有项目会话</p>
                        ) : (
                          <DirectorySessionList
                            owner={{
                              kind: "project",
                              workspaceRoot: lower(state.workspace!),
                              projectPath: project.normalizedPath,
                            }}
                            conversations={conversations}
                            currentId={
                              state.directoryConversation?.conversationId
                            }
                            operation={props.operation}
                            onRecordsChange={(records) =>
                              actions.setProjectConversations(key, records)
                            }
                            onDeleted={(ids) => {
                              if (
                                state.directoryConversation &&
                                ids.includes(
                                  state.directoryConversation.conversationId,
                                )
                              )
                                actions.clearDirectoryContext();
                            }}
                            onSelect={(item) =>
                              actions.selectDirectoryConversation(item)
                            }
                          />
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div
              className="lesson-workspace-directory lesson-workspace-scope"
              data-open={!collapsedGroups.has("__workspace__")}
            >
              <div className="lesson-project-group-row">
                <button
                  type="button"
                  className="lesson-tree-chevron"
                  aria-expanded={!collapsedGroups.has("__workspace__")}
                  aria-label="收展工作空间会话"
                  onClick={() => toggleGroup("__workspace__")}
                >
                  <ChevronRight size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="lesson-workspace-scope-label"
                  aria-pressed={state.activeDirectory?.kind !== "project"}
                  onClick={() =>
                    actions.openDirectoryContext({ kind: "workspace" })
                  }
                >
                  <MessagesSquare
                    size={15}
                    aria-hidden="true"
                    className="lesson-tree-icon"
                  />
                  工作空间会话
                </button>
                <button
                  type="button"
                  className="lesson-icon-button"
                  title="新建工作空间会话"
                  aria-label="新建工作空间会话"
                  disabled={state.busy}
                  onClick={() => {
                    void actions.run(() =>
                      actions.createDirectoryConversation({
                        kind: "workspace",
                      }),
                    );
                  }}
                >
                  ＋
                </button>
              </div>
              {!collapsedGroups.has("__workspace__") && (
                <div className="lesson-project-group-body">
                  {state.directoryConversations.length === 0 ? (
                    <p className="lesson-section-note">还没有工作空间会话</p>
                  ) : (
                    <DirectorySessionList
                      owner={{
                        kind: "workspace",
                        workspaceRoot: lower(state.workspace!),
                      }}
                      conversations={state.directoryConversations}
                      currentId={state.directoryConversation?.conversationId}
                      operation={props.operation}
                      onRecordsChange={actions.setDirectoryConversations}
                      onDeleted={(ids) => {
                        if (
                          state.directoryConversation &&
                          ids.includes(
                            state.directoryConversation.conversationId,
                          )
                        )
                          actions.clearDirectoryContext();
                      }}
                      onSelect={(item) =>
                        actions.selectDirectoryConversation(item)
                      }
                    />
                  )}
                </div>
              )}
            </div>
            {state.lesson && state.directoryConversation && (
              <button
                type="button"
                className="lesson-directory-back"
                onClick={() => actions.clearDirectoryContext()}
              >
                回到课例对话
              </button>
            )}
          </div>
        )}
      </section>
      <div className="lesson-sidebar-bottom">
        <HardDrive size={14} aria-hidden="true" />
        <span>
          CLI 工作目录：{state.directoryConversation ? directoryRootOf(state.directoryConversation) : state.workspace ?? '未打开'}
          <small>权限以各 CLI 原生配置与授权为准，应用未限制工作空间内外</small>
        </span>
      </div>
    </nav>
  );

  const directoryChat = state.directoryConversation ? (
    props.renderDirectoryChat ? (
      props.renderDirectoryChat(
        directoryRootOf(state.directoryConversation),
        state.directoryConversation,
        tabs.activeDocumentTarget(),
      )
    ) : (
      <section className="lesson-chat-empty">
        <p className="lesson-eyebrow">工作空间会话</p>
        <h2>会话聊天入口未连接</h2>
        <p>请从应用宿主打开工作台后再试。</p>
      </section>
    )
  ) : null;
  const chatTitle =
    state.directoryConversation?.title ??
    (state.lesson && state.conversation
      ? state.conversation.title
      : "从工作空间开始");
  const chat = state.workspace && (
    <main
      className="lesson-workspace-chat"
      data-fill={stacked || undefined}
      aria-label="课例对话"
    >
      <div className="lesson-chat-heading">
        <span className="lesson-chat-heading-label">
          <MessageCircle size={13} aria-hidden="true" />
          对话
        </span>
        <strong title={chatTitle}>{chatTitle}</strong>
        {contentOpen && (
          <button
            type="button"
            className="lesson-icon-button"
            title="收起内容区（专注对话）"
            onClick={() => layout.setContentClosed(true)}
          >
            收起内容
          </button>
        )}
      </div>
      {state.lesson && state.conversation && !state.directoryConversation ? (
        <>
          <details
            className="lesson-workflow"
            open={state.workflowOpen}
            onToggle={(event) =>
              actions.setWorkflowOpen(
                (event.currentTarget as HTMLDetailsElement).open,
              )
            }
          >
            <summary>
              <span>创作流程</span>
              <small>查看当前阶段、确认稿件或处理待办</small>
            </summary>
            {props.renderWorkflow?.(state.lesson, state.conversation)}
          </details>
          {props.renderChat(
            state.lesson,
            state.conversation,
            tabs.activeDocumentTarget(),
          )}
        </>
      ) : state.directoryConversation ? (
        directoryChat
      ) : (
        <section className="lesson-chat-empty">
          <p className="lesson-eyebrow">从工作空间开始</p>
          <h2>先讨论，需要时再出课件</h2>
          <p>
            可以直接新建工作空间会话，或先创建一个项目，再围绕它讨论；也可以在内容区「＋」新建文档或课件。
          </p>
          <div className="lesson-chat-empty-actions">
            <button
              type="button"
              className="lesson-primary-action"
              disabled={state.busy}
              onClick={() => {
                void actions.run(() => actions.createDirectoryConversation());
              }}
            >
              新建工作空间会话
            </button>
            <button
              type="button"
              disabled={state.busy}
              onClick={() => {
                void actions.run(() => actions.pickProjectFolder());
              }}
            >
              新建项目
            </button>
            <button
              type="button"
              disabled={state.busy}
              onClick={() => actions.setCreating(true)}
            >
              新建课件
            </button>
          </div>
        </section>
      )}
    </main>
  );
  const chatClosedPane = (
    <div className="lesson-workspace-chat lesson-workspace-chat--closed">
      <button
        type="button"
        className="lesson-chat-reopen"
        title="展开对话区"
        onClick={() => layout.setChatClosed(false)}
      >
        <MessageCircle size={14} aria-hidden="true" />
        展开对话
      </button>
    </div>
  );
  const chatPane = (
    <>
      {chat}
      {layout.prefs.chatClosed ? chatClosedPane : null}
    </>
  );

  const workbench = (
    <section
      className="lesson-workspace-workbench"
      aria-label="课例工作台"
      style={
        // standalone 布局里工作台是唯一一列，也隐藏了 splitter 与布局条（无任何尺寸控件），
        // 内联内容尺寸只会留下死区（r18-089 :678 的 691px 断言即此）；与 editor-focus 的
        // CSS 复位同义，从源头不再写入。
        state.standalone
          ? undefined
          : stacked
            ? { height: `${layout.prefs.contentHeight}%` }
            : { width: `${layout.prefs.contentWidth}%` }
      }
    >
      <div className="workbench-layout-bar">
        <span
          className="workbench-layout-bar__title"
          title={props.projectPath ?? undefined}
        >
          {props.projectPath
            ? basename(props.projectPath).replace(/\.h5lesson$/i, "")
            : "内容区"}
        </span>
        {editorFocus ? (
          <button type="button" onClick={exitEditor}>
            返回工作台
          </button>
        ) : (
          <>
            <button
              type="button"
              className="workbench-editor-focus"
              title="在编辑器中打开：全屏编辑，专注当前内容"
              onClick={enterEditor}
            >
              在编辑器中打开
            </button>
            <button
              type="button"
              title="关闭内容区（不关闭文件）"
              onClick={layout.toggleContentClosed}
            >
              关闭内容
            </button>
            {activeFileTab && (
              <button
                type="button"
                className="workbench-open-external"
                title={`在系统应用中打开 ${activeFileTab.path}`}
                onClick={() => {
                  void openActiveExternal();
                }}
              >
                外部打开 ↗
              </button>
            )}
          </>
        )}
      </div>
      {externalNotice && (
        <p role="alert" className="workbench-external-notice">
          {externalNotice}
        </p>
      )}
      <div role="tablist" aria-label="材料、教学文档与课件">
        {state.lesson && (
          <button
            type="button"
            role="tab"
            aria-selected={tabs.activeTab === "materials"}
            onClick={() => tabs.setActiveTab("materials")}
          >
            材料
          </button>
        )}
        <button
          type="button"
          role="tab"
          aria-selected={tabs.activeTab === "course"}
          onClick={() => tabs.setActiveTab("course")}
        >
          {props.projectPath ? (
            <>
              {basename(props.projectPath).replace(/\.h5lesson$/i, "")}
              <small title={props.projectPath}>.h5lesson</small>
            </>
          ) : (
            "新建课件"
          )}
        </button>
        {tabs.tabs.map((tab) => (
          <TabButton
            key={tab.path}
            tab={tab}
            active={tabs.activeTab === tab.path}
            onSelect={() => tabs.setActiveTab(tab.path)}
            onClose={() => {
              void actions.run(async () => {
                if (!(await tabs.closeTab(tab)))
                  throw new Error(
                    "当前稿尚未保存，请重试保存、保留恢复稿或返回编辑。",
                  );
              });
            }}
          />
        ))}
        <details
          className="lesson-new-tab lesson-workspace-more"
          open={newTabMenuOpen}
          onToggle={(event) =>
            setNewTabMenuOpen(
              (event.currentTarget as HTMLDetailsElement).open,
            )
          }
        >
          <summary aria-label="新建标签页" title="新建文档或课件">
            ＋
          </summary>
          {newTabMenuOpen && (
            <div
              className="lesson-popover-backdrop"
              aria-hidden="true"
              onClick={() => setNewTabMenuOpen(false)}
            />
          )}
          <div className="lesson-new-tab-popover">
            <p className="lesson-eyebrow">新建</p>
            <label>
              Markdown 文档名
              <input
                value={newDocName}
                onChange={(event) => setNewDocName(event.target.value)}
                placeholder="未命名文档"
              />
            </label>
            <button
              type="button"
              disabled={state.busy}
              onClick={() => {
                void actions.run(createMarkdown);
              }}
            >
              创建文档
            </button>
            <button
              type="button"
              disabled={state.busy}
              onClick={() => {
                setNewTabMenuOpen(false);
                actions.setCreating(true);
              }}
            >
              新建课件
            </button>
          </div>
        </details>
      </div>
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
      <div className="lesson-course-tab" hidden={tabs.activeTab !== "course"}>
        {props.children}
      </div>
      {tabs.tabs.map((tab) => (
        <div
          key={tab.path}
          hidden={tabs.activeTab !== tab.path}
          className="lesson-file-tab"
        >
          {tab.kind === "document" ? (
            !state.directoryConversation && tab.lesson && relativeFile(tab.lesson, tab.path) ? (
              <LessonDocumentEditor
                ref={(editor) => tabs.registerEditor(tab.path, editor)}
                documentRef={{
                  kind: "lesson",
                  lessonId: tab.lesson.identity.lessonId,
                  lessonDirectory: tab.lesson.identity.normalizedDirectory,
                  relativePath: relativeFile(tab.lesson, tab.path)!,
                }}
                port={props.documentPort}
                onClosed={() => tabs.removeTab(tab.path)}
                onDirtyChange={(dirty) => tabs.updateDirty(tab.path, dirty)}
              />
            ) : (
              <LessonDocumentEditor
                ref={(editor) => tabs.registerEditor(tab.path, editor)}
                documentRef={{ kind: "file", path: tab.path }}
                port={props.documentPort}
                onClosed={() => tabs.removeTab(tab.path)}
                onDirtyChange={(dirty) => tabs.updateDirty(tab.path, dirty)}
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
  );

  const contentSplitter = (
    <WorkbenchSplitter
      className="workbench-splitter--before-content"
      label={stacked ? "调整内容区高度" : "调整内容区宽度"}
      orientation={stacked ? "horizontal" : "vertical"}
      value={stacked ? layout.prefs.contentHeight : layout.prefs.contentWidth}
      onResizeDelta={contentSplitterDrag}
    />
  );

  const navSplitter = (
    <WorkbenchSplitter
      label="调整侧栏宽度"
      orientation="vertical"
      value={layout.prefs.navWidth}
      onResizeDelta={(delta) =>
        layout.setNavWidth(layout.prefs.navWidth + delta)
      }
    />
  );

  // 以带稳定 key 的数组渲染列子节点：停靠方向切换时 React 按 key 移动真实 DOM，
  // 工作台（含完整编辑器）不因左/右停靠互换而重建，撤销历史与场景状态得以保留。
  const columnItems: { key: string; node: ReactNode }[] = [];
  if (state.workspace)
    columnItems.push({
      key: "pane-switcher",
      node: (
        <div
          className="lesson-workspace-pane-switcher"
          role="tablist"
          aria-label="工作台区域"
        >
          <button
            type="button"
            role="tab"
            aria-selected={state.mobilePane === "navigation"}
            onClick={() => actions.setMobilePane("navigation")}
          >
            资源与课例
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={state.mobilePane === "chat"}
            onClick={() => actions.setMobilePane("chat")}
          >
            对话
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={state.mobilePane === "workbench"}
            onClick={() => actions.setMobilePane("workbench")}
          >
            文档与课件
          </button>
        </div>
      ),
    });
  if (state.workspace && layout.prefs.navCollapsed)
    columnItems.push({
      key: "nav-reopen",
      node: (
        <button
          type="button"
          className="workbench-nav-reopen"
          title="展开资源与会话侧栏"
          aria-label="展开资源与会话侧栏"
          onClick={layout.toggleNav}
        >
          »
        </button>
      ),
    });
  columnItems.push({ key: "nav", node: nav });
  if (state.workspace && !layout.prefs.navCollapsed)
    columnItems.push({ key: "nav-splitter", node: navSplitter });
  if (state.workspace && stacked) {
    columnItems.push({
      key: "stack",
      node: (
        <div className="lesson-workspace-stack">
          {dock === "top" ? (
            <>
              {workbench}
              {contentSplitter}
              {chatPane}
            </>
          ) : (
            <>
              {chatPane}
              {contentSplitter}
              {workbench}
            </>
          )}
        </div>
      ),
    });
  } else {
    if (state.workspace && dock === "left") {
      columnItems.push({ key: "workbench", node: workbench });
      columnItems.push({ key: "content-splitter", node: contentSplitter });
    }
    columnItems.push({ key: "chat", node: chatPane });
    if (state.workspace && dock === "right") {
      columnItems.push({ key: "content-splitter", node: contentSplitter });
      columnItems.push({ key: "workbench", node: workbench });
    }
  }
  if (!state.workspace) columnItems.push({ key: "workbench", node: workbench });

  return (
    <div
      className="lesson-workspace-shell"
      data-editor-focus={editorFocus || undefined}
    >
      <header className="lesson-workspace-toolbar">
        <details
          className="lesson-workspace-switcher lesson-workspace-more"
          open={switcherMenuOpen}
          onToggle={(event) =>
            setSwitcherMenuOpen(
              (event.currentTarget as HTMLDetailsElement).open,
            )
          }
        >
          <summary
            aria-label="切换工作空间"
            title={state.workspace ?? "选择工作空间"}
          >
            <span className="lesson-workspace-brand" aria-hidden="true">
              果
            </span>
            <strong>
              {state.workspace ? workspaceName : "果铃工作台"}
            </strong>
            <span className="lesson-workspace-switch-tag" aria-hidden="true">
              <ArrowLeftRight size={12} />
              切换
            </span>
            <ChevronDown size={14} aria-hidden="true" />
          </summary>
          {switcherMenuOpen && (
            <div
              className="lesson-popover-backdrop"
              aria-hidden="true"
              onClick={() => setSwitcherMenuOpen(false)}
            />
          )}
          <div className="lesson-workspace-switcher-popover">
            <p className="lesson-eyebrow">工作空间</p>
            {state.recent.map((directory) => (
              <button
                type="button"
                key={directory}
                title={directory}
                aria-pressed={
                  state.workspace
                    ? lower(directory) === lower(state.workspace)
                    : undefined
                }
                onClick={() => {
                  setSwitcherMenuOpen(false);
                  if (
                    state.workspace &&
                    lower(directory) === lower(state.workspace)
                  )
                    return;
                  setEditorFocus(false);
                  void actions.run(() => actions.openWorkspace(directory));
                }}
              >
                <strong>{basename(directory)}</strong>
                <small>{directory}</small>
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setSwitcherMenuOpen(false);
                setEditorFocus(false);
                void actions.run(() => actions.openWorkspace());
              }}
            >
              选择其他工作空间文件夹…
            </button>
            <button
              type="button"
              onClick={() => {
                setSwitcherMenuOpen(false);
                setEditorFocus(false);
                void actions.run(() => actions.openWorkspace(undefined, true));
              }}
            >
              新建工作空间
            </button>
            <div className="lesson-permission-note">
              <strong>工作空间权限</strong>
              <p>
                产品目标是工作空间内完整工作、外部默认只读；当前以各 CLI 原生 cwd、配置与授权为准，应用层策略尚未接线。
              </p>
            </div>
          </div>
        </details>
        <div className="lesson-workspace-toolbar-actions">
          <details
            className="lesson-workspace-more lesson-layout-menu"
            open={layoutMenuOpen}
            onToggle={(event) =>
              setLayoutMenuOpen(
                (event.currentTarget as HTMLDetailsElement).open,
              )
            }
          >
            <summary aria-label="布局" title="按你的习惯安排工作区">
              <PanelsTopLeft size={14} aria-hidden="true" />
              布局
            </summary>
            {layoutMenuOpen && (
              <div
                className="lesson-popover-backdrop"
                aria-hidden="true"
                onClick={() => setLayoutMenuOpen(false)}
              />
            )}
            <div className="lesson-layout-popover">
              <p className="lesson-eyebrow">内容区位置</p>
              <div className="lesson-layout-dock">
                {DOCK_OPTIONS.map((option) => (
                  <button
                    key={option.dock}
                    type="button"
                    aria-pressed={dock === option.dock}
                    onClick={() => layout.setDock(option.dock)}
                  >
                    {option.label.replace("内容在", "")}
                  </button>
                ))}
              </div>
              <button type="button" onClick={layout.toggleNav}>
                {layout.prefs.navCollapsed ? "展开" : "收起"}资源与会话侧栏
              </button>
              <button type="button" onClick={layout.toggleChatClosed}>
                {layout.prefs.chatClosed ? "展开" : "收起"}对话区
              </button>
              <button
                type="button"
                onClick={() => layout.toggleContentClosed()}
              >
                {contentOpen ? "收起" : "展开"}内容区
              </button>
              <button type="button" onClick={layout.resetLayout}>
                恢复默认布局
              </button>
            </div>
          </details>
        </div>
      </header>
      {state.error && (
        <div role="alert" className="lesson-workspace-error">
          {state.error}
        </div>
      )}
      {!state.workspace && !state.standalone && (
        <section className="lesson-workspace-landing">
          <p className="lesson-eyebrow">从真实文件夹开始</p>
          <h2>创建一份可保存、可重开的课例</h2>
          <p>
            先选择工作空间；随后在其中建立独立课例，整理材料、审阅文档并制作课件。
          </p>
          <div>
            <button
              type="button"
              className="lesson-primary-action"
              disabled={state.busy}
              onClick={() => {
                void actions.run(() => actions.openWorkspace());
              }}
            >
              打开工作空间
            </button>
            <button
              type="button"
              disabled={state.busy}
              onClick={() => {
                void actions.run(() => actions.openWorkspace(undefined, true));
              }}
            >
              新建工作空间
            </button>
          </div>
          {state.recent.length > 0 && (
            <div className="lesson-recent-workspaces">
              <h3>最近使用</h3>
              {state.recent.map((directory) => (
                <button
                  type="button"
                  title={directory}
                  key={directory}
                  onClick={() => {
                    void actions.run(() => actions.openWorkspace(directory));
                  }}
                >
                  {basename(directory)}
                </button>
              ))}
            </div>
          )}
        </section>
      )}
      <div
        className="lesson-workspace-columns"
        ref={columnsRef}
        data-layout={state.workspace ? "workspace" : "standalone"}
        data-dock={state.workspace ? dock : undefined}
        data-nav-collapsed={
          state.workspace ? layout.prefs.navCollapsed : undefined
        }
        data-content-closed={
          state.workspace ? layout.prefs.contentClosed : undefined
        }
        data-chat-closed={
          state.workspace ? layout.prefs.chatClosed : undefined
        }
        data-active-pane={state.workspace ? state.mobilePane : "workbench"}
        hidden={!state.workspace && !state.standalone}
      >
        {columnItems.map((item) => (
          <Fragment key={item.key}>{item.node}</Fragment>
        ))}
      </div>
      {state.creating && (
        <div
          className="lesson-modal-backdrop"
          role="presentation"
          onClick={() => actions.setCreating(false)}
        >
          <form
            className="lesson-modal lesson-create-form"
            role="dialog"
            aria-modal="true"
            aria-label="新建课件"
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              void actions.run(actions.createLesson);
            }}
          >
            <h3>新建课件</h3>
            <label>
              课件名称
              <input
                value={state.name}
                onChange={(event) => actions.setName(event.target.value)}
                required
                autoFocus
              />
            </label>
            <p
              title={
                state.selectedDirectory
                  ? join(
                      state.selectedDirectory,
                      state.name.trim() || "课件名称",
                    )
                  : undefined
              }
            >
              将创建：
              {state.selectedDirectory &&
                join(state.selectedDirectory, state.name.trim() || "课件名称")}
            </p>
            <div className="lesson-modal-actions">
              <button
                type="submit"
                className="lesson-primary-action"
                disabled={state.busy || !state.name.trim()}
              >
                创建课件
              </button>
              <button
                type="button"
                onClick={() => actions.setCreating(false)}
              >
                取消
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function TabButton({
  tab,
  active,
  onSelect,
  onClose,
}: {
  tab: LessonFileTab;
  active: boolean;
  onSelect(): void;
  onClose(): void;
}) {
  return (
    <span className="lesson-workbench-tab">
      <button
        type="button"
        role="tab"
        title={tab.path}
        aria-selected={active}
        onClick={onSelect}
      >
        <span>{tab.name}</span>
        {tab.dirty && <i aria-label="未保存" title="未保存" />}
      </button>
      <button
        type="button"
        className="lesson-icon-button"
        aria-label={`关闭 ${tab.name}`}
        onClick={onClose}
      >
        ×
      </button>
    </span>
  );
}

/** V3.1 设计稿样式的目录会话行：图标 + 标题，行内 ⋯ 菜单保留分支/删除能力，不带搜索框。 */
function DirectorySessionList({
  owner,
  conversations,
  currentId,
  operation,
  onRecordsChange,
  onDeleted,
  onSelect,
}: {
  owner: ConversationOwner;
  conversations: LessonConversation[];
  currentId?: string;
  operation(request: LessonDesktopRequest): Promise<LessonDesktopResult>;
  onRecordsChange(records: LessonConversation[]): void;
  onDeleted?(ids: string[]): void;
  onSelect(conversation: LessonConversation): void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <ul className="lesson-session-rows">
      {conversations.map((record) => (
        <li
          key={record.conversationId}
          data-active={record.conversationId === currentId}
        >
          <button
            type="button"
            className="lesson-session-row"
            disabled={busy}
            aria-pressed={record.conversationId === currentId}
            onClick={() => onSelect(record)}
          >
            {record.conversationId === currentId ? (
              <span className="lesson-status-dot" aria-hidden="true" />
            ) : (
              <MessageSquare size={14} aria-hidden="true" />
            )}
            <span className="lesson-session-row-title">{record.title}</span>
          </button>
          <details className="lesson-conversation-more">
            <summary aria-label={`${record.title}更多操作`}>···</summary>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void run(async () => {
                  const result = await operation({
                    operation: "branch-conversation",
                    owner,
                    conversationId: record.conversationId,
                  });
                  if (result.conversation)
                    onRecordsChange([...conversations, result.conversation]);
                });
              }}
            >
              创建讨论分支
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    `删除“${record.title}”的对话、任务与日志？删除对话不会删除工作空间或项目中的任何文件。`,
                  )
                )
                  void run(async () => {
                    const result = await operation({
                      operation: "delete-conversation",
                      owner,
                      conversationId: record.conversationId,
                    });
                    const records = result.conversations ?? [];
                    onRecordsChange(records);
                    onDeleted?.(
                      conversations
                        .filter(
                          (item) =>
                            !records.some(
                              (next) =>
                                next.conversationId === item.conversationId,
                            ),
                        )
                        .map((item) => item.conversationId),
                    );
                  });
              }}
            >
              删除应用记录
            </button>
          </details>
        </li>
      ))}
      {error && <li role="alert">{error}</li>}
    </ul>
  );
}
