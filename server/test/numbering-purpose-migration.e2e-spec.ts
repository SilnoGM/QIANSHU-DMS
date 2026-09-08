import { Client } from 'pg'
import { createIsolatedNumberingDatabase } from './numbering-e2e-database'

describe('numbering purpose forward migration', () => {
  jest.setTimeout(90_000)
  it('backfills historical rules without rewriting any version, sequence or issued number', async () => {
    let before: unknown
    const snapshot = async (client: Client, migrated: boolean) => {
      const rows = await client.query(`SELECT
        (SELECT jsonb_agg(${migrated ? "to_jsonb(r) - 'purpose'" : 'to_jsonb(r)'}) FROM numbering_rules r) AS rules,
        (SELECT jsonb_agg(v) FROM numbering_rule_versions v) AS versions,
        (SELECT jsonb_agg(s) FROM numbering_period_states s) AS states,
        (SELECT jsonb_agg(i) FROM numbering_issuances i) AS issuances`)
      return rows.rows[0] as unknown
    }
    const database = await createIsolatedNumberingDatabase({
      beforePurposeMigration: async (client) => {
        await client.query(`
          INSERT INTO numbering_rules(id, rule_code, name) VALUES ('10000000-0000-4000-8000-000000000001', 'LEGACY', '历史业务');
          INSERT INTO numbering_rule_versions(id, rule_id, revision, status, reset_policy, config_fingerprint, published_at)
            VALUES ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 1, 'ACTIVE', 'NEVER', repeat('a',64), now());
          INSERT INTO numbering_period_states(rule_id, period_key, next_sequence_value, used_count)
            VALUES ('10000000-0000-4000-8000-000000000001', 'ALL', 74, 73);
          INSERT INTO numbering_issuances(rule_id, rule_version_id, period_key, generated_number, sequence_value, consumer_code, idempotency_key_hash, request_fingerprint_hash)
            VALUES ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'ALL', 'LEGACY/0073', 73, 'LEGACY.TEST', decode(repeat('a',64),'hex'), decode(repeat('b',64),'hex'));
        `)
        before = await snapshot(client, false)
      },
    })
    const client = new Client({ connectionString: database.databaseUrl })
    try {
      await client.connect()
      expect(await snapshot(client, true)).toEqual(before)
      expect((await client.query('SELECT purpose FROM numbering_rules')).rows).toEqual([{ purpose: 'BUSINESS' }])
      const column = await client.query(`SELECT is_nullable, column_default FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'numbering_rules' AND column_name = 'purpose'`)
      expect(column.rows).toEqual([{ is_nullable: 'NO', column_default: null }])
      await expect(client.query("UPDATE numbering_rules SET purpose = 'SHIPPING_MARK'"))
        .rejects.toMatchObject({ code: '23514', constraint: 'numbering_rules_purpose_immutable_check' })
      await expect(client.query("INSERT INTO numbering_rules(rule_code,name) VALUES ('MISSING','缺用途')"))
        .rejects.toMatchObject({ code: '23502' })
      await expect(client.query("INSERT INTO numbering_rules(rule_code,name,purpose) VALUES ('INVALID','非法用途','ALL')"))
        .rejects.toMatchObject({ code: '22P02' })
    }
    finally { await client.end(); await database.dispose() }
  })
})
