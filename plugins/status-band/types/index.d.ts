export type StatusBandVerify = 'pass' | 'fail' | null
export type StatusBandContext = { tokens: number; window: number }
export type StatusBandGit = { branch: string; behind: number | null; base: string | null; pr: { number: number; ci: 'pass' | 'fail' | 'pending' | null } | null }

declare module 'claude-code' {
  interface PluginState {
    'status-band': { edited: string[]; verify: StatusBandVerify; costUsd: number | null; context: StatusBandContext | null; git: StatusBandGit | null }
  }
}
