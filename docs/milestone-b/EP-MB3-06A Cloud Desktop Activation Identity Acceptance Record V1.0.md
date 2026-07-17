# EP-MB3-06A Cloud Desktop Activation Identity Acceptance Record V1.0

## Acceptance Conclusion

ACCEPTED

Acceptance date: 2026-07-17

## Scope Accepted

- `DesktopDevice`
- `DesktopActivationPin`
- `DesktopActivationAudit`
- opaque Desktop device token
- HMAC token/PIN hash
- token expiry, revocation, and rotation
- PIN lifecycle
- activate, verify, and status APIs
- device list and revoke APIs
- tenant/store/device isolation
- subscription access
- no storeCode fallback after activation
- legacy POS isolation
- real database activation and concurrency tests
- Cloud CI

## Repository Evidence

- baseline: `cf9b44faa172769ef46945d24a8208bdbb003713`
- implementation commit: `8bfa470a7d2a8cccca6d20823d75c6c581b81ca4`
- fix commit: `f6e27b037035b95f5ca39f0fda94426fc84392cd`
- accepted HEAD: `f6e27b037035b95f5ca39f0fda94426fc84392cd`
- branch: `feat/ep-mb3-06a-cloud-desktop-activation`
- merge-base: `cf9b44faa172769ef46945d24a8208bdbb003713`
- workspace before acceptance record: clean
- remote sync before acceptance record: `0 0`

## Independent Review Evidence

- Initial Independent Review: FAIL
- Critical finding: audit metadata key `tokenHashVersion` triggered sensitive-key rejection and blocked successful activation.
- Minimum blocking fix commit: `f6e27b037035b95f5ca39f0fda94426fc84392cd`
- Targeted Re-Review: CONDITIONAL PASS
- Only condition: independent remote CI confirmation.
- CI condition: closed by `cloud-ci` run `29580968329`.
- Final Gate: PASS

## CI Evidence

- workflow: `cloud-ci`
- run ID: `29580968329`
- commit: `f6e27b037035b95f5ca39f0fda94426fc84392cd`
- result: SUCCESS
- job: `cloud` SUCCESS

## Accepted Risks

These are accepted non-blocking observations and are not Acceptance blockers:

- catch-all currently returns redacted client errors without a dedicated sanitized server-side error log.
- PIN HMAC comparison has not been moved to `timingSafeEqual`.
- device revoke row lock order remains a low-risk observation.
- historical migration drift is pre-existing and not fixed by EP-MB3-06A.
- production deployment must configure both Desktop secrets: `DESKTOP_DEVICE_TOKEN_SECRET` and `DESKTOP_ACTIVATION_PIN_SECRET`.

## Compatibility Boundary

- EP-MB3-06A does not replace old Web POS authorization.
- EP-MB3-06A does not reuse BindToken.
- Post-activation device APIs do not allow storeCode fallback.
- EP-MB3-06A does not touch Runtime Core or Provider.
- EP-MB3-06B may depend only on the frozen 06A API Contract and accepted Cloud identity semantics.
- Remote Web POS remains a transition interface.
