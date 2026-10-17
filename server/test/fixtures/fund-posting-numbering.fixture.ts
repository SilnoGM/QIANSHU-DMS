import { randomBytes, randomUUID } from 'node:crypto'

import type { Client } from 'pg'

/**
 * 直写 SQL 的资金批次夹具必须先登记与 batch_no 一致的发号记录，否则新的
 * BEFORE INSERT 身份触发器会按设计拒绝测试数据。这里只模拟台账身份，不替代
 * 正式发号状态机。
 */
export async function insertFundPostingBatchIssuance(
  client: Client,
  generatedNumber: string,
): Promise<string> {
  const rule = await client.query<{
    ruleId: string
    versionId: string
    periodKey: string
  }>(`
    SELECT
      rule."id" AS "ruleId",
      version."id" AS "versionId",
      to_char(
        transaction_timestamp() AT TIME ZONE 'Asia/Shanghai',
        'YYYY'
      ) AS "periodKey"
    FROM "numbering_rules" AS rule
    JOIN "numbering_rule_versions" AS version
      ON version."rule_id" = rule."id"
      AND version."status" = 'ACTIVE'
    WHERE rule."rule_code" = 'FUND_POSTING_BATCH_NO'
      AND rule."status" = 'ENABLED'
      AND rule."purpose" = 'BUSINESS'
    LIMIT 1
  `)
  const row = rule.rows[0]
  if (row === undefined) {
    throw new Error('FUND_POSTING_BATCH_NO is unavailable')
  }

  await client.query(`
    INSERT INTO "numbering_period_states" (
      "rule_id", "period_key", "next_sequence_value", "used_count"
    )
    VALUES ($1, $2, NULL, 0)
    ON CONFLICT ("rule_id", "period_key") DO NOTHING
  `, [row.ruleId, row.periodKey])

  const issuanceId = randomUUID()
  await client.query(`
    INSERT INTO "numbering_issuances" (
      "id", "rule_id", "rule_version_id", "period_key",
      "generated_number", "sequence_value", "consumer_code",
      "idempotency_key_hash", "request_fingerprint_hash"
    )
    VALUES ($1, $2, $3, $4, $5, NULL, 'FUND_POSTING', $6, $7)
  `, [
    issuanceId,
    row.ruleId,
    row.versionId,
    row.periodKey,
    generatedNumber,
    randomBytes(32),
    randomBytes(32),
  ])
  return issuanceId
}
