# Repository overview

Next.js App Router Ops POST authenticates via getFkBackedOpsAdminIdentity, scopes an ACTIVE Store and validates same-origin JSON/explicit confirmation before parseOpsV3QueueRecoveryCommand. runOpsV3QueueRecovery rechecks ACTIVE actor and all recovery safety facts in the existing Serializable control-plane row lock. OperationLog provides append-only successful REVIEW/EXPIRE evidence; no grant schema or mutable reset field.

New dedicated compensation REVIEW verifies compiled exact-case policy + original audit + fresh capture/identity/jobs before appending one grant audit. Matching compensation EXPIRE revalidates both original and new evidence then uses the unchanged ca7 batch CAS + mandatory SUCCESS audit. Current route dispatch already accepts the extended parser output, so no route/UI/auth change is necessary. New actions never finalize, acquire ownership, materialize held work or print. Old grant/action paths remain separate.

Runtime ownership, device batch issuance, actual claim/REPORT and held materialization remain in unchanged lib/v3-print-control-plane.ts and lib/v3-print-job-adapter.ts. Physical Runtime/Provider/FRONT device is not modified or exercised in this candidate. Future authorized recovery must refresh all eligible backlog, role, TTL and execution evidence; no artificial quantity cap.
