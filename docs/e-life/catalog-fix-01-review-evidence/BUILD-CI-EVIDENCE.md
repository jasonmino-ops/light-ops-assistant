# Build / CI Evidence

- Final `DATABASE_URL=<unreachable localhost> NEXT_PUBLIC_PUBLIC_SITE_URL=http://127.0.0.1:3100 npm run build`: PASS, exit0; raw build.txt.
- Final `node node_modules/typescript/bin/tsc --noEmit --incremental false`: PASS, exit0; empty typecheck.txt is the real output.
- Catalog/DTO/discount/recommendation Node tests:19/19 PASS; raw catalog-tests.txt.
- Existing order submission/fulfillment, Customer Display, discount/recommendation regressions with NODE_ENV=test:56/56 PASS; protected-regressions.txt.
- New local browser tests:2/2 PASS, no real external order/payment/printer effects.2096 full search/category/detail/cart reload/mock submission;5000 full render/final-item search.
- Prior real2096-ID snapshot replay returns2096, missing0, recovers1896 IDs,11 batches; in-memory adapter only, not Production SQL latency.
- Existing broader checks are not all green. See broader-checks.json, comparison files and KNOWN-RISKS.md. No aggregate-suite PASS, remote CI PASS or FIELD claim.
- Remote CI/Preview: NOT RUN (no push authorized). Production verification: NOT RUN (deployment not authorized).

## Browser measurement context
Desktop Chromium with390x844 viewport; optimized local Next build and mocked API; timings do not establish real low-end-device or network/SQL SLOs. See browser-performance.json for exact values.
