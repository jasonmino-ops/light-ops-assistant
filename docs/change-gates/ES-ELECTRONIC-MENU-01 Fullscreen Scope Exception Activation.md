# ES-ELECTRONIC-MENU-01 Fullscreen Scope Exception Activation

## Governance

Governed by:

- ES-CONST-001 Store Operating System Constitution
- ES-STRAT-001 Store Operating System Strategy Baseline
- ES-ENG-001 Engineering Workflow Baseline
- ES-GOV-001 Level 0 Governance Baseline

## Readiness and authorization

L3 governance registration and activation under explicit Founder approval. Clean starting origin/main and verified READY Production: `0e22ad64804465b5487fc3a8e3494666f7430e84`; Release Lineage PASS. Governance branch: `codex/es-electronic-menu-01-fullscreen-governance`. UI branch: `codex/es-electronic-menu-01-ui`, local candidate `5714f341c667c9c1d0128bf3ebcff2c3b90ba41f`. The governance branch starts from main and must not contain that UI commit or runtime changes. No Docs-only Exception is used for this authorized activation/deployment.

Founder approves the exact sealed Customer Display fullscreen extraction and the necessary governance commit, main merge/push and automatic governance-only Production deployment. The UI feature merge/deploy, database/schema/migrations, public contracts and all other protected files remain unapproved. Readiness: READY for this bounded activation. Required independent review and Scope checks precede activation; actual deployment/main verification precedes applying the protected patch.

## Exact exception

The existing `ES-ELECTRONIC-MENU-01.json` keeps its historical dashboard PRIMARY authorization CLOSED. Its additional `UI-FINAL-FULLSCREEN-EXTRACTION` authorization is ACTIVE only for `codex/es-electronic-menu-01-ui` and exactly `app/desktop/display/page.tsx`.

- Original protected file SHA-256: `a47130ee5bc49c1fb84e64d1540d53b60de9e344c08c0937fad2dbccc6630ac9`.
- Approved resulting file SHA-256: `bc2b6266ac0fe7544540dc123fca68bd7cc17caf9dfdec0412c170067290fad1`.
- Sealed patch SHA-256: `43ea4b6cad0eaed116ac4b2ef0863bc960b73fa0cc985af9773e4b74d2743eb6`.
- Sealed path: `.task-state/ES-ELECTRONIC-MENU-01-sealed/ui-final-fullscreen/customer-display-fullscreen.patch`.
- Protected diff: 3 additions and 10 deletions; import shared hook, replace local state/effect and call shared toggle inside the existing error handler.

Customer Display button, translations, behavior, renderer, polling, realtime, order/QR and data contracts remain unchanged. Cashier/Electron fullscreen is not extracted or modified. Companion shared hook and Electronic Menu rendering are later feature work and are absent from this governance commit.

## Activation, verification and lifecycle

The ACTIVE entry grants nothing until the byte-identical record enters trusted origin/main. Existing Guard checks still validate task, branch, approved baseline ancestry, config/record equality and exact content hash; the Guard and its configuration are unchanged. Any protected diff deviation requires a new Founder Gate. Close only this additional authorization after its UI feature merge; preserve the historical CLOSED dashboard record.

Before governance push: verify record schema, existing Guard regression suite, exact two-file governance diff and independent review. After push: verify origin/main contains the record, Production SHA matches main and is READY, prior runtime tree is unchanged and the UI commit is not an ancestor. Then update the isolated UI branch with governance baseline, apply the sealed patch and run the full UI/fullscreen/regression/type/build/Scope/independent-review checks before proposing a local candidate. This record does not assert unperformed FIELD acceptance or UI closure.
