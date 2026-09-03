export const APP_NAME = '互动课件编辑器'
export const APP_PRODUCT_NAME = 'ittoedu Courseware Editor'
export const APP_COMPANY = 'ittoedu'
export const APP_ID = 'com.ittoedu.courseware-editor'
export const APP_EXECUTABLE_NAME = 'ittoedu-courseware-editor'
export const APP_USER_DATA_DIRECTORY_NAME = APP_EXECUTABLE_NAME
export const APP_PREVIEW_TEMP_DIRECTORY_NAME = `${APP_EXECUTABLE_NAME}-preview`
export const APP_PDF_TEMP_FILE_PREFIX = 'ittoedu-courseware-pdf-'
export const APP_E2E_TEMP_DIRECTORY_NAME = `${APP_EXECUTABLE_NAME}-e2e`
export const APP_VERSION = '1.0.0'
export const CANVAS_WIDTH = 1280 as const
export const CANVAS_HEIGHT = 720 as const
export const RUNTIME_API_VERSION = 2 as const
export const RUNTIME_AUTHORING_API_VERSION = 1 as const
export const COMPONENT_SCHEMA_VERSION = 4 as const
export const COMPONENT_RUNTIME_API_VERSION = 4 as const
export const MAX_HISTORY_STEPS = 50
/** Product guidance only; projects remain valid beyond this point. */
export const RECOMMENDED_PROJECT_SCENES = 200
/** Defensive corruption/abuse guard, not a normal course-authoring limit. */
export const MAX_PROJECT_SCENES = 1000
/** Product guidance only; component-heavy scenes usually stay well below this. */
export const RECOMMENDED_SCENE_NODES = 250
/** Defensive corruption/abuse guard, not a normal scene-authoring limit. */
export const MAX_SCENE_NODES = 1000
/** Defensive guard for authored presentation states inside one scene. */
export const MAX_SCENE_PRESENTATION_STATES = 100
export const MIN_NODE_SIZE = 16
export const MIN_VISIBLE_NODE_EDGE = 20
export const SUPPORTED_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
] as const
export const SUPPORTED_AUDIO_MIME_TYPES = [
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/mp4',
] as const
export const SUPPORTED_VIDEO_MIME_TYPES = [
  'video/mp4',
  'video/webm',
] as const
