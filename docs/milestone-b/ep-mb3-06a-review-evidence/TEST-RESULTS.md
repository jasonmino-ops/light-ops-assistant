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
- `npx tsx tests/desktop-activation-runtime.test.ts` against temporary local PostgreSQL - passed

## Runtime Database

- `initdb` temporary PostgreSQL under `/private/tmp` - passed
- `prisma migrate deploy` against temporary PostgreSQL - blocked by known historical migration drift at `20260531000000_customer_order_campaign` referencing missing `CustomerOrder`.
- `npx prisma db push --force-reset` against temporary PostgreSQL - passed
- REAL DATABASE ACTIVATION: PASS
- REAL DATABASE CONCURRENCY: PASS

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

- Workflow added: `.github/workflows/cloud-ci.yml`
- CI uses GitHub Actions PostgreSQL service and test-only desktop activation secrets.
- CI applies the current Prisma schema to temporary PostgreSQL with `npx prisma db push --force-reset` because full historical migration deploy is blocked by known pre-existing migration drift.
- CI run ID/result: to be reported after push for the new fix commit.
