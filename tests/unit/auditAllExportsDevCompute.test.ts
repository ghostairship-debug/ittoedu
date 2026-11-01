// @vitest-environment node
// Browser-worker policy tests retired with Pyodide. Native process behavior is
// covered by nativePythonCompute20261030 and nativePythonRuntime20261030.
import { expect, it } from 'vitest'
import { pythonEnvironment } from '../../src/main/workbench/compute/nativePythonProcess'
it('native Python inherits OS basics without provider credentials', () => {
  const key='GUOLING_TEST_PROVIDER_SECRET'; process.env[key]='private'
  try { expect(pythonEnvironment()[key]).toBeUndefined(); expect(pythonEnvironment({GUOLING_INPUT_DIR:'input'}).GUOLING_INPUT_DIR).toBe('input') }
  finally { delete process.env[key] }
})
