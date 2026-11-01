import type { AcpConfigurationControl, AcpSelectValue } from '../../../../shared/workbench/acp';
import type { AcpConfigOption } from './AcpAgentSession';

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Render only supported controls while preserving Agent order, IDs, current values and labels. */
export function acpConfigurationControls(options: AcpConfigOption[]): AcpConfigurationControl[] {
  const flatten = (values: unknown[], group?: string): AcpSelectValue[] => values.flatMap(value => {
    const entry = record(value);
    if (Array.isArray(entry.options)) return flatten(entry.options, typeof entry.name === 'string' ? entry.name : typeof entry.group === 'string' ? entry.group : group);
    if (typeof entry.value !== 'string') return [];
    return [{ value: entry.value, name: typeof entry.name === 'string' ? entry.name : entry.value,
      description: typeof entry.description === 'string' ? entry.description : undefined, group }];
  });
  return options.flatMap<AcpConfigurationControl>(option => {
    const common = { id: option.id, name: typeof option.name === 'string' ? option.name : option.id,
      description: typeof option.description === 'string' ? option.description : undefined, category: option.category };
    if (option.type === 'boolean' && typeof option.currentValue === 'boolean') return [{ ...common, type: 'boolean', currentValue: option.currentValue } satisfies AcpConfigurationControl];
    if ((option.type === 'select' || option.type === undefined) && typeof option.currentValue === 'string') {
      return [{ ...common, type: 'select', currentValue: option.currentValue, options: flatten(option.options ?? []) } satisfies AcpConfigurationControl];
    }
    return [];
  });
}
