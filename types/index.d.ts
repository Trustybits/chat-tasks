export type TaskKind = 'required' | 'recommended' | 'optional'
export type TaskStatus = 'open' | 'done' | 'skipped'
export type Task = {
  id: string
  title: string
  kind: TaskKind
  status: TaskStatus
  note?: string
}
export type ChatSummary = {
  sessionId: string
  title: string
  cwd: string
  tasks: Task[]
  updatedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'chat-tasks': { tasks: Task[]; chats: ChatSummary[]; title: string }
  }
}
