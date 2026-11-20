export type FleetJob = {
  id: string
  lane: string
  cd: string | null
  outDir: string | null
  startedAt: number
  status: string
  touched: number | null
  finishedAt: number | null
}

declare module 'claude-code' {
  interface PluginState {
    fleet: { jobs: FleetJob[]; now: number }
  }
}
