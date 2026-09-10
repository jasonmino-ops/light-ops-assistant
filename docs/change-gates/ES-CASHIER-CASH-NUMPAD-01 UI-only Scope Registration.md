# ES-CASHIER-CASH-NUMPAD-01 — UI-only Exact Scope Registration

Founder-approved activation for Cash Touch Numpad + KHR Conversion Helper V0.1. Old Five-field Plan = ABANDONED.

## Authorization and baseline

The current Founder MINIMAL GOVERNANCE ACTIVATION APPROVED decision authorizes only this document and exceptions/ES-CASHIER-CASH-NUMPAD-01.json entering the latest main, plus automatic governance-only Production deployment. It also authorizes the accepted feature Candidate push to codex/es-cashier-cash-numpad-01 and its automatic Preview. It does not authorize feature merge to main, Production business deployment, database migration, final freeze or closure. No Cashier business code is included in this governance commit.

Governance registration base: f3e5bc22664b51fc92aa3447c0df39d46fc4bdde. The original sealed draft base was b0a386ada6af2943644ea5d986027f0dfda1e74c; the protected Cashier base content is unchanged on the refreshed main. Release Lineage Gate was checked against the live Production SHA before activation. The final feature Candidate must use the activated latest origin/main as its base and repeat lineage, Scope, tests, TypeScript, build and review. No docs-only lineage exemption is used for this runtime task.

## Exact content authorization

L3 protected Cashier task. PRE_COMMIT_CONTENT_SHA256; ACTIVE trusted origin/main record; one exact feature branch; no directory, wildcard, authorizedCommits or Guard/config changes. All four required paths are hash-bound, including three ordinary paths. The registration becomes effective only when the Guard verifies the trusted main record, unchanged local registration/config, branch, base ancestry and exact content.

- app/cashier/page.tsx — `fb4dca2530a8a99bd41ed2eb0c36b8a6c3255b47be92427fa0201066f020a825`
- app/components/CashTenderPanel.tsx — `08b6ed3fb00c6071353cb3c06fc0e7fb40de7950f88dcd0e23dac817d08536f1`
- tests/cash-helper.test.ts — `1c4122a6d43df17dcbfb1f339aabe0ab64ccd3cf80924048af94879fbf8cc9f0`
- tests/cash-numpad.browser.spec.ts — `4ef66ded0c6f09891686df875a89533cd5cb64cdb75d92b4c69e642eed2031da`

Sealed manifest SHA-256: `f23144a7472a6c113227c4c277b88a15cd098b1aa3acc5fd42a5b29c1cf4a74b`. Sealed patch SHA-256: `8983959f369c8d97102dac1b80647b93d876f52e1be9d1e26708e7567f1b8684`. The local evidence packet is .task-state/ES-CASHIER-CASH-NUMPAD-01-ui-only. Source draft bytes remain immutable; this approved four-path registration supersedes its proposed one-protected-path governance draft. Prior five-field patches and hashes are abandoned and grant no permission.

## Behavior and boundaries

The UI uses existing cashTendered and an ephemeral cashInputCurrency. USD stores get a local touch numpad with physical keyboard/mouse support, clear/backspace, and local scanner/Enter focus isolation. Currency and tender reset on existing cancel, cart, payment-method and store transitions. XAF retains the existing cash input.

KHR is an integer-only conversion/change helper with thousands formatting. USD cents use the existing two-decimal order boundary; nonnegative half-up KHR rounding is (cents * rate + 50) / 100 using integer arithmetic. At 4100: USD7.30 corresponds to KHR29,930; received30,000 gives70 change; received50,000 gives20,070. USD10 givesUSD2.70. Insufficient tender cannot confirm. The UI explicitly states the sale is recorded in USD.

Reuse the existing single DEFAULT_KHR_RATE=4100 and cashier:usdKhrRate device localStorage reader/editor. No live FX service, Store setting or new persistence. Existing handleSubmit, API request, offline storage contract and printing chain remain unchanged. No schema, migration, PaymentIntent, SaleRecord, Store, formal KHR payment currency, reports, printing/Network Print/QZ/Desktop/KHQR, dependency or unrelated edits.

## Validation and stopping point

After activation, revalidate the trusted registration and apply only the accepted four-file bytes. Run the actual task Scope Guard, 29 amount/interaction unit tests, 10 localhost browser tests, relevant Cashier regressions, TypeScript, Production Build and independent fresh-context read-only review. Browser tests use mocked localhost APIs and simulated input; they do not establish Windows Touch/Pad FIELD verification. No database migration is part of validation.

Commit and push only the verified feature Candidate; automatic Preview is permitted. Stop for Founder real-device acceptance. Feature FIELD VERIFIED, PRODUCTION DEPLOYED, MERGED TO MAIN, FINAL FROZEN and CLOSED remain NO. Close this ACTIVE exception only after a separately authorized future feature merge. External Claude remains prohibited; use independent Codex review.
