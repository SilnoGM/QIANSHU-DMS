import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { Client } from 'pg'

type RegionLevel = 'CITY' | 'COUNTRY_REGION' | 'PROVINCE_STATE'

interface CanonicalRegion {
  administrativeType: string
  code: string
  enabled: boolean
  englishName: string | null
  id: string
  level: RegionLevel
  name: string
  normalizedName: string
  parentId: string | null
  sortOrder: number
  sourceCode: string | null
  sourceName: string | null
}

interface CanonicalSeed {
  regions: CanonicalRegion[]
}

interface RegionCount {
  count: number
  domain: string
  level: RegionLevel
}

const serverRoot = resolve(__dirname, '..')
const canonicalSeed = JSON.parse(
  readFileSync(
    resolve(serverRoot, 'prisma/region-data/regions.seed.json'),
    'utf8',
  ),
) as CanonicalSeed

function requireDatabaseUrl(): string {
  const value = process.env.DATABASE_URL

  if (!value) {
    throw new Error('DATABASE_URL is required for E2E tests')
  }

  return value
}

function buildExpectedCounts(regions: CanonicalRegion[]): RegionCount[] {
  const counts = new Map<string, number>()

  for (const region of regions) {
    const domain = region.code.split('-')[0]
    const key = `${domain}/${region.level}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  return [...counts.entries()]
    .map(([key, count]) => {
      const [domain, level] = key.split('/') as [string, RegionLevel]
      return { count, domain, level }
    })
    .sort((left, right) =>
      left.domain.localeCompare(right.domain) ||
      left.level.localeCompare(right.level),
    )
}

describe('canonical region seed migration against PostgreSQL', () => {
  let client: Client

  beforeAll(async () => {
    client = new Client({ connectionString: requireDatabaseUrl() })
    await client.connect()
  })

  afterAll(async () => {
    await client.end()
  })

  it('persists all 602 canonical fields and deterministic identities exactly', async () => {
    const result = await client.query<CanonicalRegion>(`
      SELECT
        "id"::text AS "id",
        "code",
        "name",
        "normalized_name" AS "normalizedName",
        "english_name" AS "englishName",
        "source_name" AS "sourceName",
        "source_code" AS "sourceCode",
        "administrative_type" AS "administrativeType",
        "level"::text AS "level",
        "parent_id"::text AS "parentId",
        "enabled",
        "sort_order" AS "sortOrder"
      FROM "regions"
      ORDER BY
        CASE "level"
          WHEN 'COUNTRY_REGION' THEN 0
          WHEN 'PROVINCE_STATE' THEN 1
          WHEN 'CITY' THEN 2
        END,
        "code"
    `)

    // 这里故意全量比较 602 行全部 canonical 字段，防止“数量正确但内容漂移”。
    expect(result.rows).toEqual(canonicalSeed.regions)
  })

  it('matches every domain/level count and keeps every technical code unique', async () => {
    const counts = await client.query<RegionCount>(`
      SELECT
        split_part("code", '-', 1) AS "domain",
        "level"::text AS "level",
        count(*)::integer AS "count"
      FROM "regions"
      GROUP BY split_part("code", '-', 1), "level"
      ORDER BY "domain", "level"::text
    `)
    const identityCounts = await client.query<{
      total: number
      uniqueCodes: number
    }>(`
      SELECT
        count(*)::integer AS "total",
        count(DISTINCT "code")::integer AS "uniqueCodes"
      FROM "regions"
    `)

    expect(counts.rows).toEqual(buildExpectedCounts(canonicalSeed.regions))
    expect(identityCounts.rows).toEqual([
      { total: 602, uniqueCodes: 602 },
    ])
  })

  it('keeps all CITY parent chains and the three critical paths exact', async () => {
    const completeCityChains = await client.query<{ count: number }>(`
      SELECT count(*)::integer AS "count"
      FROM "regions" AS city
      JOIN "regions" AS province
        ON province."id" = city."parent_id"
        AND province."level" = 'PROVINCE_STATE'
      JOIN "regions" AS country
        ON country."id" = province."parent_id"
        AND country."level" = 'COUNTRY_REGION'
      WHERE city."level" = 'CITY'
    `)
    const criticalPaths = await client.query<{
      city: string
      cityCode: string
      country: string
      province: string
      sourceCode: string | null
    }>(`
      SELECT
        city."code" AS "cityCode",
        country."name" AS "country",
        province."name" AS "province",
        city."name" AS "city",
        city."source_code" AS "sourceCode"
      FROM "regions" AS city
      JOIN "regions" AS province ON province."id" = city."parent_id"
      JOIN "regions" AS country ON country."id" = province."parent_id"
      WHERE city."code" IN (
        'CN-110000-CITY',
        'TW-64000',
        'MY-01-01'
      )
      ORDER BY city."code"
    `)

    expect(completeCityChains.rows).toEqual([{ count: 551 }])
    expect(criticalPaths.rows).toEqual([
      {
        city: '北京市',
        cityCode: 'CN-110000-CITY',
        country: '中国',
        province: '北京市',
        sourceCode: '110000',
      },
      {
        city: 'Batu Pahat',
        cityCode: 'MY-01-01',
        country: '马来西亚',
        province: '柔佛',
        sourceCode: '1_1',
      },
      {
        city: '高雄市',
        cityCode: 'TW-64000',
        country: '中国台湾',
        province: '台湾',
        sourceCode: 'E/64000',
      },
    ])
  })
})
