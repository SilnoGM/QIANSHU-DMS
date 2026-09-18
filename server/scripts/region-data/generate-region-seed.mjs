import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serializeTaiwanTraditionalNamesMigration } from './taiwan-traditional-names.mjs'

export const UUID_NAMESPACE = '9acbca9a-32e2-4d7c-b00f-26a2e0dc5c1e'

export const EXPECTED_SOURCE_HASHES = Object.freeze({
  chinaMainland:
    '8c4e8afc5dfc16b77d34cf39b2547d07ab6a46e46b414679d494e50353970edc',
  taiwan:
    '5e9dfa16d989e569179f02375775ac5f0036d866305a4e11456e989ff59504f1',
  malaysia:
    '6ed9f08a88e3bd93a3cfe697b2135352688c495ae4595c6a37ae0980fffe7995',
})

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const DEFAULT_DATA_DIRECTORY = resolve(
  SCRIPT_DIRECTORY,
  '../../prisma/region-data',
)
const DEFAULT_SEED_MIGRATION_PATH = resolve(
  SCRIPT_DIRECTORY,
  '../../prisma/migrations/20260727100000_regions_seed/migration.sql',
)
const TAIWAN_NAMES_MIGRATION_PATH = resolve(
  SCRIPT_DIRECTORY,
  '../../prisma/migrations/20260917020000_taiwan_traditional_region_names/migration.sql',
)
const LEVEL_ORDER = Object.freeze({
  COUNTRY_REGION: 0,
  PROVINCE_STATE: 1,
  CITY: 2,
})
const EXPECTED_COUNTS = Object.freeze({
  byDomain: {
    CN: {
      COUNTRY_REGION: 1,
      PROVINCE_STATE: 31,
      CITY: 369,
      total: 401,
    },
    TW: {
      COUNTRY_REGION: 1,
      PROVINCE_STATE: 1,
      CITY: 22,
      total: 24,
    },
    MY: {
      COUNTRY_REGION: 1,
      PROVINCE_STATE: 16,
      CITY: 160,
      total: 177,
    },
  },
  byLevel: {
    COUNTRY_REGION: 3,
    PROVINCE_STATE: 48,
    CITY: 551,
  },
  total: 602,
})
const MUNICIPALITY_CODES = new Set(['110000', '120000', '310000', '500000'])
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9._-]{1,63}$/
const ADMINISTRATIVE_TYPE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/
const UUID_PATTERN =
  /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/

function invariant(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

/**
 * 对数据库显示字段执行统一 canonical 归一化。
 *
 * `null`、`undefined` 和归一化后的空串都返回 `null`，便于可空来源字段与后续
 * Service 使用相同语义；必填字段由 `createRegion` 单独拒绝空值。
 */
export function normalizeDisplayText(value) {
  if (value === null || value === undefined) {
    return null
  }

  const normalized = String(value)
    .normalize('NFC')
    .trim()
    .replace(/\s+/gu, ' ')

  return normalized.length === 0 ? null : normalized
}

export function normalizeRegionName(value) {
  const display = normalizeDisplayText(value)
  invariant(display !== null, '地区名称归一化后不能为空')

  return normalizeDisplayText(
    display.toLocaleLowerCase('en-US').normalize('NFC'),
  )
}

function normalizeCode(value) {
  const code = String(value).trim().toUpperCase()
  invariant(CODE_PATTERN.test(code), `地区技术编码格式非法：${code}`)
  return code
}

function uuidToBytes(uuid) {
  const match = UUID_PATTERN.exec(uuid.toLowerCase())
  invariant(match, `UUID namespace 格式非法：${uuid}`)
  return Buffer.from(match.slice(1).join(''), 'hex')
}

function bytesToUuid(bytes) {
  const hex = Buffer.from(bytes).toString('hex')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-')
}

/**
 * Node.js 内置 crypto 没有 UUIDv5 高层 API，因此按 RFC 4122 明确设置 SHA-1
 * namespace hash 的 version/variant 位。输入始终是规范化技术编码，确保 migration、
 * 测试和所有环境得到相同主键。
 */
export function regionIdForCode(value) {
  const code = normalizeCode(value)
  const digest = createHash('sha1')
    .update(uuidToBytes(UUID_NAMESPACE))
    .update(Buffer.from(`region:${code}`, 'utf8'))
    .digest()
    .subarray(0, 16)

  digest[6] = (digest[6] & 0x0f) | 0x50
  digest[8] = (digest[8] & 0x3f) | 0x80

  return bytesToUuid(digest)
}

function createRegion({
  code: rawCode,
  name: rawName,
  englishName: rawEnglishName = null,
  sourceName: rawSourceName = null,
  sourceCode: rawSourceCode = null,
  administrativeType,
  level,
  parentId,
  sortOrder,
}) {
  const code = normalizeCode(rawCode)
  const name = normalizeDisplayText(rawName)
  const englishName = normalizeDisplayText(rawEnglishName)
  const sourceName = normalizeDisplayText(rawSourceName)
  const sourceCode = normalizeDisplayText(rawSourceCode)

  invariant(name !== null, `${code} 的显示名称不能为空`)
  invariant(
    Array.from(name).length <= 128,
    `${code} 的显示名称超过 128 个 Unicode code points`,
  )
  invariant(
    englishName === null || Array.from(englishName).length <= 128,
    `${code} 的英文名称超过 128 个 Unicode code points`,
  )
  invariant(
    sourceName === null || Array.from(sourceName).length <= 128,
    `${code} 的来源名称超过 128 个 Unicode code points`,
  )
  invariant(
    sourceCode === null ||
      (/^[\x20-\x7e]{1,64}$/.test(sourceCode) &&
        Array.from(sourceCode).length <= 64),
    `${code} 的来源编码必须是 1..64 个非控制 ASCII 字符`,
  )
  invariant(
    ADMINISTRATIVE_TYPE_PATTERN.test(administrativeType),
    `${code} 的行政类型格式非法：${administrativeType}`,
  )
  invariant(level in LEVEL_ORDER, `${code} 的层级非法：${level}`)
  invariant(
    Number.isInteger(sortOrder) && sortOrder >= 0,
    `${code} 的排序值必须是非负整数`,
  )

  return {
    id: regionIdForCode(code),
    code,
    name,
    normalizedName: normalizeRegionName(name),
    englishName,
    sourceName,
    sourceCode,
    administrativeType,
    level,
    parentId,
    enabled: true,
    sortOrder,
  }
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex')
}

function stableRegionCompare(left, right) {
  const levelDifference = LEVEL_ORDER[left.level] - LEVEL_ORDER[right.level]

  if (levelDifference !== 0) {
    return levelDifference
  }

  return left.code < right.code ? -1 : left.code > right.code ? 1 : 0
}

function chinaProvinceType(name) {
  if (name.endsWith('自治区')) {
    return 'AUTONOMOUS_REGION'
  }
  if (name.endsWith('市')) {
    return 'MUNICIPALITY'
  }
  return 'PROVINCE'
}

function chinaCityType(sourceCode, name) {
  if (Number(sourceCode) % 100 !== 0) {
    return 'DIRECT_ADMIN_COUNTY_LEVEL'
  }
  if (name.endsWith('自治州')) {
    return 'AUTONOMOUS_PREFECTURE'
  }
  if (name.endsWith('地区')) {
    return 'PREFECTURE'
  }
  if (name.endsWith('盟')) {
    return 'LEAGUE'
  }
  return 'PREFECTURE_LEVEL_CITY'
}

function transformChinaMainland(rawSource) {
  const parsed = JSON.parse(rawSource)
  invariant(Array.isArray(parsed.items), '中国大陆来源缺少 items 数组')

  const activeProvinces = parsed.items
    .filter(
      item =>
        item.end === undefined &&
        Number.isInteger(item.code) &&
        item.code < 710000,
    )
    .sort((left, right) => left.code - right.code)
  invariant(activeProvinces.length === 31, '中国大陆省级来源数量必须为 31')

  const country = createRegion({
    code: 'CN',
    name: '中国',
    administrativeType: 'COUNTRY_REGION',
    level: 'COUNTRY_REGION',
    parentId: null,
    sortOrder: 10,
  })
  const provinces = []
  const cities = []

  for (const [provinceIndex, sourceProvince] of activeProvinces.entries()) {
    const sourceCode = String(sourceProvince.code)
    const province = createRegion({
      code: `CN-${sourceCode}`,
      name: sourceProvince.name,
      sourceName: sourceProvince.name,
      sourceCode,
      administrativeType: chinaProvinceType(sourceProvince.name),
      level: 'PROVINCE_STATE',
      parentId: country.id,
      sortOrder: provinceIndex + 1,
    })
    provinces.push(province)

    if (MUNICIPALITY_CODES.has(sourceCode)) {
      cities.push(
        createRegion({
          code: `CN-${sourceCode}-CITY`,
          name: sourceProvince.name,
          sourceName: sourceProvince.name,
          sourceCode,
          administrativeType: 'MUNICIPALITY_CITY',
          level: 'CITY',
          parentId: province.id,
          sortOrder: 1,
        }),
      )
      continue
    }

    const activeChildren = (sourceProvince.children ?? [])
      .filter(child => child.end === undefined)
      .sort((left, right) => left.code - right.code)

    for (const [cityIndex, sourceCity] of activeChildren.entries()) {
      const citySourceCode = String(sourceCity.code)
      cities.push(
        createRegion({
          code: `CN-${citySourceCode}`,
          name: sourceCity.name,
          sourceName: sourceCity.name,
          sourceCode: citySourceCode,
          administrativeType: chinaCityType(
            citySourceCode,
            sourceCity.name,
          ),
          level: 'CITY',
          parentId: province.id,
          sortOrder: cityIndex + 1,
        }),
      )
    }
  }

  invariant(cities.length === 369, '中国大陆城市层转换数量必须为 369')
  invariant(
    cities.filter(
      city => city.administrativeType === 'DIRECT_ADMIN_COUNTY_LEVEL',
    ).length === 32,
    '中国大陆省直管县级业务叶子必须为 32',
  )

  return [country, ...provinces, ...cities]
}

function parseTaiwanCounties(rawSource) {
  const countyPattern =
    /<countyItem>\s*<countycode>([^<]+)<\/countycode>\s*<countyname>([^<]+)<\/countyname>\s*<countycode01>([^<]+)<\/countycode01>\s*<\/countyItem>/gu
  const counties = [...rawSource.matchAll(countyPattern)].map(match => ({
    countycode: match[1],
    countyname: match[2],
    countycode01: match[3],
  }))

  invariant(counties.length === 22, '中国台湾 ListCounty 必须包含 22 个县市')
  return counties
}

function transformTaiwan(rawSource, reviewedMappings) {
  const country = createRegion({
    code: 'TW',
    name: '中国台湾',
    administrativeType: 'COUNTRY_REGION',
    level: 'COUNTRY_REGION',
    parentId: null,
    sortOrder: 20,
  })
  const province = createRegion({
    code: 'TW-TAIWAN',
    name: '台湾',
    administrativeType: 'SYNTHETIC_PROVINCE_STATE',
    level: 'PROVINCE_STATE',
    parentId: country.id,
    sortOrder: 1,
  })
  const counties = parseTaiwanCounties(rawSource)
  invariant(
    Object.keys(reviewedMappings).length === 22,
    '中国台湾人工审校映射必须精确包含 22 项',
  )

  const cities = counties.map((county, index) => {
    const displayName = reviewedMappings[county.countyname]
    invariant(
      typeof displayName === 'string',
      `中国台湾缺少人工审校映射：${county.countyname}`,
    )
    invariant(displayName === county.countyname, '台湾县市显示名必须使用官方繁体原文')

    return createRegion({
      code: `TW-${county.countycode01}`,
      name: displayName,
      sourceName: county.countyname,
      sourceCode: `${county.countycode}/${county.countycode01}`,
      administrativeType: 'COUNTY_CITY',
      level: 'CITY',
      parentId: province.id,
      sortOrder: index + 1,
    })
  })

  invariant(
    new Set(counties.map(county => county.countyname)).size ===
      Object.keys(reviewedMappings).length,
    '中国台湾人工审校映射包含来源之外的名称',
  )

  return [country, province, ...cities]
}

/**
 * 当前固定 CSV 不含逗号或换行字段，但仍实现标准双引号转义，避免转换正确性依赖
 * `split(',')` 的隐含前提。来源 hash 在调用此解析器之前已经验证。
 */
function parseCsvLine(line) {
  const values = []
  let value = ''
  let quoted = false

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (character === ',' && !quoted) {
      values.push(value)
      value = ''
    } else {
      value += character
    }
  }

  invariant(!quoted, '马来西亚 CSV 存在未闭合双引号')
  values.push(value)
  return values
}

function parseMalaysiaDistricts(rawSource) {
  const lines = rawSource.trim().split(/\r?\n/u)
  const header = parseCsvLine(lines.shift())
  const expectedHeader = [
    'state',
    'district',
    'code_state',
    'code_district',
    'code_state_district',
  ]
  invariant(
    JSON.stringify(header) === JSON.stringify(expectedHeader),
    '马来西亚 CSV 表头发生漂移',
  )

  const rows = lines.map((line, index) => {
    const values = parseCsvLine(line)
    invariant(values.length === header.length, `马来西亚 CSV 第 ${index + 2} 行列数错误`)
    return Object.fromEntries(header.map((key, column) => [key, values[column]]))
  })
  invariant(rows.length === 160, '马来西亚 CSV 必须包含 160 个行政区')
  return rows
}

function transformMalaysia(rawSource, reviewedMappings) {
  const rows = parseMalaysiaDistricts(rawSource)
  const country = createRegion({
    code: 'MY',
    name: '马来西亚',
    administrativeType: 'COUNTRY_REGION',
    level: 'COUNTRY_REGION',
    parentId: null,
    sortOrder: 30,
  })
  const stateEntries = new Map()

  for (const row of rows) {
    const existing = stateEntries.get(row.code_state)
    invariant(
      existing === undefined || existing === row.state,
      `马来西亚州代码 ${row.code_state} 对应多个名称`,
    )
    stateEntries.set(row.code_state, row.state)
  }

  const sortedStates = [...stateEntries.entries()].sort(
    ([left], [right]) => Number(left) - Number(right),
  )
  invariant(sortedStates.length === 16, '马来西亚州级来源数量必须为 16')
  invariant(
    Object.keys(reviewedMappings).length === 16,
    '马来西亚州级人工审校映射必须精确包含 16 项',
  )

  const provinces = sortedStates.map(([sourceCode, sourceName]) => {
    const displayName = reviewedMappings[sourceName]
    invariant(
      typeof displayName === 'string',
      `马来西亚缺少州级人工审校映射：${sourceName}`,
    )
    const twoDigitCode = sourceCode.padStart(2, '0')

    return createRegion({
      code: `MY-${twoDigitCode}`,
      name: displayName,
      englishName: sourceName,
      sourceName,
      sourceCode,
      administrativeType:
        Number(sourceCode) >= 14 ? 'FEDERAL_TERRITORY' : 'STATE',
      level: 'PROVINCE_STATE',
      parentId: country.id,
      sortOrder: Number(sourceCode),
    })
  })
  const provinceBySourceCode = new Map(
    sortedStates.map(([sourceCode], index) => [sourceCode, provinces[index]]),
  )
  const seenReviewedStates = new Set(sortedStates.map(([, name]) => name))
  invariant(
    Object.keys(reviewedMappings).every(name => seenReviewedStates.has(name)),
    '马来西亚州级人工审校映射包含来源之外的名称',
  )

  const cities = rows.map(row => {
    const province = provinceBySourceCode.get(row.code_state)
    invariant(province, `马来西亚行政区缺少州级父节点：${row.code_state}`)
    const stateCode = row.code_state.padStart(2, '0')
    const districtCode = row.code_district.padStart(2, '0')

    return createRegion({
      code: `MY-${stateCode}-${districtCode}`,
      name: row.district,
      sourceName: row.district,
      sourceCode: row.code_state_district,
      administrativeType: 'ADMINISTRATIVE_DISTRICT',
      level: 'CITY',
      parentId: province.id,
      sortOrder: Number(row.code_district),
    })
  })

  return [country, ...provinces, ...cities]
}

function countRegions(regions) {
  const counts = {
    byDomain: {
      CN: { COUNTRY_REGION: 0, PROVINCE_STATE: 0, CITY: 0, total: 0 },
      TW: { COUNTRY_REGION: 0, PROVINCE_STATE: 0, CITY: 0, total: 0 },
      MY: { COUNTRY_REGION: 0, PROVINCE_STATE: 0, CITY: 0, total: 0 },
    },
    byLevel: {
      COUNTRY_REGION: 0,
      PROVINCE_STATE: 0,
      CITY: 0,
    },
    total: regions.length,
  }

  for (const region of regions) {
    const domain = region.code.split('-')[0]
    invariant(domain in counts.byDomain, `未知地区数据域：${domain}`)
    counts.byDomain[domain][region.level] += 1
    counts.byDomain[domain].total += 1
    counts.byLevel[region.level] += 1
  }

  return counts
}

function validateManifest(manifest) {
  invariant(
    manifest.transformVersion === '1.1.0',
    'manifest transformVersion 必须为 1.1.0',
  )
  invariant(
    manifest.uuidNamespace === UUID_NAMESPACE,
    'manifest UUID namespace 发生漂移',
  )
  invariant(
    JSON.stringify(manifest.expectedCounts) === JSON.stringify(EXPECTED_COUNTS),
    'manifest 固定数量发生漂移',
  )

  for (const [domain, expectedHash] of Object.entries(
    EXPECTED_SOURCE_HASHES,
  )) {
    invariant(manifest.sources[domain], `manifest 缺少 ${domain} 来源`)
    invariant(
      manifest.sources[domain].sha256 === expectedHash,
      `manifest 中 ${domain} SHA-256 发生漂移`,
    )
  }
}

function validateHierarchyAndIdentity(regions) {
  const byId = new Map()
  const byCode = new Map()

  for (const region of regions) {
    invariant(!byId.has(region.id), `地区 UUID 重复：${region.id}`)
    invariant(!byCode.has(region.code), `地区技术编码重复：${region.code}`)
    invariant(
      region.id === regionIdForCode(region.code),
      `${region.code} 的确定性 UUID 不正确`,
    )
    byId.set(region.id, region)
    byCode.set(region.code, region)
  }

  const siblingNames = new Set()
  for (const region of regions) {
    const parent = region.parentId === null ? null : byId.get(region.parentId)
    if (region.level === 'COUNTRY_REGION') {
      invariant(parent === null, `${region.code} 根节点不得有父级`)
    } else {
      invariant(parent, `${region.code} 缺少父节点`)
      const expectedParentLevel =
        region.level === 'PROVINCE_STATE' ? 'COUNTRY_REGION' : 'PROVINCE_STATE'
      invariant(
        parent.level === expectedParentLevel,
        `${region.code} 父节点层级错误`,
      )
    }

    const siblingKey = `${region.parentId ?? 'ROOT'}\0${region.normalizedName}`
    invariant(
      !siblingNames.has(siblingKey),
      `${region.code} 与同级节点 normalizedName 重复`,
    )
    siblingNames.add(siblingKey)
  }

  for (const path of [
    ['CN', 'CN-110000', 'CN-110000-CITY'],
    ['TW', 'TW-TAIWAN', 'TW-64000'],
    ['MY', 'MY-01', 'MY-01-01'],
  ]) {
    const [country, province, city] = path.map(code => byCode.get(code))
    invariant(country && province && city, `缺少关键路径：${path.join(' → ')}`)
    invariant(province.parentId === country.id, `关键路径父级错误：${province.code}`)
    invariant(city.parentId === province.id, `关键路径父级错误：${city.code}`)
  }

  const kaohsiung = byCode.get('TW-64000')
  invariant(
    kaohsiung.name === '高雄市' &&
      kaohsiung.sourceName === '高雄市' &&
      kaohsiung.sourceCode === 'E/64000',
    '中国台湾高雄市来源字段错误',
  )
}

async function readAndVerifySources(dataDirectory, manifest) {
  const entries = Object.entries(manifest.sources)
  const sourceBuffers = await Promise.all(
    entries.map(([, source]) =>
      readFile(resolve(dataDirectory, source.file)),
    ),
  )

  // 必须先完成全部原始字节摘要校验，之后才允许进入任何 JSON/XML/CSV 解析。
  for (const [index, [domain]] of entries.entries()) {
    const actualHash = sha256(sourceBuffers[index])
    invariant(
      actualHash === EXPECTED_SOURCE_HASHES[domain],
      `${domain} 原始快照 SHA-256 不匹配：${actualHash}`,
    )
  }

  return Object.fromEntries(
    entries.map(([domain], index) => [
      domain,
      sourceBuffers[index].toString('utf8'),
    ]),
  )
}

export async function buildRegionSeed({
  dataDirectory = DEFAULT_DATA_DIRECTORY,
} = {}) {
  const manifest = JSON.parse(
    await readFile(resolve(dataDirectory, 'manifest.json'), 'utf8'),
  )
  validateManifest(manifest)
  const sources = await readAndVerifySources(dataDirectory, manifest)
  const regions = [
    ...transformChinaMainland(sources.chinaMainland),
    ...transformTaiwan(
      sources.taiwan,
      manifest.reviewedMappings.taiwanCountyNames,
    ),
    ...transformMalaysia(
      sources.malaysia,
      manifest.reviewedMappings.malaysiaStateNames,
    ),
  ].sort(stableRegionCompare)
  const counts = countRegions(regions)

  invariant(
    JSON.stringify(counts) === JSON.stringify(EXPECTED_COUNTS),
    `转换数量错误：${JSON.stringify(counts)}`,
  )
  validateHierarchyAndIdentity(regions)

  return {
    transformVersion: manifest.transformVersion,
    uuidNamespace: manifest.uuidNamespace,
    counts,
    regions,
  }
}

export function serializeRegionSeed(seed) {
  return `${JSON.stringify(seed, null, 2)}\n`
}

function sqlLiteral(value) {
  if (value === null) {
    return 'NULL'
  }

  return `'${String(value).replaceAll("'", "''")}'`
}

function serializeRegionRow(region) {
  const values = [
    `${sqlLiteral(region.id)}::uuid`,
    sqlLiteral(region.code),
    sqlLiteral(region.name),
    sqlLiteral(region.normalizedName),
    sqlLiteral(region.englishName),
    sqlLiteral(region.sourceName),
    sqlLiteral(region.sourceCode),
    sqlLiteral(region.administrativeType),
    `${sqlLiteral(region.level)}::"region_level"`,
    region.parentId === null ? 'NULL' : `${sqlLiteral(region.parentId)}::uuid`,
    region.enabled ? 'true' : 'false',
    String(region.sortOrder),
  ]

  return `  (${values.join(', ')})`
}

function serializeLevelInsert(regions, level) {
  const scopedRegions = regions.filter(region => region.level === level)
  const expected = EXPECTED_COUNTS.byLevel[level]
  invariant(
    scopedRegions.length === expected,
    `${level} migration 行数必须为 ${expected}`,
  )

  return [
    `-- Seed ${level}: ${expected} nodes`,
    'INSERT INTO "regions" (',
    '  "id",',
    '  "code",',
    '  "name",',
    '  "normalized_name",',
    '  "english_name",',
    '  "source_name",',
    '  "source_code",',
    '  "administrative_type",',
    '  "level",',
    '  "parent_id",',
    '  "enabled",',
    '  "sort_order"',
    ')',
    'VALUES',
    `${scopedRegions.map(serializeRegionRow).join(',\n')};`,
  ].join('\n')
}

function serializeCountAssertion({ expected, label, where = '' }) {
  return [
    '  SELECT count(*)::integer',
    '  INTO actual_count',
    where.length > 0
      ? `  FROM "regions"\n  WHERE ${where};`
      : '  FROM "regions";',
    '',
    `  IF actual_count <> ${expected} THEN`,
    `    RAISE EXCEPTION '${label}: expected ${expected}, got %', actual_count;`,
    '  END IF;',
  ].join('\n')
}

function serializeUniqueCodeAssertion() {
  return [
    '  SELECT count(DISTINCT "code")::integer',
    '  INTO actual_count',
    '  FROM "regions";',
    '',
    `  IF actual_count <> ${EXPECTED_COUNTS.total} THEN`,
    `    RAISE EXCEPTION 'region seed unique code count mismatch: expected ${EXPECTED_COUNTS.total}, got %', actual_count;`,
    '  END IF;',
  ].join('\n')
}

function serializePathAssertion({
  cityCode,
  cityName,
  countryName,
  provinceName,
  sourceCode,
}) {
  return [
    '  IF NOT EXISTS (',
    '    SELECT 1',
    '    FROM "regions" AS city',
    '    JOIN "regions" AS province ON province."id" = city."parent_id"',
    '    JOIN "regions" AS country ON country."id" = province."parent_id"',
    `    WHERE city."code" = ${sqlLiteral(cityCode)}`,
    `      AND city."name" = ${sqlLiteral(cityName)}`,
    `      AND city."source_code" = ${sqlLiteral(sourceCode)}`,
    `      AND province."name" = ${sqlLiteral(provinceName)}`,
    `      AND country."name" = ${sqlLiteral(countryName)}`,
    "      AND city.\"level\" = 'CITY'::\"region_level\"",
    "      AND province.\"level\" = 'PROVINCE_STATE'::\"region_level\"",
    "      AND country.\"level\" = 'COUNTRY_REGION'::\"region_level\"",
    '  ) THEN',
    `    RAISE EXCEPTION 'region seed path ${cityCode} mismatch';`,
    '  END IF;',
  ].join('\n')
}

/**
 * migration SQL 只由已经通过 hash、normalizer、数量与层级校验的 canonical seed
 * 生成。三个 level 必须使用三个独立 INSERT，确保 hierarchy trigger 在插入子级前
 * 已经能读取父级；末尾断言让任何额外行、缺行或关键路径漂移整笔事务回滚。
 */
export function serializeRegionSeedMigration(seed) {
  invariant(seed.transformVersion === '1.0.0', '历史 seed migration 已冻结，不得用新转换版本重写')
  invariant(
    JSON.stringify(seed.counts) === JSON.stringify(EXPECTED_COUNTS),
    '只有固定 602 节点 canonical seed 可以生成 migration',
  )

  const countAssertions = [
    serializeCountAssertion({
      expected: EXPECTED_COUNTS.total,
      label: 'region seed total count mismatch',
    }),
    ...Object.entries(EXPECTED_COUNTS.byDomain).flatMap(
      ([domain, domainCounts]) =>
        ['COUNTRY_REGION', 'PROVINCE_STATE', 'CITY'].map(level =>
          serializeCountAssertion({
            expected: domainCounts[level],
            label: `region seed ${domain}/${level} count mismatch`,
            where:
              `split_part("code", '-', 1) = ${sqlLiteral(domain)} ` +
              `AND "level" = ${sqlLiteral(level)}::"region_level"`,
          }),
        ),
    ),
  ]
  const pathAssertions = [
    serializePathAssertion({
      cityCode: 'CN-110000-CITY',
      cityName: '北京市',
      countryName: '中国',
      provinceName: '北京市',
      sourceCode: '110000',
    }),
    serializePathAssertion({
      cityCode: 'TW-64000',
      cityName: '高雄市',
      countryName: '中国台湾',
      provinceName: '台湾',
      sourceCode: 'E/64000',
    }),
    serializePathAssertion({
      cityCode: 'MY-01-01',
      cityName: 'Batu Pahat',
      countryName: '马来西亚',
      provinceName: '柔佛',
      sourceCode: '1_1',
    }),
  ]

  return [
    'BEGIN;',
    '',
    '-- Generated by server/scripts/region-data/generate-region-seed.mjs.',
    '-- Do not edit this migration by hand; regenerate it from regions.seed.json.',
    '',
    serializeLevelInsert(seed.regions, 'COUNTRY_REGION'),
    '',
    serializeLevelInsert(seed.regions, 'PROVINCE_STATE'),
    '',
    serializeLevelInsert(seed.regions, 'CITY'),
    '',
    '-- Fail the transaction if canonical counts, identities or paths drift.',
    'DO $region_seed_assertions$',
    'DECLARE',
    '  actual_count integer;',
    'BEGIN',
    countAssertions.join('\n\n'),
    '',
    serializeUniqueCodeAssertion(),
    '',
    pathAssertions.join('\n\n'),
    'END;',
    '$region_seed_assertions$;',
    '',
    'COMMIT;',
    '',
  ].join('\n')
}

async function runCli(arguments_) {
  const supportedArguments = new Set(['--check', '--migration'])
  const unknownArguments = arguments_.filter(
    argument => !supportedArguments.has(argument),
  )
  invariant(
    unknownArguments.length === 0,
    `未知参数：${unknownArguments.join(', ')}`,
  )
  invariant(arguments_.length <= 1, '--check 与 --migration 不能同时使用')

  const seed = await buildRegionSeed()
  const serialized = serializeRegionSeed(seed)
  const outputPath = resolve(DEFAULT_DATA_DIRECTORY, 'regions.seed.json')
  const migration = serializeTaiwanTraditionalNamesMigration(seed)

  if (arguments_.includes('--check')) {
    const checkedIn = await readFile(outputPath, 'utf8')
    invariant(
      checkedIn === serialized,
      'regions.seed.json 不是当前固定来源的 canonical 输出，请重新生成',
    )
    const checkedInMigration = await readFile(
      DEFAULT_SEED_MIGRATION_PATH,
      'utf8',
    )
    invariant(
      sha256(checkedInMigration) === 'c508cdfc9a44176552a537085bded370d930618ae978a5d41375418b0c75453e',
      '历史地区 seed migration 已发生变化，必须保留已提交的原始版本',
    )
    invariant(
      await readFile(TAIWAN_NAMES_MIGRATION_PATH, 'utf8') === migration,
      '台湾繁体名称 migration 与当前 canonical 输出不一致',
    )
    console.log(
      `Region seed and migration are up to date (${seed.counts.total} nodes).`,
    )
    return
  }

  if (arguments_.includes('--migration')) {
    const checkedIn = await readFile(outputPath, 'utf8')
    invariant(
      checkedIn === serialized,
      '生成 migration 前必须先提交当前 canonical regions.seed.json',
    )
    // 已提交的 migration 不可变；只允许首次生成新的向前数据迁移。
    await mkdir(dirname(TAIWAN_NAMES_MIGRATION_PATH), { recursive: true })
    await writeFile(TAIWAN_NAMES_MIGRATION_PATH, migration, { encoding: 'utf8', flag: 'wx' })
    console.log(
      `Generated ${TAIWAN_NAMES_MIGRATION_PATH} (22 Taiwan cities).`,
    )
    return
  }

  await writeFile(outputPath, serialized, 'utf8')
  console.log(`Generated ${outputPath} (${seed.counts.total} nodes).`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli(process.argv.slice(2)).catch(error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
