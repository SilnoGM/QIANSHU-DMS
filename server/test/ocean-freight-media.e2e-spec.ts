import { randomBytes, randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { insertCollectionIssuance } from './fixtures/sales-receipt-numbering.fixture'

function requireDatabaseUrl(): string {
  const value = process.env.DATABASE_URL
  if (!value) throw new Error('DATABASE_URL is required for ocean freight media tests')
  const url = new URL(value)
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost'].includes(url.hostname)
    || url.username !== 'qianshu_ci' || url.pathname !== '/qianshu_ci') {
    throw new Error('Ocean freight media tests require the isolated CI database')
  }
  return value
}

describe('ocean freight source references after full migration replay', () => {
  const client = new Client({ connectionString: requireDatabaseUrl() })
  const actor = randomUUID()
  const assetId = randomUUID()
  const containerId = randomUUID()
  beforeAll(async () => {
    await client.connect()
    await client.query('BEGIN')
    await client.query(`INSERT INTO users (id,username,username_normalized,display_name,password_hash,password_changed_at,updated_at)
      VALUES ($1,$2,$2,'Ocean source actor','not-a-password',now(),now())`, [actor, `ocean-${actor}`])
    const issuance = await insertCollectionIssuance(client, randomBytes(32), { ruleCode: 'CONTAINER_BATCH_NO', consumerCode: 'CONTAINER_BATCH.CREATE' })
    await client.query(`INSERT INTO media_assets
      (id,media_type,status,upload_purpose,original_filename,object_key,mime_type,size_bytes,checksum_sha256,created_by_user_id)
      VALUES ($1,'DOCUMENT','READY','OCEAN_FREIGHT_SOURCE_XLSX','manifest.xlsx',$2,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',123,$3,$4)`, [assetId, `media/ocean-test/${assetId}.xlsx`, 'a'.repeat(64), actor])
    await client.query(`INSERT INTO container_batches
      (id,container_batch_no,numbering_issuance_id,container_batch_name,loading_date,sequence_in_day,warehouse_value,
      source_file_id,creation_request_key,creation_payload_hash,created_by_id,updated_by_id)
      VALUES ($1,$2,$3,'0919柜','2026-09-19',1,'OCEAN_TEST_WAREHOUSE',$4,$5,$6,$7,$7)`,
    [containerId, issuance.collectionNo, issuance.numberingIssuanceId, assetId, randomUUID(), 'a'.repeat(64), actor])
    // 同事务先激活文件再绑定业务引用，最终校验 deferred trigger。
    await client.query('SET CONSTRAINTS ALL IMMEDIATE')
    await client.query('SET CONSTRAINTS ALL DEFERRED')
  })
  afterAll(async () => {
    await client.query('ROLLBACK')
    await client.end()
  })
  it('retains a READY XLSX source with the new business reference', async () => {
    expect((await client.query('SELECT status,upload_purpose FROM media_assets WHERE id=$1', [assetId])).rows[0])
      .toEqual({ status: 'READY', upload_purpose: 'OCEAN_FREIGHT_SOURCE_XLSX' })
  })
  it.each([
    ['upload_purpose=NULL', 'media_assets_upload_purpose_immutable_check'],
    ["status='TRASHED', deleted_at=now(), retention_until=now()+interval '30 days'", 'ocean_freight_source_ready_check'],
  ])('rejects invalid source mutations: %s', async (update, constraint) => {
    await client.query('SAVEPOINT rejected_source_change')
    try {
      await client.query(`UPDATE media_assets SET ${update} WHERE id=$1`, [assetId])
      await client.query('SET CONSTRAINTS ALL IMMEDIATE')
      throw new Error('Expected invalid source rejection')
    } catch (error) {
      expect(error).toMatchObject({ code: '23514', constraint })
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT rejected_source_change')
      await client.query('RELEASE SAVEPOINT rejected_source_change')
    }
  })
  it('rejects orphaning a READY source by clearing the document reference', async () => {
    await client.query('SAVEPOINT rejected_source_clear')
    try {
      await client.query('UPDATE container_batches SET source_file_id=NULL WHERE id=$1', [containerId])
      await client.query('SET CONSTRAINTS ALL IMMEDIATE')
      throw new Error('Expected orphan source rejection')
    } catch (error) {
      expect(error).toMatchObject({ code: '23514', constraint: 'media_assets_ready_reference_check' })
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT rejected_source_clear')
      await client.query('RELEASE SAVEPOINT rejected_source_clear')
    }
  })
  it('seeds exactly the seven scoped permissions only for system_admin by default', async () => {
    const permissions = await client.query<{ code: string }>(`SELECT code FROM permissions WHERE code LIKE 'container-batches:%' OR code LIKE 'ocean-freight-bills:%'`)
    expect(permissions.rows).toHaveLength(7)
    const roles = await client.query<{ code: string }>(`SELECT DISTINCT role.code FROM role_permissions binding
      JOIN roles role ON role.id=binding.role_id JOIN permissions permission ON permission.id=binding.permission_id
      WHERE permission.code LIKE 'container-batches:%' OR permission.code LIKE 'ocean-freight-bills:%'`)
    expect(roles.rows).toEqual([{ code: 'system_admin' }])
  })
})
