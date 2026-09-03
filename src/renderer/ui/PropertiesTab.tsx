import { usePropertiesContext } from './properties/PropertiesContextAdapter'
import { PropertiesPanelRouter } from './properties/PropertiesPanelRouter'

export function PropertiesTab({ onReplaceImage }: { onReplaceImage(): void }) {
  const context = usePropertiesContext({ onReplaceImage })
  return <PropertiesPanelRouter context={context} />
}
