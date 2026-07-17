# EP-MB3-06A Test Results

Date: 2026-07-17

## Schema and Client

- `npx prisma validate` - passed
- `npx prisma generate` - passed

## Type Check

- `npx tsc --noEmit` - passed

## 06A Tests

- `npx tsx tests/desktop-activation-crypto.test.ts` - passed
- `npx tsx tests/desktop-activation-subscription.test.ts` - passed
- `npx tsx tests/desktop-activation-security-static.test.ts` - passed
- `npx tsx tests/desktop-activation-concurrency-static.test.ts` - passed

## Existing Regression Tests

- `npx tsx tests/subscription-lifecycle.test.ts` - passed
- `npx tsx tests/telegram-start-param.test.ts` - passed
- `npx tsx tests/customer-display-cart-sync-static.test.ts` - passed
- `npx tsx tests/customer-landing-journey-static.test.ts` - passed
- `npx tsx tests/customer-display-adapter.test.ts` - passed
- `npx tsx tests/hrt-contract.test.ts` - passed
- `npx tsx tests/customer-display-realtime-channel.test.ts` - passed

## Build

- `npm run build` - passed

## CI

Cloud CI was not separately triggered from the local environment before this commit. The local evidence above is the reproducible verification set for independent review.
