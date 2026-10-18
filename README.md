# chat-tasks

A Claude Code mod that keeps a task list for each chat, so you can see at a glance whether a chat still has work to do instead of asking it.

Claude records the steps it identifies as it works, sorted into three kinds:

- **Required**: part of what you asked for. The chat isn't finished until these are done.
- **Recommended**: follow-ups Claude advises, such as tests, cleanup or a fix it noticed.
- **Optional**: nice-to-haves you can ignore.

## What you see

- **A band above the prompt** with the chat's status and a **Tasks** button:
  - `●` required work is left
  - `◐` only recommended or optional tasks are left
  - `✓` everything is done or skipped
- **The chat's title in the desktop app's chat list** gets the same icon, updated as soon as the status changes. (In a terminal, the title picks it up when you send your next message.)
- **`/chat-todo`** opens this chat's task list, where you can mark tasks done, skip them or reopen them.
- **`/chat-tasks`** opens an overview of every plan, with its icon, what's left and the chats on it.

## Plans are picked up automatically

- **Plan mode:** when you approve a plan, its numbered steps (or its top-level bullets) become required tasks. A chat with no tasks yet names its plan after the plan's heading.
- **The desktop app's step list:** each step Claude shows under its message becomes a required task, and is checked off as the step is.

## Shared plans

A chat's list is a plan with a short name (shown in `/chat-tasks` and at the top of `/chat-todo`). Other chats can join it:

- `/chat-todo join <plan-name>`, or the **join** button in `/chat-tasks`, or just ask Claude to work on that plan.
- Every chat on a plan sees the same tasks. When one marks a task done, the others' bands and titles update within a few seconds.
- `/chat-todo leave` takes the chat off the plan; its next task starts a new one.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install chat-tasks --marketplace trustybits/chat-tasks
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every chat).

From a shell:

```
claude plugin install chat-tasks --marketplace trustybits/chat-tasks
```

In the Claude desktop app: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `trustybits/chat-tasks`, then **Add plugin**.

New chats pick it up. A chat that was already open needs `/reload-plugins`.

## Notes

- The mod adds a short instruction to the system prompt telling Claude to keep the list current, which adds a little to each request.
- Plans are stored locally in the plugin's own store, shared by the chats on this computer. Nothing is sent anywhere.
- If two chats change the same plan at the same instant, the later save wins.
- Renaming a chat whose title you set yourself asks you to approve the new title in the desktop app.
- Mods use Claude Code's early-access function hooks API, which may change between releases.
