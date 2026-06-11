# Rollback To Freeze SOP

> Scope: code-layer rollback to a known frozen tag, with database recovery kept
> manual and explicitly approved. This SOP does not add product functionality.

---

## 1. Rollback Goal

When a later change causes a major production issue, restore the application
code to a known stable frozen version as quickly as possible while protecting
real trial data.

Current stable trial target:

- Version: Beta V1.1 Real Store Trial
- Tag: `beta-v1.1-real-store-trial`
- Freeze document: `docs/freezes/BETA_V1_1_REAL_STORE_TRIAL_FREEZE.md`
- Disaster recovery guide:
  `docs/freezes/BETA_V1_1_REAL_STORE_TRIAL_DISASTER_RECOVERY.md`

The default response should be code rollback first, database inspection second.
Do not perform automatic database rollback.

---

## 2. Applicable Scenarios

Use this SOP for P0 or severe P1 regressions after the frozen version:

- Merchant cannot enter `/home`.
- Owner/staff cannot bind.
- Customer QR `/m/{storeCode}` cannot open `/menu`.
- Customer cannot place orders.
- `/sale` or `/cashier` cannot complete sales.
- `/records` amount/source is wrong.
- `/dashboard` no longer matches `/records`.
- `/ops` cannot enter.
- Permission crosses bot, role, store, or tenant.

---

## 3. Not Applicable Scenarios

Do not use rollback for:

- Minor copy changes.
- UI spacing issues.
- Slow but usable non-core pages.
- New feature requests.
- Data correction that is unrelated to a code deployment.
- Database corruption that requires targeted restore or manual SQL review.

For database incidents, follow the disaster recovery guide and take a fresh
backup before any repair.

---

## 4. Fast Rollback Method 1: Vercel Deployment Rollback

Use this first when the frozen deployment still exists in Vercel.

1. Open Vercel Dashboard for `light-ops-assistant`.
2. Go to Deployments.
3. Find the deployment built from `beta-v1.1-real-store-trial` or the freeze
   commit.
4. Promote that deployment to Production.
5. Do not change database state.
6. Run the minimum verification checklist below.
7. Record the rollback in Obsidian.

This is the fastest and safest option because it avoids Git history changes and
does not touch production data.

---

## 5. Fast Rollback Method 2: Git Tag Rollback

Use this when the Vercel frozen deployment is unavailable or a fresh deployment
from the frozen tag is required.

Manual commands:

```bash
git fetch origin --tags
git checkout beta-v1.1-real-store-trial
npm ci
npx prisma generate
npm run build
```

For deployment, prefer creating a rollback branch instead of working from
detached HEAD. The rollback script below automates that safe branch creation.

---

## 6. Rollback Script Usage

Command:

```bash
npm run rollback:freeze -- beta-v1.1-real-store-trial
```

The script:

- Requires a clean Git working tree.
- Runs `git fetch --tags`.
- Checks that the tag exists.
- Creates a new branch named `rollback/<tag>-<timestamp>`.
- Prints current commit and target tag information.
- Runs `npm ci`.
- Runs `npx prisma generate`.
- Runs `npm run build`.
- Prints next deployment steps.

The script does not:

- Modify production database.
- Run `prisma migrate reset`.
- Run destructive SQL.
- Delete data.
- Overwrite `.env`.
- Push automatically.

If build passes and human approval is given, push the rollback branch:

```bash
git push origin rollback/<tag>-<timestamp>
```

Then deploy via Vercel using the approved rollback branch or promote the built
deployment.

---

## 7. Confirm Current Tag

Check the frozen tag exists locally:

```bash
git tag --list beta-v1.1-real-store-trial
git rev-parse --short beta-v1.1-real-store-trial
git log -1 --oneline beta-v1.1-real-store-trial
```

Check current deployed commit from Vercel Dashboard or GitHub deployment record
before deciding whether rollback is needed.

---

## 8. Confirm Build Passes

Before deployment from a rollback branch:

```bash
npm ci
npx prisma generate
npm run build
```

If build fails, do not deploy and do not tag. Capture the error and compare the
local environment with the frozen build environment.

---

## 9. Minimum Post-Rollback Verification

After any rollback, verify these paths:

- `/home` can enter.
- `/m/{storeCode}` enters `/menu?code=...`.
- `/menu` can place an order.
- `/sale` can complete a sale.
- `/cashier` can complete cashier sale.
- `/records` can show records.
- `/dashboard` can show owner overview.
- `/ops/login` opens.
- `/bind` owner/staff codes still work.

If any check fails, keep the incident open and do not continue feature work.

---

## 10. Why Database Cannot Be Rolled Back Casually

Real-store trial data is live business data:

- Customer orders may have been placed after the last backup.
- Sales and refunds may have been recorded after the last backup.
- Payment confirmation state may have changed.
- Bind tokens may have been consumed.
- Product images and Storage object references may have changed.

Rolling back code can restore application behavior without losing data. Rolling
back database state can erase real orders or create mismatches between records,
payments, dashboard, and customer history.

---

## 11. When Database Recovery Is Needed

Database recovery requires manual approval when:

- A migration corrupted schema or data.
- Production data was accidentally deleted or overwritten.
- Permission data causes cross-tenant or cross-store exposure.
- Records or payment state are corrupted in a way code rollback cannot fix.
- Storage references and DB rows are materially inconsistent.

Before any database restore:

1. Stop new risky writes if possible.
2. Take a fresh pre-restore backup.
3. Identify affected tables and time range.
4. Prefer targeted repair over full restore.
5. Get explicit human approval.
6. Record the command, reason, backup path, row counts, and verification result.

Never run `prisma migrate reset` against production.

---

## 12. Obsidian Record Requirement

Every rollback attempt must be recorded in the true Vault:

```text
/Users/jason/E-Life-Knowledge-Base/E-life knowledge Base/05-开发记录/商户端收口记录-2026-06-10.md
```

Record:

- Incident time.
- Severity.
- Symptom.
- Affected route or bot.
- Current deployed commit.
- Rollback target tag.
- Whether Vercel rollback or Git rollback was used.
- Whether database was touched.
- Verification result.
- Follow-up owner.

Do not write the incident record into the project repository
`05-开发记录/` directory.

---

## 13. Forbidden After Rollback

Do not:

- Add new features during incident response.
- Change database schema for non-blocking problems.
- Run destructive SQL without approval.
- Run `prisma migrate reset` in production.
- Force-move `beta-v1.1-real-store-trial`.
- Commit `.env` or plaintext secrets.
- Commit production database dumps.
- Change bot routing experimentally.
- Continue trial traffic if P0 checks still fail.

---

## 14. Quick Decision Guide

- If a new deployment broke the app and data is intact:
  use Vercel rollback.
- If Vercel cannot roll back:
  use `npm run rollback:freeze -- beta-v1.1-real-store-trial`, push rollback
  branch after approval, then deploy.
- If database data is corrupted:
  stop, take a fresh backup, and follow the disaster recovery guide.
- If the issue is minor:
  do not roll back; queue it after trial or fix only with explicit approval.

---

**SOP owner:** jasonmino  
**SOP date:** 2026-06-11  
**Primary rollback tag:** `beta-v1.1-real-store-trial`
