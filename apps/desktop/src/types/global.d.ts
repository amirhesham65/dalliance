interface Window {
  /** Set by electron/preload.ts. Undefined when the UI runs in a plain browser or in tests. */
  ilios?: import('@ilios/shared/ipc').IliosApi
}
