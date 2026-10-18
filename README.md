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
- **The chat title** gets the same icon. It updates when you send your next message.
- **`/chat-todo`** opens this chat's task list, where you can mark tasks done, skip them or reopen them.
- **`/chat-tasks`** opens an overview of every chat that has tasks, each with its icon and what's left.

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
- Tasks are stored locally, per chat, in the plugin's own store. Nothing is sent anywhere.
- Mods use Claude Code's early-access function hooks API, which may change between releases.
