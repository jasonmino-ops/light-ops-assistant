# EP-MB3-06A Cloud Desktop Activation Identity Final Freeze Record V1.0

## Freeze Status

FINAL FROZEN

Freeze date: 2026-07-17

## Repository Evidence

- baseline: `cf9b44faa172769ef46945d24a8208bdbb003713`
- implementation commit: `8bfa470a7d2a8cccca6d20823d75c6c581b81ca4`
- blocking fix commit: `f6e27b037035b95f5ca39f0fda94426fc84392cd`
- acceptance record commit: `319f16275af1408e5c512f2ac697b1942ca274b0`
- merge commit on `main`: `add0f85da4e057bd3865e8344580e56bc25052f2`
- final freeze commit: tag target of `ep-mb3-06a-cloud-desktop-activation-v1.0-final`
- feature branch: `feat/ep-mb3-06a-cloud-desktop-activation`
- target branch: `main`

## Acceptance Evidence

- acceptance record: `docs/milestone-b/EP-MB3-06A Cloud Desktop Activation Identity Acceptance Record V1.0.md`
- review manifest: `docs/milestone-b/ep-mb3-06a-review-evidence/REVIEW-MANIFEST.md`
- final acceptance evidence: `docs/milestone-b/ep-mb3-06a-review-evidence/FINAL-ACCEPTANCE-FREEZE.md`
- acceptance result: ACCEPTED
- final gate: PASS

## Main CI Evidence

- workflow: `cloud-ci`
- branch: `main`
- run ID: `29582806072`
- run URL: `https://github.com/jasonmino-ops/light-ops-assistant/actions/runs/29582806072`
- commit: `add0f85da4e057bd3865e8344580e56bc25052f2`
- result: SUCCESS
- job: `cloud` SUCCESS

The main CI job completed all required steps successfully:

- dependency install
- Prisma validate
- Prisma generate
- current schema applied to temporary PostgreSQL with `db push --force-reset`
- type check
- EP-MB3-06A unit and static tests
- EP-MB3-06A real database activation and concurrency tests
- relevant regression tests
- production build

## Frozen Scope

The following EP-MB3-06A Cloud Desktop Activation Identity semantics are frozen:

- `DesktopDevice` core semantics
- `DesktopActivationPin` core semantics
- `DesktopActivationAudit` core semantics
- opaque Desktop device token format and one-time raw-token return
- hash-only server storage for device tokens and activation PINs
- token expiry, revocation, and rotation
- `tokenHashVersion` as the token hash algorithm/key-format version
- `tokenVersion` as the device credential rotation version, externally exposed only as `credentialVersion`
- activation PIN lifecycle: 6 digit PIN, 24 hour expiry, single use, 5 failure limit, 15 minute lock
- activation PIN create and revoke APIs
- public activation API
- device token verify API
- device status API
- device list API
- device revoke API
- tenant/store/device isolation
- no `storeCode` fallback after activation
- legacy POS compatibility boundary
- activation audit creation and redacted audit metadata
- subscription access semantics for `TRIAL`, `ACTIVE`, `EXPIRED`, and `CANCELLED`
- real database activation invariants
- real database concurrency invariants

## Frozen API Contract

Frozen API contract:

- `docs/milestone-b/EP-MB3-06A-CLOUD-DESKTOP-ACTIVATION-API-CONTRACT.md`

EP-MB3-06B and later Desktop Runtime work may depend on this contract. They must not silently alter the 06A Cloud identity contract.

## Change Control

The following changes are prohibited unless a new CTO-approved package explicitly reopens EP-MB3-06A:

- changing Desktop device tokens to JWT or other self-contained token formats
- persisting full raw device tokens server-side
- reusing old POS tokens as Desktop device credentials
- reusing `BindToken` for Desktop activation identity
- adding post-activation `storeCode` authorization fallback
- cancelling or weakening device revocation semantics
- restoring a `REVOKED` device to active status without an explicit new approved flow
- allowing silent cross-store rebinding for an existing installation
- changing `tokenHashVersion` semantics
- changing `tokenVersion` or `credentialVersion` rotation semantics
- treating `DesktopDevice` as a staff/user identity
- binding activation to a remote Web page implementation instead of the Cloud Desktop identity contract
- changing tenant/store/device isolation rules
- weakening raw token, raw PIN, or audit/log redaction guarantees

## Explicit Non-Goals

EP-MB3-06A final freeze does not include:

- Electron implementation
- Runtime Core changes
- Provider changes
- printing
- scanning
- dual screen runtime
- payment terminal integration
- historical migration drift repair
- legacy Web POS authorization replacement
- EP-MB3-06B implementation

## Next Package

The next authorized package is:

- EP-MB3-06B - Desktop Activation Runtime

EP-MB3-06B may start only after the final freeze commit is pushed to `main` and the final freeze tag is pushed to origin.

## Final Freeze Tag

- tag: `ep-mb3-06a-cloud-desktop-activation-v1.0-final`
- tag type: annotated
- tag target: final freeze commit on `main`

## Result

EP-MB3-06A Cloud Desktop Activation Identity is accepted, merged to `main`, verified by main Cloud CI, and frozen for downstream Desktop Runtime work.
