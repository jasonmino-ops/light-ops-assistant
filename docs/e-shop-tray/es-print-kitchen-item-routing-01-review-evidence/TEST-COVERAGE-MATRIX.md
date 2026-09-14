# ES-PRINT-KITCHEN-ITEM-ROUTING-01 Test Coverage Matrix

| Requirement | Evidence | Result |
|---|---|---|
| Store gate off: sale succeeds, FRONT remains, KITCHEN=0 | Cashier Network DB integration | PASS |
| Mixed eligible/ineligible items | FRONT complete and KITCHEN filtered assertions | PASS |
| All items eligible | Existing SHARED pair behavior and role assertions | PASS |
| Zero eligible items never reaches parser or rolls back sale | DB integration suppression case | PASS |
| SHARED_PRINTER mode remains unchanged | Payload/claim and confirmation assertions | PASS |
| Legitimate suppression is not a missing-role alert | Observability DB integration | PASS |
| Unmarked missing KITCHEN remains visible | Observability DB integration | PASS |
| New Product/API default is true | Product route test | PASS |
| Product false is persisted and re-read | Product route test | PASS |
| Invalid Product flag is rejected | Product route test | PASS |
| AI matched Product preserves existing false | DTO/source assertions | PASS |
| Import update does not overwrite the flag | Import mapping/source assertion | PASS |
| Suppression decision is idempotent | Repeated enqueue and conflict test | PASS |
| FRONT/KITCHEN transaction atomicity | Injected second-job failure rollback test | PASS |
| Client confirmation accepts only explicit legal suppression | Pure helper 7 cases and DB response test | PASS |
| Latest approved Cashier bytes remain exact | Device print contract hash test | PASS |
| Frozen Tray contract compiles | Tray typecheck and compile | PASS |
| Application types | Root TypeScript without incremental cache | PASS |
| Production build | `npm run build` | PASS |
| ROOT CORE manifest integrity | expected/collected/executed 73/73/73 | PASS |
| ROOT CORE test outcomes | 71 PASS, 1 known, 1 non-active-baseline clean-diff failure | BLOCKED |

## Database Test Safety

Both database suites require an explicit `127.0.0.1:65432/light_ops_test` URL and reject Vercel/Production execution. No migration runs inside the tests. Random tenant fixtures are cleaned by the suites.

## Not Yet Tested

- Production Store compatibility audit/backfill: not authorized.
- Production migration/deploy: not authorized.
- Real FRONT/KITCHEN endpoint FIELD verification: not authorized.
