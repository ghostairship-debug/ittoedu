/** Repository Skills are the source of courseware authoring methods. The
 * capability generator bundles these named entries and their references. */
export const courseAgentMethodSkills = [
  { name: 'orchestrate-courseware' },
  { name: 'build-courseware-project' },
  { name: 'edit-content' },
  { name: 'office-content' },
  { name: 'research-and-report' },
  { name: 'data-and-report' },
] as const

/** Shared product usage is independently readable; it is not a content method prerequisite. */
export const courseAgentBundledSkills = [
  ...courseAgentMethodSkills,
  { name: 'workbench-usage' },
] as const
