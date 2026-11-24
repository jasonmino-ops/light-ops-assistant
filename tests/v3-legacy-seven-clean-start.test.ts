import assert from 'node:assert/strict'
import { createHash, createHmac, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import pg from 'pg'
import { type Prisma, PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import {
  controlledV3OwnerHandoff,
  issueV3ExecutionBatch,
  type V3ControlPlaneDb,
} from '../lib/v3-print-control-plane'
import { canonicalV3PrintEffectKey } from '../lib/v3-print-identity'
import { cleanStartSelector } from '../lib/v3-legacy-seven/clean-start'
import nextAttempt from '../lib/v3-legacy-seven/sealed-next-attempt.json'
import { deliverV3PrintIntent, enqueueV3PrintIntent, reportV3Execution } from '../lib/v3-print-job-adapter'
import {
  parseCommand,
  plan,
  jobIds,
  action,
  reason,
  scope,
  subject,
  DESIGN,
  ADMISSION,
  prefix,
} from '../app/api/ops/tenants/[tenantId]/stores/[storeId]/v3-print-control-plane/legacy-front-grant'
import {
  readLegacyReceipt,
  runLegacyDisposition,
  runLegacyFinalization,
} from '../app/api/ops/tenants/[tenantId]/stores/[storeId]/v3-print-control-plane/legacy-front-disposition'

const digest = (v: string | Buffer) => createHash('sha256').update(v).digest('hex')
test('production manifest is byte-bound and the route retains its protected normal entry points', () => {
  assert.equal(digest(readFileSync('lib/v3-legacy-seven/admission.json')), ADMISSION)
  assert.equal(jobIds.length, 7)
  const route = readFileSync(
    'app/api/ops/tenants/[tenantId]/stores/[storeId]/v3-print-control-plane/route.ts',
    'utf8'
  )
  assert.match(route, /validateOpsPrintMutationRequest\(req\)/)
  assert.match(route, /await authorizeStore\(req, params\)/)
  assert.match(route, /isTarget\(scope\).*FINALIZE_V3_ACTIVE.*FINALIZE_V2_ACTIVE/)
  assert.match(route, /await runLegacyFinalization/)
  assert.match(route, /activationCommitted = legacyRequest && result\.ok && finalAction === 'FINALIZE_V3_ACTIVE'\s*&& command\.value\.expectedStateVersion === legacyPlan\.control\.stateVersion \+ 2/)
  assert.throws(() => parseCommand({ action, phase: 'APPLY', jobIds }), /CASE_COMMAND_INVALID/)
})

const socket = process.env.DIAMOND_QUEUE_TEST_SOCKET
for (const loseReadback of [false, true])
  test(
    'isolated PostgreSQL seven-row cutover — ' +
      (loseReadback ? 'post-commit connection loss' : 'normal readback'),
    { skip: !socket && 'dedicated private PostgreSQL socket required' },
    async (t) => {
      assert.match(socket!, /^\/private\/tmp\/diamond-v3-queue-pg\.[A-Za-z0-9]+$/)
      const schema = 'legacy_seven_' + randomUUID().replaceAll('-', '')
      const pool = new pg.Pool({
        host: socket,
        port: 55483,
        database: 'es_diamond_v3_queue_test',
        options: '-c search_path=' + schema,
        max: 6,
      })
      const db = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) })
      t.after(async () => {
        await db.$disconnect()
        await pool.end()
      })
      assert.deepEqual((await pool.query('select current_database() as db,inet_server_addr() as host')).rows, [
        { db: 'es_diamond_v3_queue_test', host: null },
      ])
      await pool.query('CREATE SCHEMA "' + schema + '"')
      const upstream = readFileSync('tests/v3-print-control-plane-service.test.ts', 'utf8')
      const fixture = upstream.match(
        /await pool\.query\(`\n(    CREATE TYPE "DesktopDeviceStatus"[\s\S]*?)\n  `\)/
      )
      assert.ok(fixture, 'reuse the versioned, disposable Ops service fixture DDL')
      await pool.query(fixture[1])
      await pool.query(`ALTER TABLE "Store" ADD COLUMN "printKitchenTicket" boolean NOT NULL DEFAULT false;
    ALTER TABLE "OpsAdmin" ADD COLUMN "lockedUntil" timestamp;
    ALTER TABLE "Store" ADD UNIQUE ("tenantId",id);
    ALTER TABLE "EshopTrayPrintJob" ADD FOREIGN KEY ("tenantId","storeId") REFERENCES "Store"("tenantId",id);
    ALTER TABLE "DesktopDevice" ADD COLUMN "tokenExpiresAt" timestamp, ADD COLUMN "revokedAt" timestamp;
    CREATE TABLE "StoreRuntimePrintTask" ("id" text PRIMARY KEY,"tenantId" text,"storeId" text);
    CREATE TYPE "CustomerOrderFulfillmentState" AS ENUM ('PENDING','RENDER_PENDING','ENQUEUED','FAILED_RETRYABLE','CANCELLED','EXPIRED','MANUAL_REVIEW','NOT_REQUIRED');
    CREATE TABLE "CustomerOrderFulfillmentIntent" ("id" text PRIMARY KEY,"tenantId" text,"storeId" text,"orderNo" text,state "CustomerOrderFulfillmentState");`)
      // Synthetic credentials, job bytes and deadlines only. The deployed policy has no caller-supplied fixture.
      const originalPlan = structuredClone(plan)
      t.after(() => Object.assign(plan, originalPlan))
      const now = Date.now(),
        past = new Date(now - 60000),
        future = new Date(now + 3600000)
      const created = new Date(now - 2 * 86400000),
        expires = new Date(created.getTime() + 86400000)
      plan.notBefore = past.toISOString()
      plan.control.leaseSha256 = digest('expired-old-lease')
      plan.control.leaseExpiresAt = past.toISOString().slice(0, -1)
      const envKeys = ['AUTH_SECRET', 'VERCEL_ENV', 'VERCEL_GIT_COMMIT_SHA', 'VERCEL_DEPLOYMENT_ID'] as const
      const previous = envKeys.map((k) => process.env[k])
      t.after(() =>
        envKeys.forEach((k, i) => {
          if (previous[i] === undefined) delete process.env[k]
          else process.env[k] = previous[i]
        })
      )
      process.env.AUTH_SECRET = 'local-only-' + randomUUID()
      process.env.VERCEL_ENV = 'production'
      process.env.VERCEL_GIT_COMMIT_SHA = 'a'.repeat(40)
      process.env.VERCEL_DEPLOYMENT_ID = 'dpl_test_' + randomUUID()
      const reviewer = { id: 'reviewer-only', role: 'OPS_ADMIN' },
        executor = { id: 'executor-only', role: 'OPS_ADMIN' }
      const sourceSha = 'b'.repeat(40)
      const g = {
        task: plan.task,
        ...scope,
        deviceId: plan.newOwner,
        jobIds,
        requestId: plan.operationRequestId,
        sourceSha,
        beforeHash: '',
        releaseSha: process.env.VERCEL_GIT_COMMIT_SHA,
        deploymentId: process.env.VERCEL_DEPLOYMENT_ID,
        designSha256: DESIGN,
        admissionSha256: ADMISSION,
        handoffId: plan.handoffConfirmationId,
        reviewer: reviewer.id,
        executor: executor.id,
        status: 'APPROVED',
        validFrom: new Date(now - 1000).toISOString(),
        validUntil: new Date(now + 600000).toISOString(),
        evidence: Object.fromEntries(
          [
            'founderDecision',
            'implementationReview',
            'releaseLineage',
            'oldHostRetired',
            'v727LocalIdle',
            'desktopAndOfflineDrained',
            'h5Drained',
            'thirdPartyDrained',
            'backgroundDrained',
            'exclusiveWindow',
            'endpoints',
            'aliasReview',
          ].map((k) => [k, digest('synthetic:' + k)])
        ),
      }
      const sign = () => {
        const payload = JSON.stringify(g)
        return {
          payload,
          signature: createHmac('sha256', process.env.AUTH_SECRET!)
            .update(plan.task + '\n' + payload)
            .digest('hex'),
        }
      }
      function intent(orderNo: string, role: 'FRONT' | 'KITCHEN' = 'FRONT') {
        const bytes = Buffer.from('synthetic ' + orderNo + ' ' + role)
        return {
          schemaVersion: 3 as const,
          printJobId: 'network:' + digest(canonicalV3PrintEffectKey(orderNo, role)),
          source: 'LOCAL_DESKTOP' as const,
          role,
          payloadKind: 'RAW_BYTES' as const,
          orderNo,
          rendererVersion: 'fixture',
          payloadBase64: bytes.toString('base64'),
          byteLength: bytes.length,
          payloadHash: digest(bytes),
        }
      }
      const run = (phase: 'REVIEW' | 'APPLY' | 'READBACK', actor = phase === 'REVIEW' ? reviewer : executor) =>
        runLegacyDisposition(db, scope, actor, { phase, sourceSha })
      const receipt = () => readLegacyReceipt(db, scope, reviewer)
      const pending = () => db.eshopTrayPrintJob.count({ where: { ...scope, status: 'PENDING' } })
      await pool.query('INSERT INTO "Store" (id,"tenantId",code,status) VALUES ($1,$2,$3,\'ACTIVE\')', [
        scope.storeId,
        scope.tenantId,
        plan.scope.code,
      ])
      for (const actor of [reviewer, executor])
        await pool.query("INSERT INTO \"OpsAdmin\" (id,status,role) VALUES ($1,'ACTIVE','OPS_ADMIN')", [actor.id])
      for (const id of [plan.originalOwner, plan.newOwner])
        await pool.query(
          'INSERT INTO "DesktopDevice" (id,"tenantId","storeId",status,"installationIdHash","tokenExpiresAt") VALUES ($1,$2,$3,\'ACTIVE\',$4,$5)',
          [id, scope.tenantId, scope.storeId, digest(id), future.toISOString()]
        )
      const plane = await db.v3PrintControlPlane.create({
        data: {
          ...scope,
          id: 'fixture-plane',
          mode: 'V3_ACTIVE',
          ownerDeviceId: plan.originalOwner,
          ownerEpoch: 1,
          stateVersion: 4744,
          leaseId: 'expired-old-lease',
          leaseExpiresAt: past,
        },
      })
      await db.v3PrintExecutionBatch.create({
        data: {
          ...scope,
          id: plan.unrevokedBatches[0],
          controlPlaneId: plane.id,
          mode: 'V3_ACTIVE',
          ownerDeviceId: plan.originalOwner,
          ownerEpoch: 1,
          stateVersion: 4744,
          leaseId: 'expired-old-lease',
          expiresAt: past,
        },
      })
      const beforeRows = []
      for (const [i, seal] of plan.jobs.entries()) {
        const data = intent('SYNTHETIC-' + i)
        Object.assign(seal, {
          keySha256: digest(data.printJobId),
          requestHash: digest(JSON.stringify(data)),
          createdAt: created.toISOString().slice(0, -1),
          updatedAt: created.toISOString().slice(0, -1),
          expiresAt: expires.toISOString().slice(0, -1),
        })
        nextAttempt[seal.id as keyof typeof nextAttempt] = created.toISOString()
        beforeRows.push({
          id: seal.id,
          keySha256: seal.keySha256,
          requestHash: seal.requestHash,
          payloadHash: data.payloadHash,
          createdAt: created.toISOString(),
          expiresAt: expires.toISOString(),
          nextAttemptAt: created.toISOString(),
          updatedAt: created.toISOString(),
          claimAttempt: 0,
          attemptCount: 0,
          status: 'PENDING',
          resultCode: null,
          completedAt: null,
          resultStatus: null,
          effectBoundary: null,
          physicalCompletionKnown: false,
          role: 'FRONT',
          source: 'LOCAL_DESKTOP',
          payloadKind: 'RAW_BYTES',
          schemaVersion: 3,
          maxAttempts: 1,
          claimTokenHash: null,
          claimedByComputerBindingId: null,
          executingAt: null,
          leaseExpiresAt: null,
          resultMessage: null,
        })
        await db.eshopTrayPrintJob.create({
          data: {
            ...scope,
            id: seal.id,
            idempotencyKey: data.printJobId,
            requestHash: seal.requestHash,
            schemaVersion: 3,
            payload: data,
            maxAttempts: 1,
            expiresAt: expires,
            nextAttemptAt: created,
            createdAt: created,
            updatedAt: created,
          },
        })
        await pool.query("INSERT INTO \"SaleRecord\" VALUES ($1,$2,$3,$4,$4,'COMPLETED','SALE',$5)", [
          seal.id,
          scope.tenantId,
          scope.storeId,
          data.orderNo,
          created.toISOString(),
        ])
      }
      g.beforeHash = digest(
        JSON.stringify(beforeRows.map((r) => Object.entries(r).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))))
      )
      const asPlane = db as unknown as V3ControlPlaneDb
      await t.test('missing admission or cross-store request cannot write even REVIEW', async () => {
        await assert.rejects(run('REVIEW'), /CASE_GRANT_MISSING/)
        await assert.rejects(
          runLegacyDisposition(db, { ...scope, storeId: 'elsewhere' }, reviewer, { phase: 'REVIEW', sourceSha }),
          /CASE_STORE_FORBIDDEN/
        )
        assert.equal(await db.operationLog.count(), 0)
      })
      await db.operationLog.create({
        data: {
          id: prefix + 'grant',
          ...subject,
          requestId: plan.operationRequestId,
          actionType: 'FOUNDER_ADMISSION',
          status: 'SUCCESS',
          payloadSnapshot: sign(),
        },
      })
      await t.test('reviewer and executor are distinct, source and admission are server-bound', async () => {
        assert.equal((await receipt()).disposition, 'NO_APPLY_RECEIPT')
        await assert.rejects(run('REVIEW', executor), /ACTOR_FORBIDDEN/)
        await assert.rejects(run('APPLY'), /REVIEW_REQUIRED/)
        await assert.rejects(
          runLegacyDisposition(db, scope, reviewer, { phase: 'REVIEW', sourceSha: 'c'.repeat(40) }),
          /ACTOR_FORBIDDEN/
        )
        await db.operationLog.update({
          where: { id: prefix + 'grant' },
          data: { payloadSnapshot: { ...sign(), signature: 'f'.repeat(64) } },
        })
        await assert.rejects(run('REVIEW'), /GRANT_INVALID/)
        await db.operationLog.update({ where: { id: prefix + 'grant' }, data: { payloadSnapshot: sign() } })
        assert.equal(await pending(), 7)
      })
      await t.test('receipt TTL and sealed payload drift do not earn REVIEW', async () => {
        const first = jobIds[0]
        await pool.query('UPDATE "SaleRecord" SET "createdAt"="createdAt"+interval \'1 second\' WHERE id=$1', [
          first,
        ])
        await assert.rejects(run('REVIEW'), /TTL_UNPROVEN/)
        await pool.query('UPDATE "SaleRecord" SET "createdAt"=$2 WHERE id=$1', [first, created.toISOString()])
        await db.eshopTrayPrintJob.update({
          where: { id: first },
          data: { payload: { ...intent('SYNTHETIC-0'), rendererVersion: 'changed' }, updatedAt: created },
        })
        await assert.rejects(run('REVIEW'), /BYTES_DRIFT/)
        await db.eshopTrayPrintJob.update({
          where: { id: first },
          data: { payload: intent('SYNTHETIC-0'), updatedAt: created },
        })
      })
      await t.test('unexpired cached batches and store-wide HELD work stop admission', async () => {
        await db.v3PrintExecutionBatch.update({
          where: { id: plan.unrevokedBatches[0] },
          data: { expiresAt: future, revokedAt: past },
        })
        await assert.rejects(run('REVIEW'), /BATCH_ACTIVE/)
        await db.v3PrintExecutionBatch.update({
          where: { id: plan.unrevokedBatches[0] },
          data: { expiresAt: past, revokedAt: null },
        })
        const held = await enqueueV3PrintIntent(db as any, scope, intent('EXTRA'), future)
        await db.eshopTrayPrintJob.update({
          where: { id: held.job.id },
          data: { resultMessage: 'V3_DURABLY_HELD' },
        })
        await assert.rejects(run('REVIEW'), /QUEUE_OR_HELD_CHANGED/)
        await db.eshopTrayPrintJob.delete({ where: { id: held.job.id } })
        assert.equal((await run('REVIEW')).state, 'REVIEWED')
      })
      await t.test('concurrent original claimant lock prevents partial processing', async () => {
        const other = await pool.connect()
        try {
          await other.query('BEGIN')
          await other.query('SELECT id FROM "EshopTrayPrintJob" WHERE id=$1 FOR UPDATE', [jobIds[5]])
          await assert.rejects(run('APPLY'))
          assert.equal(await pending(), 7)
        } finally {
          await other.query('ROLLBACK')
          other.release()
        }
      })
      await t.test('actual last audit INSERT error rolls back seven rows and all audit inserts', async () => {
        await pool.query(`CREATE FUNCTION refuse_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.id='st04:legacy-front-seven:apply' THEN RAISE EXCEPTION 'test audit rejected'; END IF; RETURN NEW; END$$;
      CREATE TRIGGER refuse_test_audit BEFORE INSERT ON "OperationLog" FOR EACH ROW EXECUTE FUNCTION refuse_audit()`)
        try {
          await assert.rejects(run('APPLY'))
          assert.equal(await pending(), 7)
          assert.equal(await db.operationLog.count({ where: { actionType: action, message: 'TICKET' } }), 0)
        } finally {
          await pool.query('DROP TRIGGER refuse_test_audit ON "OperationLog"')
        }
      })
      await t.test('locked reviewer and direct historical-job audit stop apply', async () => {
        await pool.query('UPDATE "OpsAdmin" SET "lockedUntil"=$2 WHERE id=$1', [reviewer.id, future.toISOString()])
        await assert.rejects(run('APPLY'), /ACTOR_FORBIDDEN/)
        await pool.query('UPDATE "OpsAdmin" SET "lockedUntil"=NULL WHERE id=$1', [reviewer.id])
        await db.operationLog.create({
          data: {
            ...scope,
            id: 'late-history',
            targetType: 'PrintJob',
            targetId: jobIds[0],
            actionType: 'INCIDENT',
            status: 'SUCCESS',
          },
        })
        await assert.rejects(run('APPLY'), /OTHER_EFFECT/)
        await db.operationLog.delete({ where: { id: 'late-history' } })
      })
      await t.test('concurrent APPLY, lost reply and repeated APPLY produce one exact audit set', async () => {
        const calls = await Promise.allSettled([run('APPLY'), run('APPLY')])
        assert.equal(calls.filter((c) => c.status === 'fulfilled' && c.value.state === 'APPLIED').length, 1)
        assert.equal((await run('APPLY')).state, 'APPLIED_RECEIPT_ONLY')
        assert.equal((await run('READBACK')).state, 'HANDOFF_PREFLIGHT_OK')
        assert.equal((await receipt()).activation, 'NO_ACTIVATION_RECEIPT')
        assert.equal(await db.operationLog.count({ where: { actionType: action, message: 'TICKET' } }), 7)
        assert.equal(
          await db.eshopTrayPrintJob.count({
            where: {
              ...scope,
              status: 'EXPIRED',
              completedAt: null,
              resultStatus: null,
              resultCode: reason,
              physicalCompletionKnown: false,
              effectBoundary: null,
            },
          }),
          7
        )
      })
      await t.test('same key cannot replace the original; a late report cannot invent certainty', async () => {
        const data = intent('SYNTHETIC-1')
        assert.equal((await enqueueV3PrintIntent(db as any, scope, data, future)).created, false)
        for (const outcome of ['CROSSED', 'FAILED_NOT_CROSSED', 'CROSSING_UNKNOWN'] as const) {
          const r = await reportV3Execution(
            db as any,
            { ...scope, deviceId: plan.originalOwner, batchId: plan.unrevokedBatches[0] },
            {
              printJobId: data.printJobId,
              source: data.source,
              role: 'FRONT',
              executionId: 'late-old-report',
              ownerEpoch: 1,
              reportVersion: 1,
              outcome,
            }
          )
          assert.deepEqual(r, { ok: false, code: 'V3_REPORT_CONFLICT' })
        }
      })
      const handoff = (v: number) =>
        controlledV3OwnerHandoff(asPlane, {
          ...scope,
          expectedStateVersion: v,
          actorUserId: 'synthetic-store-owner',
          intendedOwnerDeviceId: plan.newOwner,
          confirmationId: plan.handoffConfirmationId,
        })
      const finalize = () => runLegacyFinalization(db, scope, executor, 4746, 'FINALIZE_V3_ACTIVE')
      await t.test(
        'two normal handoff stages preserve the seven; premature or V2 activation refused',
        async () => {
          await assert.rejects(finalize())
          await assert.rejects(
            runLegacyFinalization(db, scope, executor, 4744, 'FINALIZE_V2_ACTIVE'),
            /FINALIZE_BLOCKED/
          )
          assert.ok((await handoff(4744)).ok)
          assert.ok((await handoff(4745)).ok)
          await assert.rejects(run('READBACK'), /FENCE_CHANGED/)
          assert.equal((await run('APPLY')).state, 'APPLIED_RECEIPT_ONLY')
        }
      )
      await t.test(
        'successful disposition does not grant activation with missing per-ticket receipt',
        async () => {
          await db.operationLog.update({ where: { id: prefix + jobIds[1] }, data: { status: 'FAILED' } })
          await assert.rejects(finalize(), /RECEIPT_CONFLICT/)
          await db.operationLog.update({ where: { id: prefix + jobIds[1] }, data: { status: 'SUCCESS' } })
        }
      )
      await t.test('late HELD stays held; standard FINALIZE is never reached', async () => {
        const extra = await enqueueV3PrintIntent(db as any, scope, intent('LATE-HELD'), future)
        await db.eshopTrayPrintJob.update({
          where: { id: extra.job.id },
          data: { resultMessage: 'V3_DURABLY_HELD' },
        })
        await assert.rejects(finalize(), /QUEUE_OR_HELD_CHANGED/)
        assert.equal(
          (await db.eshopTrayPrintJob.findUniqueOrThrow({ where: { id: extra.job.id } })).resultMessage,
          'V3_DURABLY_HELD'
        )
        assert.equal(
          (await db.v3PrintControlPlane.findUniqueOrThrow({ where: { id: plane.id } })).mode,
          'BLOCKED_UNKNOWN'
        )
        await db.eshopTrayPrintJob.delete({ where: { id: extra.job.id } })
      })
      await t.test('in-flight producer FK lock blocks finalization before mode or HELD changes', async () => {
        const producer = await pool.connect()
        try {
          await producer.query('BEGIN')
          await producer.query('SELECT id FROM "Store" WHERE id=$1 FOR KEY SHARE', [scope.storeId])
          await assert.rejects(finalize())
          assert.equal(
            (await db.v3PrintControlPlane.findUniqueOrThrow({ where: { id: plane.id } })).mode,
            'BLOCKED_UNKNOWN'
          )
        } finally {
          await producer.query('ROLLBACK')
          producer.release()
        }
      })
      await t.test(
        'revoked grant and expired new lease fail closed, then original FINALIZE succeeds',
        async () => {
          await db.operationLog.update({ where: { id: prefix + 'grant' }, data: { status: 'FAILED' } })
          await assert.rejects(finalize(), /GRANT_MISSING/)
          await db.operationLog.update({ where: { id: prefix + 'grant' }, data: { status: 'SUCCESS' } })
          const c = await db.v3PrintControlPlane.findUniqueOrThrow({ where: { id: plane.id } })
          await db.v3PrintControlPlane.update({ where: { id: plane.id }, data: { leaseExpiresAt: past } })
          await assert.rejects(finalize(), /HANDOFF_STALE/)
          await db.v3PrintControlPlane.update({
            where: { id: plane.id },
            data: { leaseExpiresAt: c.leaseExpiresAt },
          })
          await assert.rejects(finalize(), /ACTIVATION_GRANT_REQUIRED/)
          const completed = await db.operationLog.findUniqueOrThrow({ where: { id: prefix + 'apply' } })
          const payload = JSON.stringify({
            action: 'FINALIZE_V3_ACTIVE',
            designSha256: DESIGN,
            ...scope,
            grantDigest: digest(sign().payload),
            afterHash: (completed.payloadSnapshot as Record<string, unknown>).afterHash,
            deviceId: plan.newOwner,
            confirmationId: plan.handoffConfirmationId,
            stateVersion: 4746,
            ownerEpoch: 2,
            executor: executor.id,
            founderDecision: digest('approve B only'),
            handoffApproval: digest('handoff'),
            freshDrainEvidence: digest('drained'),
            validFrom: g.validFrom,
            validUntil: g.validUntil,
          })
          await db.operationLog.create({
            data: {
              id: prefix + 'activation-grant',
              ...subject,
              requestId: plan.handoffConfirmationId,
              actionType: 'FOUNDER_FINALIZE_ADMISSION',
              status: 'SUCCESS',
              payloadSnapshot: {
                payload,
                signature: createHmac('sha256', process.env.AUTH_SECRET!)
                  .update(plan.task + ':FINALIZE:' + payload)
                  .digest('hex'),
              },
            },
          })
          if (loseReadback) {
            let transactions = 0
            const dropSecondRead = {
              $transaction: (callback: Parameters<typeof db.$transaction>[0], options: object) => {
                if (++transactions === 2) throw new Error('simulated read connection loss')
                return db.$transaction(callback, options)
              },
            } as typeof db
            await assert.rejects(
              runLegacyFinalization(dropSecondRead, scope, executor, 4746, 'FINALIZE_V3_ACTIVE'),
              /CASE_ACTIVATION_COMMITTED_READBACK_REQUIRED/
            )
            assert.equal(transactions, 2)
          } else assert.ok((await finalize()).ok)
          assert.equal((await db.v3PrintControlPlane.findUniqueOrThrow({ where: { id: plane.id } })).ownerEpoch, 2)
        }
      )
      for (const mode of ['FINALIZE_V2_ACTIVE', 'FINALIZE_V3_ACTIVE'] as const) {
        await t.test(`spent-case ${mode} uses the ordinary transaction on failure and success`, async () => {
          const previous = await db.v3PrintControlPlane.findUniqueOrThrow({ where: { id: plane.id } })
          const version = 4750
          const audits = () => db.operationLog.count({
            where: { ...scope, actionType: 'V3_PRINT_MODE_OPERATOR_CONFIRMATION', message: mode, status: 'SUCCESS' },
          })
          const before = await audits()
          await db.v3PrintControlPlane.update({
            where: { id: plane.id },
            data: { mode: 'BLOCKED_UNKNOWN', stateVersion: version, ownerDeviceId: null, leaseId: null,
              leaseExpiresAt: null, handoffRequestedAt: null, handoffQuarantineUntil: null },
          })
          async function expectUnchanged(result: Awaited<ReturnType<typeof runLegacyFinalization>>) {
            assert.ok(!result.ok && result.code === 'CONCURRENT_STATE_CHANGE')
            const current = await db.v3PrintControlPlane.findUniqueOrThrow({ where: { id: plane.id } })
            assert.equal(current.mode, 'BLOCKED_UNKNOWN')
            assert.equal(current.stateVersion, version)
            assert.equal(result.controlPlane.stateVersion, version)
            assert.equal(await audits(), before)
          }
          try {
            await pool.query(`CREATE FUNCTION reject_mode_cas() RETURNS trigger LANGUAGE plpgsql AS
              $$BEGIN RETURN NULL; END$$;
              CREATE TRIGGER reject_mode_cas BEFORE UPDATE ON "V3PrintControlPlane"
              FOR EACH ROW EXECUTE FUNCTION reject_mode_cas()`)
            try {
              await expectUnchanged(await runLegacyFinalization(db, scope, executor, version, mode))
            } finally {
              await pool.query('DROP TRIGGER reject_mode_cas ON "V3PrintControlPlane"; DROP FUNCTION reject_mode_cas()')
            }

            // A serialization failure after the callback must roll back its writes and reread the plane.
            const optionsSeen: Array<unknown> = []
            const conflictAtCommit = {
              $transaction: <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>,
                options?: { isolationLevel?: Prisma.TransactionIsolationLevel; timeout?: number }) => {
                optionsSeen.push(options)
                return db.$transaction(async tx => {
                  const value = await operation(tx)
                  if (optionsSeen.length === 1) throw Object.assign(new Error('isolated serialization failure'), { code: 'P2034' })
                  return value
                }, options)
              },
            } as Pick<typeof db, '$transaction'>
            await expectUnchanged(await runLegacyFinalization(conflictAtCommit, scope, executor, version, mode))
            assert.deepEqual(optionsSeen, [
              mode === 'FINALIZE_V3_ACTIVE' ? { isolationLevel: 'Serializable', timeout: 10_000 } : { isolationLevel: 'Serializable' },
              undefined,
            ])

            const ok = await runLegacyFinalization(db, scope, executor, version, mode)
            assert.ok(ok.ok)
            assert.equal(ok.controlPlane.mode, mode === 'FINALIZE_V2_ACTIVE' ? 'V2_ACTIVE' : 'V3_ACTIVE')
            assert.equal(ok.controlPlane.stateVersion, version + 1)
            assert.equal(await audits(), before + 1)
          } finally {
            const { mode, stateVersion, ownerDeviceId, leaseId, leaseExpiresAt, handoffRequestedAt,
              handoffQuarantineUntil, updatedAt } = previous
            await db.v3PrintControlPlane.update({
              where: { id: plane.id },
              data: { mode, stateVersion, ownerDeviceId, leaseId, leaseExpiresAt, handoffRequestedAt, handoffQuarantineUntil, updatedAt },
            })
          }
        })
      }
      await t.test(
        'spent facts are readable after approval revocation and release drift, without new authority',
        async () => {
          const previousDeployment = process.env.VERCEL_DEPLOYMENT_ID
          const before = await db.operationLog.count()
          await db.operationLog.update({ where: { id: prefix + 'grant' }, data: { status: 'FAILED' } })
          try {
            process.env.VERCEL_DEPLOYMENT_ID = 'dpl_later'
            const facts = await receipt()
            assert.equal(facts.activation, 'COMMITTED')
            assert.equal(facts.disposition, 'APPLIED')
            assert.equal(facts.liveAuthorization, false)
            await assert.rejects(
              readLegacyReceipt(db, scope, { role: 'OPS_ADMIN', id: 'unrelated-actor' }),
              /FORBIDDEN/
            )
            await assert.rejects(run('APPLY'), /GRANT_MISSING/)
            assert.equal(await db.operationLog.count(), before)
          } finally {
            process.env.VERCEL_DEPLOYMENT_ID = previousDeployment
            await db.operationLog.update({ where: { id: prefix + 'grant' }, data: { status: 'SUCCESS' } })
          }
        }
      )
      await t.test(
        'new epoch rejects older and equal-time jobs and claims each role of the same new order once',
        async () => {
          const c = await db.v3PrintControlPlane.findUniqueOrThrow({ where: { id: plane.id } })
          const receipt = await db.operationLog.findUniqueOrThrow({ where: { id: prefix + 'activated' } })
          const cut = new Date((receipt.payloadSnapshot as any).cutoffUtc)
          const issued = await issueV3ExecutionBatch(asPlane, {
            ...scope,
            deviceId: plan.newOwner,
            ownerEpoch: 2,
            stateVersion: c.stateVersion,
            leaseId: c.leaseId!,
          })
          assert.ok(issued.ok)
          const batchId = issued.value.batch.id
          await assert.rejects(
            enqueueV3PrintIntent(
              db as any,
              scope,
              { ...intent('SYNTHETIC-0'), printJobId: 'new-alias-for-old-front' },
              future
            ),
            /LEGACY_EFFECT_QUARANTINED/
          )
          for (const role of ['FRONT', 'KITCHEN'] as const) {
            for (const [tag, offset] of [
              ['OLD', -1],
              ['EQUAL', 0],
              ['NEW', 1],
            ] as const) {
              const job = await enqueueV3PrintIntent(db as any, scope, intent(tag + '-ORDER', role), future)
              await db.eshopTrayPrintJob.update({
                where: { id: job.job.id },
                data: { createdAt: new Date(cut.getTime() + offset), nextAttemptAt: past },
              })
            }
            const claim = () =>
              deliverV3PrintIntent(db as any, { ...scope, deviceId: plan.newOwner, batchId, role })
            const first = await claim()
            assert.ok(
              first.ok &&
                first.job?.intent.role === role &&
                first.job.printJobId === intent('NEW-ORDER', role).printJobId
            )
            assert.deepEqual(await claim(), { ok: true, job: null })
          }
          assert.equal(
            await db.eshopTrayPrintJob.count({
              where: { id: { in: jobIds }, status: 'EXPIRED', claimAttempt: 0, attemptCount: 0 },
            }),
            7
          )
          assert.deepEqual(
            await cleanStartSelector(
              null,
              { tenantId: 'another-tenant', storeId: 'another-store', deviceId: 'other' },
              2
            ),
            {}
          )
          assert.equal(await cleanStartSelector(null, { ...scope, deviceId: plan.newOwner }, 2), null)
        }
      )
      await t.test(
        'editing the cutoff or per-ticket after-image disables only the new device selector',
        async () => {
          const row = await db.operationLog.findUniqueOrThrow({ where: { id: prefix + 'activated' } })
          const original = row.payloadSnapshot as Record<string, string>
          const device = { ...scope, deviceId: plan.newOwner }
          await db.operationLog.update({
            where: { id: row.id },
            data: { payloadSnapshot: { ...original, cutoffUtc: past.toISOString() } },
          })
          assert.equal(await cleanStartSelector(db.operationLog, device, 2), null)
          await assert.rejects(runLegacyFinalization(db, scope, executor, 4750, 'FINALIZE_V2_ACTIVE'), /CASE_FINALIZE_BLOCKED/)
          await db.operationLog.update({ where: { id: row.id }, data: { payloadSnapshot: original } })
          const j = await db.operationLog.findUniqueOrThrow({ where: { id: prefix + jobIds[0] } })
          const v = j.payloadSnapshot as any
          await db.operationLog.update({
            where: { id: j.id },
            data: { payloadSnapshot: { ...v, before: { ...v.before, claimAttempt: 3 } } },
          })
          assert.equal(await cleanStartSelector(db.operationLog, device, 2), null)
          await assert.rejects(readLegacyReceipt(db, scope, reviewer), /RECEIPT_CONFLICT/)
          await db.operationLog.update({
            where: { id: j.id },
            data: { payloadSnapshot: { ...v, after: { ...v.after, physicalCompletionKnown: true } } },
          })
          assert.equal(await cleanStartSelector(db.operationLog, device, 2), null)
          assert.deepEqual(
            await cleanStartSelector(db.operationLog, { ...scope, deviceId: 'another-device' }, 2),
            {}
          )
        }
      )
    }
  )
