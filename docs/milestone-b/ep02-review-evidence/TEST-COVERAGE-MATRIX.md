# EP-MB2-02 Test Coverage Matrix

## Contract

- Command: `npx tsx tests/hrt-contract.test.ts`
- Result: PASS

## Provider Simulator

- Command: `npm --prefix packages/hrt-provider-simulator test`
- Result: PASS

- Command: `npm --prefix packages/hrt-provider-simulator run typecheck`
- Result: PASS

## Desktop Runtime

- Command: `npm --prefix desktop run typecheck`
- Result: PASS

- Command: `npm --prefix desktop test`
- Result: PASS
- Test files: 10
- Tests: 92

- Command: `npm --prefix desktop run compile`
- Result: PASS

## Root Build

- Command: `npm run build`
- Result: PASS
- Static pages generated: 133

## Vector Coverage

- Device Runtime vectors: 19
- Executed Device Runtime vectors: 19
- Result: PASS
