/**
 * The bridge contract lives in `@shared/api` so the renderer and the preload
 * script cannot drift apart. This file only re-exports it.
 */
export type {
  AppInfo,
  FilePickerOptions,
  GabiApi,
  InstallContentRequest,
  InstanceDetail,
  RecordingInfo,
  RecordingRequest,
  RepairReport,
  ScreenshotInfo,
  Unsubscribe,
  WorldInfo
} from '../shared/api'

import '../shared/api'
