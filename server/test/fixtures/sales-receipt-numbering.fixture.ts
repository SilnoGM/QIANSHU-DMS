import { randomBytes } from 'node:crypto'
import type { Client } from 'pg'
import { calculateNumberingConfigFingerprint } from '../../src/modules/numbering/numbering-config-fingerprint'

/** 仅用于隔离测试；生产迁移绝不替管理员配置或启用编号规则。 */
export async function ensureCollectionRule(client: Client, ruleCode = 'SALES_COLLECTION') {
  const existing = await client.query<{ ruleId: string; ruleVersionId: string }>(`SELECT rule.id AS "ruleId",version.id AS "ruleVersionId"
    FROM numbering_rules rule JOIN numbering_rule_versions version ON version.rule_id=rule.id AND version.status='ACTIVE'
    WHERE rule.rule_code=$1`, [ruleCode])
  if (existing.rows[0]) return existing.rows[0]
  const rule = await client.query<{ id: string }>(`INSERT INTO numbering_rules (rule_code,name,purpose) VALUES ($1,'收款编号测试规则','BUSINESS') RETURNING id`, [ruleCode])
  const ruleId = rule.rows[0].id
  const fingerprint = calculateNumberingConfigFingerprint({ resetPolicy: 'NEVER', segments: [
    { type: 'FIXED', value: 'SC' }, { type: 'SEPARATOR', value: '-' }, { type: 'SEQUENCE', width: 12, startValue: '1', step: '1' },
  ] })
  const version = await client.query<{ id: string }>(`INSERT INTO numbering_rule_versions (rule_id,revision,reset_policy,config_fingerprint)
    VALUES ($1,1,'NEVER',$2) RETURNING id`, [ruleId, fingerprint])
  const ruleVersionId = version.rows[0].id
  await client.query(`INSERT INTO numbering_rule_segments (version_id,position,type,fixed_value,separator_value,sequence_width,sequence_start_value,sequence_step)
    VALUES ($1,0,'FIXED','SC',NULL,NULL,NULL,NULL),($1,1,'SEPARATOR',NULL,'-',NULL,NULL,NULL),($1,2,'SEQUENCE',NULL,NULL,12,1,1)`, [ruleVersionId])
  await client.query(`UPDATE numbering_rule_versions SET status='ACTIVE',published_at=CURRENT_TIMESTAMP WHERE id=$1`, [ruleVersionId])
  await client.query(`UPDATE numbering_rules SET status='ENABLED',version=3 WHERE id=$1`, [ruleId])
  return { ruleId, ruleVersionId }
}

export async function insertCollectionIssuance(client: Client, requestFingerprintHash: Buffer, options: { ruleCode?: string; consumerCode?: string } = {}) {
  const rule = await ensureCollectionRule(client, options.ruleCode)
  const state = await client.query<{ value: string }>(`INSERT INTO numbering_period_states (rule_id,period_key,next_sequence_value,used_count)
    VALUES ($1,'ALL',2,1) ON CONFLICT (rule_id,period_key) DO UPDATE
    SET next_sequence_value=numbering_period_states.next_sequence_value+1,used_count=numbering_period_states.used_count+1
    RETURNING (next_sequence_value-1)::text AS value`, [rule.ruleId])
  const collectionNo = `SC-${state.rows[0].value.padStart(12, '0')}`
  const issuance = await client.query<{ id: string }>(`INSERT INTO numbering_issuances
    (rule_id,rule_version_id,period_key,generated_number,sequence_value,consumer_code,idempotency_key_hash,request_fingerprint_hash)
    VALUES ($1,$2,'ALL',$3,$4,$5,$6,$7) RETURNING id`,
  [rule.ruleId, rule.ruleVersionId, collectionNo, state.rows[0].value, options.consumerCode ?? 'SALES_COLLECTION.CREATE', randomBytes(32), requestFingerprintHash])
  return { collectionNo, numberingIssuanceId: issuance.rows[0].id }
}
