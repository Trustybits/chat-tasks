export type TaskKind = 'required' | 'recommended' | 'optional'
export type TaskStatus = 'open' | 'done' | 'skipped'
export type TaskSource = 'chat' | 'plan' | 'steps'
export type Task = {
  id: string
  title: string
  kind: TaskKind
  status: TaskStatus
  note?: string
  source?: TaskSource
}
/** A task list several chats can join; kept in the plugin's store as `plan:<name>`. */
export type SharedPlan = {
  name: string
  title: string
  tasks: Task[]
  /** sessionId → that chat's title */
  members: Record<string, string>
  updatedAt: number
}
/** Which plan a chat is on; kept in the store as `chat:<sessionId>`. */
export type ChatRecord = {
  sessionId: string
  title: string
  cwd: string
  plan: string
  updatedAt: number
}
/** One step of the desktop app's step list, mirrored to a task by id. */
export type Step = { id: string; phase: 'pending' | 'in_progress' | 'completed' }

declare module 'claude-code' {
  interface PluginState {
    'chat-tasks': {
      plan: SharedPlan | null
      plans: SharedPlan[]
      steps: Step[]
      title: string
      /** The icon last written into the sidebar title, so it is renamed only on change. */
      shownIcon: string
    }
  }
}
