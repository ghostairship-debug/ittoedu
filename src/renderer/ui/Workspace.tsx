import type { ImportedImageAsset } from '../project/assetManager'
import { FlowWorkspaceConnector } from './workspaces/FlowWorkspaceConnector'
import { SlideWorkspaceConnector } from './workspaces/SlideWorkspaceConnector'
import { SpatialWorkspaceConnector } from './workspaces/SpatialWorkspaceConnector'
import { useWorkspaceRoute } from './workspaces/WorkspaceRouteContext'

interface WorkspaceProps {
  onAddImage(x?: number, y?: number): void
  onAddVideo(x?: number, y?: number): void
  onSelectImageAsset(): Promise<ImportedImageAsset | null>
}

export function Workspace({
  onAddImage,
  onAddVideo,
  onSelectImageAsset,
}: WorkspaceProps) {
  const route = useWorkspaceRoute()
  if (route.kind === 'conflict') {
    return (
      <main className="workspace" data-testid="workspace-route-conflict" role="alert">
        <p className="property-hint">{route.message}</p>
      </main>
    )
  }
  if (route.kind === 'flow') return <FlowWorkspaceConnector />
  if (route.kind === 'spatial') return <SpatialWorkspaceConnector />
  return (
    <SlideWorkspaceConnector
      onAddImage={onAddImage}
      onAddVideo={onAddVideo}
      onSelectImageAsset={onSelectImageAsset}
    />
  )
}
