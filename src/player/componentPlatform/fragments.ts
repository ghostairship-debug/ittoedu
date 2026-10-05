/** Runtime state only; the source HTML and its fragment classes remain author data. */
export const componentFragmentStateKey = (instanceId: string): string => `__component.fragment.${instanceId}`
