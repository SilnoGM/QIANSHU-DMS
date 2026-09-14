import { Prisma } from '../../generated/prisma/client'
import type { IdempotentIssuanceRecord, RandomIssuanceInsertInput, SequenceIssuanceInsertInput } from './numbering-generator.persistence'
import type { ValidatedGenerateNumberRequest } from './numbering-internal-input'

/** 只接收已校验摘要，批量查询不会向数据库发送业务幂等键原文。 */
export async function readBatchIdempotentIssuances(
  transaction: Prisma.TransactionClient,
  requests: readonly ValidatedGenerateNumberRequest[],
): Promise<Map<string, IdempotentIssuanceRecord>> {
  const rows = await transaction.numberingIssuance.findMany({
    where: {
      consumerCode: requests[0].consumerCode,
      idempotencyKeyHash: { in: requests.map(item => Uint8Array.from(item.idempotencyKeyHash)) },
    },
    select: {
      id: true,
      generatedNumber: true,
      issuedAt: true,
      idempotencyKeyHash: true,
      requestFingerprintHash: true,
      rule: { select: { ruleCode: true } },
      ruleVersion: { select: { revision: true } },
    },
  })
  return new Map(rows.map(row => [Buffer.from(row.idempotencyKeyHash).toString('hex'), {
    id: row.id,
    ruleCode: row.rule.ruleCode,
    revision: row.ruleVersion.revision,
    generatedNumber: row.generatedNumber,
    issuedAt: row.issuedAt,
    requestFingerprintHash: Buffer.from(row.requestFingerprintHash),
  }]))
}

export interface InsertedBatchIssuance {
  readonly id: string
  readonly generatedNumber: string
  readonly idempotencyKeyHash: Uint8Array
}

/** PostgreSQL RETURNING 不保证输入顺序，消费方必须按幂等摘要映射结果。 */
export async function insertSequenceIssuanceBatch(
  transaction: Prisma.TransactionClient,
  inputs: readonly SequenceIssuanceInsertInput[],
): Promise<InsertedBatchIssuance[]> {
  return transaction.numberingIssuance.createManyAndReturn({
    data: inputs.map(input => ({
      ...input,
      idempotencyKeyHash: Uint8Array.from(input.idempotencyKeyHash),
      requestFingerprintHash: Uint8Array.from(input.requestFingerprintHash),
    })),
    select: { id: true, generatedNumber: true, idempotencyKeyHash: true },
  })
}

/** 仅吞输出碰撞；幂等冲突仍使整个业务事务失败，不能悄悄跳过某个货件。 */
export async function tryInsertRandomIssuanceBatch(
  transaction: Prisma.TransactionClient,
  inputs: readonly RandomIssuanceInsertInput[],
): Promise<InsertedBatchIssuance[]> {
  const values = inputs.map(input => Prisma.sql`(
    CAST(${input.ruleId} AS uuid), CAST(${input.ruleVersionId} AS uuid),
    ${input.periodKey}, ${input.generatedNumber}, NULL, ${input.consumerCode},
    ${input.idempotencyKeyHash}, ${input.requestFingerprintHash}, ${input.issuedAt}
  )`)
  return transaction.$queryRaw<InsertedBatchIssuance[]>(Prisma.sql`
    INSERT INTO "numbering_issuances" (
      "rule_id", "rule_version_id", "period_key", "generated_number", "sequence_value",
      "consumer_code", "idempotency_key_hash", "request_fingerprint_hash", "issued_at"
    ) VALUES ${Prisma.join(values)}
    ON CONFLICT ("rule_id", "generated_number") DO NOTHING
    RETURNING "id", "generated_number" AS "generatedNumber", "idempotency_key_hash" AS "idempotencyKeyHash"
  `)
}

/** 全部 ledger 占位成功后一次推进计数；外层回滚同时撤销 ledger 与周期状态。 */
export async function advanceBatchPeriodState(
  transaction: Prisma.TransactionClient,
  periodStateId: string,
  count: number,
  nextSequenceValue: bigint | null,
): Promise<void> {
  await transaction.numberingPeriodState.update({
    where: { id: periodStateId },
    data: { usedCount: { increment: BigInt(count) }, nextSequenceValue },
    select: { id: true },
  })
}
