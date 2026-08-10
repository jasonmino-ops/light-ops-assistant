# Browser Sandbox Handoff

`native-task-client.ts` is an isolated Phase 1 adapter. No production page
imports it, so the existing print action and production printing routes remain
unchanged.

In the iOS Shell, the caller hands the already-generated ESC/POS `Uint8Array`
to:

```ts
submitSandboxPrintTask(existingCommandStream, '192.168.18.49')
```

The adapter only base64-serializes the same bytes into Native Task Contract V1,
calls `window.eshopMobileRuntime.submitTask`, and correlates the returned
`taskId`. It does not render, encode, edit, append, or inspect print commands.
