import { z } from 'zod'

/** Read-only menu metadata. Reading a Skill still belongs to the frozen task. */
export const skillCatalogRequestSchema = z.object({ workspaceDirectory: z.string().min(1).max(32767).optional() }).strict()
export interface SkillCatalogEntry { name: string; description: string; source?: 'user' | 'workspace' }
export interface SkillCatalogView { entries: readonly SkillCatalogEntry[]; warnings: readonly string[] }
export type SkillCatalogAPI = (input: { workspaceDirectory?: string }) => Promise<SkillCatalogView>
