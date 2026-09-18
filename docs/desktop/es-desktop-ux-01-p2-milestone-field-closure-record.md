# ES-DESKTOP-UX-01 / P2 — Milestone FIELD Closure Record

Status: ACCEPTED / FIELD VERIFIED

This record supersedes the earlier P2 milestone record that was held only for the
authenticated Browser smoke. It records the Founder-provided Browser evidence and
does not alter the P2 implementation.

## Identity

- Task: `ES-DESKTOP-UX-01-P2-CASHIER-MINIMAL-SIMPLIFICATION`
- Trusted source accepted: `db56bb9035afd74c28d26df42a7f7de89843bbce`
- Corrective Web source: `origin/main@a4ad7384149b9e4305b4d45437695cfb5b7d820f`
- Production Web deployment: `dpl_BpXKJ7reu5rMQfDunbc52ix46zs8`
- Desktop Shell: `0.2.0-pilot.2`
- Desktop Candidate: `9c78dbf6e715182e74a411e1951918a8fe060274`
- Installer SHA-256: `8d6d540db011f604c280dad1f8ae7ca09799072d46883930c94b9b93998893c2`
- FIELD machine: `V727 / PC-20260119FZUI`

## Exit Gate

| Requirement | Evidence | Result |
|---|---|---|
| Desktop hides “安装到电脑” | Founder visual FIELD | PASS |
| Desktop hides “打开顾客屏” | Founder visual FIELD | PASS |
| Desktop hides technical cache detail | Founder visual FIELD | PASS |
| Desktop preserves language | Founder visual FIELD | PASS |
| Desktop preserves management center | Founder visual FIELD | PASS |
| Desktop preserves exit-fullscreen control | Founder visual FIELD | PASS |
| Desktop preserves offline status | Founder visual FIELD | PASS |
| Desktop preserves pending-sync count | Founder visual FIELD | PASS |
| Browser retains “安装到电脑” | Authenticated Browser smoke | PASS |
| Browser retains “打开顾客屏” and it is usable | Authenticated Browser smoke | PASS |
| Browser customer-display fallback | Authenticated Browser smoke | PASS |
| Cashier main flow | V727 real order | PASS |
| Offline/sync semantics | Source and regression evidence | PASS / unchanged |
| POS authorization and Activation | Existing accepted regression evidence | PASS / unchanged |
| P1A regression | Existing accepted regression evidence | PASS |
| P1B implementation | Existing frozen bytes | unchanged |
| Printing boundary | Existing contract evidence | unchanged |
| Visual redesign absent | Source review | PASS |

## Final semantics

- P2 Source Accepted: `YES`
- P2 Milestone FIELD: `PASS`
- P2 FIELD Verified: `YES`
- P2 Milestone Acceptance: `ACCEPTED`
- P2 Final Frozen: `NO`
- P2 product Closed: `NO / not asserted`

The milestone acceptance is closed as an evidence decision. A separate product
Freeze Record was not authorized in this task, so this record does not manufacture
`FINAL FROZEN` or `CLOSED`.
