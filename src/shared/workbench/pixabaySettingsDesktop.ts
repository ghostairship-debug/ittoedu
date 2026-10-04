import { z } from 'zod'

export const pixabaySettingsRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('read') }).strict(),
  z.object({ type: z.literal('save-key'), key: z.string().trim().min(1).refine(value => !/[\r\n\x00]/.test(value)).nullable() }).strict(),
])

/** Status only: neither the user key nor the build-supplied key crosses back to the renderer. */
export interface PixabaySettingsView {
  hasUserKey: boolean
  hasDefaultKey: boolean
  secureStorageAvailable: boolean
}

export interface PixabaySettingsAPI {
  read(): Promise<PixabaySettingsView>
  /** null removes the override and restores the build-supplied default, if present. */
  saveKey(key: string | null): Promise<PixabaySettingsView>
}
