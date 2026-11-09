# ES-WINDOWS-CI-CORE-ADMISSION-01 — exact CORE admission disposition

**SEALED DRAFT — NOT ACTIVE.** Requested authority is the Founder’s exact disposition of a frozen baseline under ES-ENG-001 and Workflow V1 §6.1–6.2. This file records a proposal and evidence. It has no executable effect on CORE, its runner, or release-foundation.

## Exact subject

| Binding | Value |
| --- | --- |
| Windows workflow candidate | `c2cae0621588bba9d5f1be52eb3f1e68d3714119` |
| Candidate tree | `356e0d9dc1b3f3530aa26b6360da5cad6e97398e` |
| Sole parent and reviewed `origin/main` | `d931a77c63b9c080214ab56117123b0230c0c4e2` |
| Reviewed parent tree | `e349c63ee63d62302877cd173559ba355c50131f` |
| Exact binary Git diff SHA-256 | `2d565167a7f16fbcd93ec640240df8e926b8069da397d347938ff5934fb89c0f` |
| Unchanged frozen test SHA-256 | `ccad9c0a1c3fb485871966a4c5aa9fcd7acfe7fdc9f9e567b0ff19d686235b60` |

The candidate changes exactly these two existing paths. The digest for each is the SHA-256 of its candidate Git blob.

| Path | SHA-256 |
| --- | --- |
| `.github/workflows/desktop-release-pilot.yml` | `87c9e1f022229e406365d558873cb8302c677dd022c9a8379645deb7b53de0d3` |
| `.github/workflows/desktop-windows-build.yml` | `e4542f0ffed26056cfc6db95c4dda4a3863f11623703aafc1be5d48a4cb6e04d` |

## Reproduced failure

The unchanged `tests/cashier-realtime-integration.test.ts` passed on the clean reviewed parent and exited 1 on the clean exact candidate. The only candidate failure in this focused test was `ERR_ASSERTION`, operator `deepStrictEqual`, at `assertBoundary` line 285, called from the final fallback at line 819. Expected was `[]`. Actual was exactly the two ordered paths above. The candidate full CORE run remains 103 executed, 101 passed, 2 failed, exit 1, BLOCKED. Its other failure is `tests/customer-order-recovery.test.ts`.

| Evidence | SHA-256 |
| --- | --- |
| Fresh parent focused log, exit 0 | `907ddfab753eb474337fd295cf32cf3900d916fba68c32f600c1ba3673e937d2` |
| Fresh candidate focused log, exit 1 | `a98f4cf0991690471caec6cf902fb611bb0dad700a00311b11fedbc3d329e5b3` |
| Unchanged candidate full CORE log | `ce6a07519af8f54b0b621c357488652a9c8b54525ace398ead43751ed4d657ef` |

Windows run 42558679463 binds the same candidate. Provider tests 3/3 and the single-installer contract 2/2 passed, and the worktree cleanliness diagnostic did not recur. The unit step remains failed on two release-foundation checks. Provider artifact construction and Windows installer construction were skipped.

## Proposed effect, after exact approval only

Record one **RAW FAIL — task-specific two-path admission disposition** for the exact focused failure above. Preserve the assertion, raw output, runner verdict and all other gates. This proposal covers the original candidate by SHA and tree on its pinned base only. It does not cover an integration commit, rebased or cherry-picked candidate, governance document, additional path, mode change, or another failing assertion.

Application requires independent review and an explicit Founder decision on the sealed record. Before application, verify the current trusted base, exact sole parent, candidate tree, path set, Git blob and checkout byte digests, clean index and worktree including untracked files, and absence of skip-worktree or assume-unchanged flags. Reproduce the same focused result with the unchanged test bytes. Any mismatch makes this disposition inapplicable. The proposed window permits one use and ends at `2026-11-16T00:00:00Z` UTC exclusive. This is a proposed cutoff for this record only and carries no authority. There is no automatic extension.

The separately registered USB product successor and its deadline are outside this disposition. Approval of this document would not record CORE PASS, activate an executable grant, authorize a merge, or authorize a release.

## Independent blocker handoff

| Responsibility | Evidence and current state |
| --- | --- |
| Customer order recovery | `tests/customer-order-recovery.test.ts` remains the independent CORE failure on trusted main and this candidate. Route, fixture and business behavior are outside this disposition. |
| Release foundation governance | `release:foundation:policy` still reports Prisma, Payment, Scanner and cashier/customer/mobile business on trusted main and the workflow candidate. The Windows hosted run also preserves its two frozen-policy failures. |
| Historical path governance | The USB integration replay still rejects six CLOSED paths, one DRAFT/PENDING path and one path without a valid grant. All eight stay outside this disposition. |

Windows USB FIELD remains blocked by the lack of a qualified isolated physical printer. This document does not provide a FIELD or ESC-2 result.

## Founder decision and one-use registration

The sealed draft above is preserved byte for byte. Founder decision **CONDITIONALLY APPROVED** applies only to the exact draft and workflow candidate above. The operative deadline is **2026-11-16T16:00:00Z UTC exclusive**, replacing the draft's proposed time for this record only.

The documentary disposition becomes **ACTIVE FOR ONE USE** after the independent Claude review and readback of this exact record from `refs/heads/codex/es-windows-ci-core-admission-01`. It applies only while trusted `main` is the pinned sole parent `d931a77c63b9c080214ab56117123b0230c0c4e2`, the checkout matches the reviewed hashes and the raw failure signature remains exact. Use it only for the non-force fast-forward to original candidate `c2cae0621588bba9d5f1be52eb3f1e68d3714119`. That fast-forward consumes the disposition. Base drift, signature drift, altered bytes, a third path or expiry makes it inapplicable.

The registration branch holds the approval evidence separately from the two-path workflow commit. The documentary admission records the raw cashier assertion as a scoped exception. It does not change any checker, runner classification, test output, historical path authorization or USB authorization. All other failures remain visible and require their own disposition.

The preflight collected and executed the same 103 CORE files on both exact commits. The single difference in per-test verdicts was the pinned cashier path assertion. Trusted main was 102/103, exit 1. The workflow candidate was 101/103, exit 1. Both release-foundation invocations exited 1 with identical output. The authorized Windows run retained its two release-foundation failures. Scope Guard, STRICT lineage and V2 invariance checks passed. The candidate preserves the Vercel Git deployment setting for main as disabled and retains the manual-only Pilot release workflow.

| Evidence | SHA-256 |
| --- | --- |
| Original request transcript | `529131cb5e2b97a67b2d75a9332f175f54c3b591e0ba9c6d890bf5cc980cbff6` |
| Sealed draft blob | `5d04a3952026535cc74f77f38a8539c8240621e8bd840bcc3db9a2e368d84392` |
| Founder decision transcript below | `ee9b7e42958b9717851ade2ad0b320660ac94265e152d3ea6ced76d67f59894b` |
| Fresh trusted-main CORE | `415adb4c732e4bed04d3ed643aab95f09352e8002e4d06b7012d59ee45e330ac` |
| Fresh exact candidate CORE | `1ff397571bbaf459b58cd53904ba8a14bc0139fd8b146a425613e715d295f1b0` |
| Identical release-foundation logs | `451dfff3e54d8b1e46a6fb2695295e035d3df4b8cc85f215b2b26470caa343fb` |

```text
ES-WINDOWS-CI-CORE-ADMISSION-01 — Founder Decision

Decision：CONDITIONALLY APPROVED

目标：一次性收口已验证的两个 Windows CI 工作流修复，不再扩大 USB 开发范围。

治理候选：
d19069ccd6ad1bc82350fc9c7ad3f860421c608f

工作流候选：
c2cae0621588bba9d5f1be52eb3f1e68d3714119

授权截止（UTC）：
2026-11-16T16:00:00Z

执行边界

1. 只允许两个已审查工作流路径及其精确 SHA-256 的 CORE 准入，不得增加第三个路径或修改其他冻结规则。
2. 完成治理草案的合法激活、登记和 Claude 精确复核；原始请求、失败签名和 Git 血统必须匹配。
3. 准入合法生效后，允许将已审查的 CI 修复候选受控合入 main，但须确认无新增测试退化、无自动 Production 发布风险，且主线血统及原有冻结要求满足。
4. 不得因既有 CORE 或 release-foundation 失败将 CI 视为全部通过。原始失败继续保留。
5. 一旦发现候选内容变化、授权失效或超出审批范围，停止合并并报告，不得自行扩大后继。

完成标准

* 两个 CI 工作流路径获得合法 CORE 准入。
* Windows CI 三项环境性故障修复保留。
* 无新增测试回归。
* Claude 确认治理与工作流最终状态。
* USB 业务候选、Production、release 均不受影响。

完成后仅报告最终 main SHA、真实门禁状态及剩余阻塞。

该 CI 任务随后独立收口，不再作为 USB 功能开发的子任务反复审批。

本授权不包含 ESC-2 正式签认或生产发布。
```
