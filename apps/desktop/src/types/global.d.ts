interface Window {
  /** Set by electron/preload.ts. Undefined when the UI runs in a plain browser or in tests. */
  dalliance?: import('@dalliance/shared/ipc').DallianceApi
}
