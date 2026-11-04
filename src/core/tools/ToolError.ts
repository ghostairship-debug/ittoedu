export class ToolError extends Error {
  constructor(readonly code: string, message: string, readonly data?: unknown) { super(message) }
}
