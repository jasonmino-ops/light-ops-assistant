# ES-DESKTOP-UX-01 / 4-0 Closure Evidence

## Record

| Item | Decision |
| --- | --- |
| Task | ES-DESKTOP-UX-01 / 4-0 Pre-development Audit and P4-1 Boundary |
| Record type | 4-0 closure evidence |
| Status | `4-0 CLOSED` |
| Task level | `L3` — identity / authorization boundary |
| Closure basis | Codex read-only audit, Founder decisions, and Founder-confirmed Independent Review in the current task |
| Production SHA used for development gate | `a4ad7384149b9e4305b4d45437695cfb5b7d820f` |
| Clean development base | `origin/main@9453a34b3509d0fc9578e482b2eba2ea0b1744e2` |
| Release Lineage Gate | `PASS` — Production is an ancestor of clean `origin/main` |

## Reused evidence

- Blueprint and Roadmap remain the governing frozen design assets.
- P2 / P3-B milestone acceptance and field records remain evidence for their already-accepted capabilities; this record does not reopen those milestones.
- The Founder task instruction records the completed Codex 4-0 Audit, completed Claude Independent Review, Founder decisions, and the final P4-1 boundary. No separate Claude artifact was present in the repository baseline, so this record does not invent a file-level review checksum.

## Final 4-0 decisions

1. Reuse `User`, `UserStoreRole`, existing Desktop Activation, POS Authorization, and existing `operatorUserId` writes.
2. Do not add an account system, credential framework, offline PIN cache, inactivity lock, shift system, RBAC, P4-2 approval flow, or Desktop Shell rewrite.
3. Treat the current authorized Desktop device as the legacy OWNER fallback. A current account may become the Desktop operator only after an explicit operator-boundary choice; an ACCOUNT cookie must not silently override the Desktop device principal.
4. Browser `/cashier` keeps its existing ACCOUNT behavior and receives no Operator PIN or boundary UI.
5. Offline CASH remains available. When offline, the new boundary UI does not block operation and there is no offline credential cache or cold-start authentication path.
6. The existing `transactionActorType` / `transactionActorId` fields are historical device-audit fields, not a ready-made Operator identity framework. They are not changed in P4-1.
7. A runtime operator switch is not introduced in the MVP. This avoids switching with an incomplete cart; the user must complete or cancel the current transaction before any later boundary entry.

## P4-1 implementation boundary

### In scope

- Web-only Desktop startup OWNER / STAFF operating boundary.
- Explicit choice between the authorized Desktop device (legacy OWNER) and the currently authenticated active store account (OWNER or STAFF).
- Existing `UserStoreRole` validation and existing `operatorUserId` attribution when the account choice is explicit.
- A server-side environment kill switch: `DESKTOP_OPERATOR_BOUNDARY_ENABLED=0` restores legacy server authorization behavior.
- Focused unit / contract / build validation and post-change independent review.

### Out of scope

- Per-employee PIN persistence, PIN enrollment, PIN reset, lockout, or offline verification; these are P4-1B candidates.
- Schema, migration, `DesktopActivationPin` reuse, new session/token framework, Cashier rewrite, Desktop Shell changes, printing, display assignment, CustomerOrder alignment, RC9 / RC10, and P4-2.
- Runtime Lock/Switch, cart handover, shift transfer, transaction reassignment, or any claim of complete independent employee attribution.

## Entry decision

`4-0 CLOSED`. The narrow Web-only P4-1 implementation may proceed on the isolated `codex/*` branch under the existing Founder-Gated L3 workflow. Any protected Cashier path, schema, migration, Desktop Shell, or authentication-framework expansion is outside this decision and requires a new exact gate; the complexity stop rule applies immediately.
