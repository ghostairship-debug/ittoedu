import type { ProjectPlaybackSettings } from './types'

/** controls:none controls authored nodes, not the host safety policy. */
export function hostNavigationExplicitlyHidden(settings?: Pick<ProjectPlaybackSettings, 'hostNavigation'>): boolean {
  return settings?.hostNavigation === 'intentionally-hidden'
}
