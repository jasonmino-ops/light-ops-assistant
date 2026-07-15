# EP-MB2-02 Module Responsibility

## Runtime Modules

`deviceIdentity.ts`

- Owns physical device identity values derived from provider-local identity.
- Does not model hardware bus facts such as VID, PID, COM, or driver identity.

`deviceSlot.ts`

- Owns runtime slot references passed into Device Runtime.
- Does not define or persist Cloud Slot Definition.

`deviceRegistry.ts`

- Owns registration records and lookup indexes.
- Exposes registration, assignment, ownership, and health as separate dimensions.

`deviceAssignment.ts`

- Owns assignment records and assignment rejection reasons.
- Does not dispatch commands.

`deviceOwnership.ts`

- Owns provider-instance-bound device ownership checks.
- Does not merge ownership with assignment or health.

`deviceHealth.ts`

- Owns health view shape only.

`deviceCommandGate.ts`

- Owns command eligibility checks.
- Does not queue, retry, dispatch, time out, or execute commands.

`deviceRuntime.ts`

- Owns Device Runtime facade orchestration.
- Does not implement Scanner Event Source or device executors.

## Existing Facade

`hrtLogicCore.ts`

- Remains the HRT facade.
- Wires Device Runtime under the existing provider lifecycle and registration flow.
