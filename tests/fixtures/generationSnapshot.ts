// Browser/Vite snapshot dependencies (including ?raw capability sources) stay
// separate from the Node-enumerable controller/archive fixture.
import { captureGenerationSnapshot } from '../../src/renderer/authoring/generation/generationSnapshot'
import { withDefaultComponentController } from '../../src/renderer/components/teacherControllerComponent'

export function captureGenerationFixture(input: Parameters<typeof captureGenerationSnapshot>[0]) {
  return captureGenerationSnapshot({ ...input, componentPackages: { ...withDefaultComponentController(input.document).componentPackages, ...input.componentPackages } })
}
