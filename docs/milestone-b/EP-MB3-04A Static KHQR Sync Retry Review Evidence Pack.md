# EP-MB3-04A Static KHQR Sync Retry Review Evidence Pack

Date: 2026-07-16

## A. EP And Title

- EP: EP-MB3-04A
- Title: Static KHQR Sync Retry Minimal Blocking Fix
- Gate source: Claude Desktop independent architecture review
- Gate result before this fix: FAIL
- Gate recommendation before this fix: MINIMAL FIX REQUIRED BEFORE WINDOWS TRUE-MACHINE ACCEPTANCE

## B. Baseline

- Repository: `/Users/jason/light-ops-assistant`
- Branch: `feat/ep-mb3-04-desktop-display-assignment`
- Starting HEAD: `a082ad9009c4e4177e0750abaa136a9bc26f8bf0`
- Origin main at start: `cf9b44faa172769ef46945d24a8208bdbb003713`
- Origin current branch at start: `e661d971981a2b99a062aaa70070d3617d4f1601`
- Initial workspace status: clean

## C. Original Implementation Commit

- EP-MB3-04 implementation commit: `a082ad9009c4e4177e0750abaa136a9bc26f8bf0`
- Scope of original implementation: static KHQR instant presentation using current-store preloaded static KHQR image, CASH sync correction, and initial syncKey dedupe.

## D. Blocking Finding

Claude Desktop found one blocking retry issue:

- `syncCurrentCartToCustomerDisplay()` built a sync key for `/api/cashier/display-session`.
- The implementation wrote `lastCashierDisplaySyncKey.current = syncKey` before the POST completed.
- If the POST returned non-2xx or hit a network exception, the same state later matched the stored key.
- The guard `if (syncKey === lastCashierDisplaySyncKey.current) return` then swallowed the retry permanently.

## E. Root Cause

The sync key represented the last attempted display-session request, not the last successful display-session sync. A failed attempt therefore became indistinguishable from a completed sync. The code also had no separate in-flight key, so preventing duplicate concurrent POSTs and remembering a successful POST were conflated.

## F. Minimal Fix

Changed only the cashier display-session sync path:

- `postCashierDisplaySession()` now returns `true` for HTTP 2xx.
- `postCashierDisplaySession()` returns `false` for non-2xx responses.
- `postCashierDisplaySession()` returns `false` for network exceptions.
- Added `inFlightCashierDisplaySyncKey` as a separate ref from `lastCashierDisplaySyncKey`.
- Added `postCashierDisplaySessionOnce(syncKey, input)`:
  - skips if `syncKey` equals the last successful key;
  - skips if `syncKey` is already in flight;
  - records the in-flight key before POST;
  - clears the in-flight key only if the completing request is still current;
  - writes `lastCashierDisplaySyncKey.current = syncKey` only when the matching POST succeeds;
  - does not write the successful key on non-2xx or network failure.
- Existing keyed automatic display-session sync now uses the same helper, so the successful-key semantics are consistent.
- New order and completion reset paths clear both successful and in-flight sync keys.

## G. Success And Retry Semantics

- Same key, POST succeeds: later identical state is deduped by `lastCashierDisplaySyncKey`.
- Same key, POST fails with non-2xx: successful key is not written; a later identical state can POST again.
- Same key, POST throws: in-flight key is released; a later identical state can POST again.
- Same key while in flight: duplicate concurrent POST is skipped.
- Key A in flight, key B starts, A returns late: A is ignored because the in-flight key no longer matches A.
- Key B succeeds after A: B becomes the last successful key.
- Key B fails after replacing A: no stale success is written; B can retry.
- KHQR focus remains safe because the `message` field remains part of the sync key.
- CASH remains safe because non-KHQR desktop payment selection calls `syncCurrentCartToCustomerDisplay(method)`, not forced KHQR.
- KHQR -> CASH -> KHQR remains safe because payment method and message are part of the sync key.
- New orders remain safe because cart clear / sale completion paths reset successful and in-flight keys.

## H. Complete Diff Scope

Files changed in this fix:

- `app/cashier/page.tsx`
- `tests/customer-display-cart-sync-static.test.ts`
- `docs/milestone-b/EP-MB3-04A Static KHQR Sync Retry Review Evidence Pack.md`

Code/test diff before evidence file:

- 2 files changed
- 39 insertions
- 9 deletions

No other app, API, database, runtime, provider, printing, or frozen contract files were modified.

## I. Test Commands And Results

Command: `npx tsx tests/customer-display-cart-sync-static.test.ts`

- Result: PASS
- Test count: 1 static source assertion file
- Test type: static source assertion
- Coverage added:
  - successful key is recorded only after matching POST success;
  - in-flight key is separate from successful key;
  - same in-flight key is deduped;
  - non-2xx and network failures return false;
  - thrown failures release in-flight key;
  - manual sync no longer writes successful key before POST;
  - KHQR focus message remains in sync key;
  - CASH selection does not force KHQR sync;
  - new order reset clears in-flight sync state;
  - static KHQR instant display assertions continue to pass.

Command: `npx tsx tests/customer-display-realtime-channel.test.ts`

- Result: PASS
- Test count: 1 realtime channel logic test file
- Test type: runtime behavior test using Node assertions for helper logic
- Coverage retained:
  - store isolation;
  - sequence guard;
  - desktop epoch behavior;
  - stale poll protection after realtime messages;
  - clear message protection.

Command: `npm run build`

- Result: PASS
- Test count: Next.js production build, 133 static pages generated
- Test type: build verification

Package script inspection:

- `package.json` has no general full test script.
- Existing relevant commands executed above.
- `test:smoke:prod` exists but targets production smoke and was not run for this local minimal blocking fix.

## J. Boundary Confirmation

Unmodified:

- Static KHQR instant display mechanism in `app/desktop/display/page.tsx`
- Prisma schema and migrations
- SaleRecord creation logic
- PaymentIntent creation logic
- Payment success judgment
- Dynamic KHQR Provider
- Shinhan reserved architecture
- Printing
- USB customer display
- Electron Runtime Core
- Provider code
- Frozen Contract
- Customer H5 ordering
- Order status flow

## K. Deferred Observations

Not handled in this minimal blocking fix:

- Dynamic `khqrPayload` vs static image priority
- Image preload automatic retry
- Realtime guard duration changes
- Hardcoded message constant extraction
- Server KHQR config TTL cache
- Base64 response slimming
- Polling architecture changes

## L. Windows True-Machine Acceptance Checklist

For Windows true-machine acceptance after Claude re-review:

- Start Desktop POS with employee and customer displays.
- Add items to cart and open payment selection.
- Simulate or observe a failed `/api/cashier/display-session` POST.
- Select or re-trigger the same KHQR state and verify the POST retries.
- Verify successful identical KHQR state is deduped after a successful POST.
- Verify KHQR focus still opens the customer KHQR display.
- Switch KHQR -> CASH -> KHQR and verify customer display state is correct.
- Complete a sale, start a new order, and verify old sync keys do not suppress the new order display sync.

## M. Fix Commit

- Fix commit: `545e92e96cd5842af6056ef93756e44cf4ab2509`

## N. Gate Handoff

- Current gate handoff state: READY FOR CLAUDE DESKTOP RE-REVIEW after the fix commit is created, amended with its final hash, pushed, and remote branch verification confirms the branch contains EP-MB3-04 plus EP-MB3-04A.
