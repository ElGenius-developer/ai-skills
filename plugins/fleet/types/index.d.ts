export type FleetJob = {
  id: string
  lane: string
  cd: string | null
  outDir: string | null
  startedAt: number
  /** When the Bash call returned; null while it waits, e.g. on a permission prompt. */
  launchedAt: number | null
  status: string
  touched: number | null
  finishedAt: number | null
}

declare module 'claude-code' {
  interface PluginState {
    fleet: { jobs: FleetJob[]; now: number }
  }
}
