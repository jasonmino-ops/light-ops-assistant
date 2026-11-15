# Build and validation truth

Targeted 9 files: **142 PASS /0 FAIL /0 SKIP**, actual owned PostgreSQL fixture (socket only, synthetic identity, no Production connections). TypeScript exit0, Build exit0, product Scope Guard PASS. Actual commands and exit codes retained in evidence *-exit.json and run-local-validation.py.

Same 142 tests and Build PASS on the Production-parent release draft at df0fa833077e4c80f54c515b5ad557acafb3fb85. Formal two-cherry-pick draft has exactly the same complete tree 178bfec6bb55616c7f0c02e16422f413c6149e0d, not a new source version. These earlier commands are not represented as executed at the later SHA. No deployed binaries are inferred from a local build.

CORE actually executed 103 files: **101 PASS /2 FAIL /BLOCKED**, zero skipped/uncollected. Runner retains newFailures2 against its own historical KTF; no override or PASS relabeling. Failures: frozen Cashier exact-admission guard, and baseline customer-order-recovery unstubbed DB read. Their full raw sections/runner JSON are preserved. Baseline c104 frozen guard PASS / customer-order-recovery FAIL were proven in prior phase; both baseline test and supporting source bytes are unchanged. New candidate admission rejection is NOT grandfathered by that baseline. No other aggregate regression found by this run, not a FIELD guarantee.

Initial new test run failed because one fixture reused a request ID across different action types (correctly rejected as conflict) and used nonexistent DesktopDeviceStatus DISABLED. Fixtures corrected to distinct IDs and real REVOKED enum; originals retained as targeted-tests-initial-fixture-failures.log. No product security condition was loosened. Final142 results are from the corrected source.

CI and candidate-bound GitHub App required check: NOT RUN/NOT ISSUED. No merge/push/Preview/Production, migration, real recovery or printing.
