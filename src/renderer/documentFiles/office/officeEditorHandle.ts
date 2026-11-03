/** Shared only at the workbench lifecycle boundary; each format owns its edit model. */
export interface OfficeEditorHandle {
  flush(): Promise<boolean>
}
