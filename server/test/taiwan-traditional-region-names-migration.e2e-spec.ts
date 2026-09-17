import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Client } from 'pg'

const migrationRoot = resolve(__dirname, '../prisma/migrations')
const migration = readFileSync(resolve(migrationRoot, '20260917020000_taiwan_traditional_region_names/migration.sql'), 'utf8')

function isolatedDatabaseUrl(): string {
  const value = process.env.DATABASE_URL
  if (!value) throw new Error('Isolated test database is required')
  const url = new URL(value)
  if (url.username !== 'qianshu_ci' || url.pathname !== '/qianshu_ci'
    || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error('Database is outside isolated boundary')
  }
  return value
}

interface RegionRow {
  id: string
  code: string
  name: string
  normalized_name: string
  source_name: string | null
  level: string
  updated_at: Date
}

async function readRegions(client: Client): Promise<RegionRow[]> {
  return (await client.query<RegionRow>('SELECT * FROM regions ORDER BY code')).rows
}

async function withSeed(action: (client: Client) => Promise<void>) {
  const client = new Client({ connectionString: isolatedDatabaseUrl() })
  const schema = `taiwan_names_${randomUUID().replaceAll('-', '')}`
  await client.connect()
  try {
    await client.query(`CREATE SCHEMA "${schema}"`)
    await client.query(`SET search_path TO "${schema}", public`)
    for (const directory of [
      '20260717090000_user_auth_rbac',
      '20260727090000_regions_schema_and_permissions',
      '20260727100000_regions_seed',
    ]) {
      await client.query(readFileSync(resolve(migrationRoot, directory, 'migration.sql'), 'utf8'))
    }
    await action(client)
  }
  finally {
    await client.query('ROLLBACK')
    await client.query('RESET search_path')
    await client.query(`DROP SCHEMA "${schema}" CASCADE`)
    await client.end()
  }
}

describe('Taiwan traditional county names migration', () => {
  jest.setTimeout(30_000)

  it('updates only Taiwan CITY names, preserves other fields and all other regions, and is repeatable', async () => {
    await withSeed(async (client) => {
      // 模拟现有地区配置和业务外键，保证改名不会重建节点或覆盖管理员设置。
      await client.query(`UPDATE regions SET enabled = false, sort_order = 99 WHERE code = 'TW-63000'`)
      await client.query(`CREATE TABLE region_reference (city_id uuid REFERENCES regions(id), address_snapshot text)`)
      await client.query(`INSERT INTO region_reference SELECT id, '中国台湾 台湾 台北市 原地址' FROM regions WHERE code = 'TW-63000'`)
      const before = await readRegions(client)
      const references = (await client.query('SELECT * FROM region_reference')).rows

      await client.query(migration)

      const after = await readRegions(client)
      const taiwanCities = after.filter(row => row.code.startsWith('TW-') && row.level === 'CITY')
      expect(taiwanCities).toHaveLength(22)
      expect(after).toHaveLength(before.length)
      for (const [index, row] of after.entries()) {
        const original = before[index]
        if (row.code.startsWith('TW-') && row.level === 'CITY' && original.name !== original.source_name) {
          expect(row.updated_at).toBeInstanceOf(Date)
          expect(row.updated_at.getTime()).toBeGreaterThanOrEqual(original.updated_at.getTime())
          expect(row).toEqual({ ...original, name: original.source_name, normalized_name: original.source_name, updated_at: row.updated_at })
        }
        else {
          expect(row).toEqual(original)
        }
      }
      expect(taiwanCities.every(row => row.name === row.source_name && row.normalized_name === row.source_name)).toBe(true)
      expect((await client.query('SELECT * FROM region_reference')).rows).toEqual(references)

      await client.query(migration)
      expect(await readRegions(client)).toEqual(after)
    })
  })

  it('rolls back all changes when a target is missing from the expected hierarchy', async () => {
    await withSeed(async (client) => {
      await client.query(`DELETE FROM regions WHERE code = 'TW-63000'`)
      const before = await readRegions(client)
      await expect(client.query(migration)).rejects.toThrow('Taiwan county hierarchy does not match')
      await client.query('ROLLBACK')
      expect(await readRegions(client)).toEqual(before)
    })
  })

  it('rolls back all names when a traditional sibling name already belongs to another node', async () => {
    await withSeed(async (client) => {
      await client.query(`
        INSERT INTO regions (code, name, normalized_name, administrative_type, level, parent_id)
        SELECT 'TW-CUSTOM', '臺北市', '臺北市', 'COUNTY_CITY', 'CITY', id
        FROM regions WHERE code = 'TW-TAIWAN'
      `)
      const before = await readRegions(client)
      await expect(client.query(migration)).rejects.toMatchObject({ code: '23505' })
      await client.query('ROLLBACK')
      expect(await readRegions(client)).toEqual(before)
    })
  })
})
