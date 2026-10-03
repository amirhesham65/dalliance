import type { UpdateView } from '@dalliance/shared/ipc'

/**
 * The latest release in the public releases repo, which the release workflow publishes to. Its `latest-mac.yml` is
 * the file electron-updater will read once releases are signed. See docs/releasing.md.
 */
export const RELEASES = 'https://github.com/amirhesham65/dalliance-releases/releases/latest/download'
/** The website's download, which always serves the newest DMG. `from` tells the download log where the click came from. */
export const DOWNLOAD_PAGE = 'https://dalliance.io/download?from=update'
/** How often a running app looks again, for a window left open for days. */
const CHECK_EVERY = 6 * 60 * 60 * 1000

interface UpdatesDeps {
  /** The running app's version. */
  version: string
  open: (url: string) => Promise<void>
  fetch?: typeof fetch
}

/**
 * Looks for a newer release. Releases are ad-hoc signed, so the app can't install one itself: a newer version is
 * offered as a download, and the user drags it over the old app. See docs/releasing.md.
 */
export class Updates {
  private found: UpdateView | null = null
  private readonly listeners = new Set<(update: UpdateView) => void>()
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly deps: UpdatesDeps

  constructor(deps: UpdatesDeps) {
    this.deps = deps
  }

  get current(): UpdateView | null {
    return this.found
  }

  onChange(listener: (update: UpdateView) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Checks now and then every few hours, until `stop()`. */
  start() {
    void this.check()
    this.timer ??= setInterval(() => void this.check(), CHECK_EVERY)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Reads the latest release's version. A failure keeps what was found before, and the next check tries again. */
  async check(): Promise<UpdateView | null> {
    try {
      const res = await (this.deps.fetch ?? fetch)(`${RELEASES}/latest-mac.yml`, { signal: AbortSignal.timeout(15_000) })
      // A release from before the update files existed has none, which counts as nothing newer
      if (!res.ok) return this.found
      const version = releaseVersion(await res.text())
      if (version && isNewer(version, this.deps.version) && version !== this.found?.version) {
        const update = { version }
        this.found = update
        this.listeners.forEach((listener) => listener(update))
      }
    } catch (err) {
      console.warn('Update check failed:', err instanceof Error ? err.message : err)
    }
    return this.found
  }

  download(): Promise<void> {
    return this.deps.open(DOWNLOAD_PAGE)
  }
}

/** The `version` line of a `latest-mac.yml`, or null when it has none. */
export function releaseVersion(yml: string): string | null {
  return /^version:[ \t]*['"]?([^\s'"]+)/m.exec(yml)?.[1] ?? null
}

/** True when `candidate` is a later x.y.z than `current`. Anything else, such as a pre-release, is never offered. */
export function isNewer(candidate: string, current: string): boolean {
  const a = semver(candidate)
  const b = semver(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return false
}

function semver(version: string): number[] | null {
  return /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version)?.slice(1).map(Number) ?? null
}
