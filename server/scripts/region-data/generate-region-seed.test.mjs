import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  EXPECTED_SOURCE_HASHES,
  UUID_NAMESPACE,
  buildRegionSeed,
  normalizeDisplayText,
  normalizeRegionName,
  regionIdForCode,
  serializeRegionSeed,
} from './generate-region-seed.mjs'

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, '../../..')
const DATA_DIRECTORY = resolve(REPOSITORY_ROOT, 'server/prisma/region-data')
const MANIFEST_PATH = resolve(DATA_DIRECTORY, 'manifest.json')
const SEED_PATH = resolve(DATA_DIRECTORY, 'regions.seed.json')

const EXPECTED_HASHES = Object.freeze({
  chinaMainland:
    '8c4e8afc5dfc16b77d34cf39b2547d07ab6a46e46b414679d494e50353970edc',
  taiwan:
    '5e9dfa16d989e569179f02375775ac5f0036d866305a4e11456e989ff59504f1',
  malaysia:
    '6ed9f08a88e3bd93a3cfe697b2135352688c495ae4595c6a37ae0980fffe7995',
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

const SOURCE_FILES = Object.freeze({
  chinaMainland: 'china-mainland-codes.json',
  taiwan: 'taiwan-counties.xml',
  malaysia: 'malaysia-state-district.csv',
})

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function sha256(path) {
  const content = await readFile(path)
  return createHash('sha256').update(content).digest('hex')
}

function compareCanonicalRegion(left, right) {
  const levelOrder = {
    COUNTRY_REGION: 0,
    PROVINCE_STATE: 1,
    CITY: 2,
  }
  const byLevel = levelOrder[left.level] - levelOrder[right.level]

  if (byLevel !== 0) {
    return byLevel
  }

  return left.code < right.code ? -1 : left.code > right.code ? 1 : 0
}

function domainOf(region) {
  return region.code.split('-')[0]
}

function findRegion(regions, code) {
  const region = regions.find(candidate => candidate.code === code)
  assert.ok(region, `缺少固定地区节点 ${code}`)
  return region
}

function regionPath(regions, cityCode) {
  const byId = new Map(regions.map(region => [region.id, region]))
  const city = findRegion(regions, cityCode)
  const province = byId.get(city.parentId)
  const country = province && byId.get(province.parentId)

  assert.ok(province, `${cityCode} 缺少省/州父节点`)
  assert.ok(country, `${cityCode} 缺少国家/地区父节点`)

  return [country, province, city]
}

test('manifest 固定来源版本、许可证、归属、摘要和转换口径', async () => {
  const manifest = await readJson(MANIFEST_PATH)

  assert.equal(manifest.transformVersion, '1.1.0')
  assert.equal(manifest.uuidNamespace, UUID_NAMESPACE)
  assert.deepEqual(manifest.expectedCounts, EXPECTED_COUNTS)

  assert.deepEqual(EXPECTED_SOURCE_HASHES, EXPECTED_HASHES)

  assert.equal(
    manifest.sources.chinaMainland.commit,
    'e2c2b2e1fb4ce1fb76e879aa0b80e229adaf950c',
  )
  assert.equal(manifest.sources.chinaMainland.license.name, 'CC0-1.0')
  assert.equal(
    manifest.sources.chinaMainland.sha256,
    EXPECTED_HASHES.chinaMainland,
  )
  assert.match(manifest.sources.chinaMainland.url, /e2c2b2e1fb4ce1fb76e879aa0b80e229adaf950c/)

  assert.equal(manifest.sources.taiwan.datasetUpdatedAt, '2026-06-02')
  assert.equal(manifest.sources.taiwan.snapshotDate, '2026-07-27')
  assert.equal(
    manifest.sources.taiwan.license.name,
    '政府資料開放授權條款第1版',
  )
  assert.match(manifest.sources.taiwan.attribution, /內政部國土測繪中心/)
  assert.equal(manifest.sources.taiwan.sha256, EXPECTED_HASHES.taiwan)
  assert.equal(
    manifest.sources.taiwan.url,
    'https://api.nlsc.gov.tw/other/ListCounty',
  )

  assert.equal(
    manifest.sources.malaysia.commit,
    'b057365ccbf26cbe3db1c043668f6a0efe811cb2',
  )
  assert.equal(
    manifest.sources.malaysia.license.name,
    'DOSM Open Data License',
  )
  assert.equal(
    manifest.sources.malaysia.sha256,
    EXPECTED_HASHES.malaysia,
  )
  assert.match(
    manifest.sources.malaysia.nonEndorsementNotice,
    /不得暗示.*官方背书/,
  )

  assert.ok(
    manifest.transformRules.chinaMainland.includes(
      'active-mainland-provinces-before-710000',
    ),
  )
  assert.ok(
    manifest.transformRules.chinaMainland.includes(
      'municipality-synthetic-city',
    ),
  )
  assert.ok(
    manifest.transformRules.taiwan.includes(
      'official-traditional-county-names',
    ),
  )
  assert.ok(
    manifest.transformRules.malaysia.includes(
      'same-name-leaf-for-no-district',
    ),
  )
  assert.equal(
    Object.keys(manifest.reviewedMappings.taiwanCountyNames).length,
    22,
  )
  assert.equal(
    Object.keys(manifest.reviewedMappings.malaysiaStateNames).length,
    16,
  )
})

test('三份原始快照 SHA-256 与固定摘要完全一致', async () => {
  for (const [domain, fileName] of Object.entries(SOURCE_FILES)) {
    const actual = await sha256(resolve(DATA_DIRECTORY, 'sources', fileName))
    assert.equal(actual, EXPECTED_HASHES[domain], `${domain} 原始快照发生漂移`)
  }
})

test('显示文本 normalizer 和 UUIDv5 使用固定确定性规则', () => {
  assert.equal(normalizeDisplayText('  Foo\u3000\tbar  '), 'Foo bar')
  assert.equal(normalizeDisplayText(' e\u0301 '), 'é')
  assert.equal(normalizeRegionName(' É '), 'é')
  assert.equal(normalizeRegionName(' İ '), 'i\u0307')
  assert.equal(normalizeRegionName(' 中国  台湾 '), '中国 台湾')

  assert.equal(UUID_NAMESPACE, '9acbca9a-32e2-4d7c-b00f-26a2e0dc5c1e')
  assert.equal(regionIdForCode('tw-64000'), regionIdForCode('TW-64000'))
  assert.equal(
    regionIdForCode('TW-64000'),
    '78f9134e-3d72-5f6e-9897-ca7e50004229',
  )
  assert.match(
    regionIdForCode('TW-64000'),
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  )
})

test('转换结果与 canonical JSON 字节级一致且顺序稳定', async () => {
  const generated = await buildRegionSeed({ dataDirectory: DATA_DIRECTORY })
  const checkedIn = await readFile(SEED_PATH, 'utf8')

  assert.equal(serializeRegionSeed(generated), checkedIn)
  assert.deepEqual(
    generated.regions,
    [...generated.regions].sort(compareCanonicalRegion),
  )
  assert.equal(new Set(generated.regions.map(region => region.id)).size, 602)
  assert.equal(new Set(generated.regions.map(region => region.code)).size, 602)

  for (const region of generated.regions) {
    assert.equal(region.id, regionIdForCode(region.code))
    assert.match(region.code, /^[A-Z0-9][A-Z0-9._-]{1,63}$/)
    assert.equal(region.name, normalizeDisplayText(region.name))
    assert.equal(region.normalizedName, normalizeRegionName(region.name))
    assert.equal(region.englishName, normalizeDisplayText(region.englishName))
    assert.equal(region.sourceName, normalizeDisplayText(region.sourceName))
    assert.equal(region.enabled, true)
    assert.ok(Number.isInteger(region.sortOrder) && region.sortOrder >= 0)
  }
})

test('转换结果精确满足三地和三级数量基线', async () => {
  const generated = await buildRegionSeed({ dataDirectory: DATA_DIRECTORY })
  const { regions } = generated

  assert.equal(regions.length, EXPECTED_COUNTS.total)
  assert.deepEqual(generated.counts, EXPECTED_COUNTS)

  for (const [domain, expected] of Object.entries(EXPECTED_COUNTS.byDomain)) {
    const scoped = regions.filter(region => domainOf(region) === domain)
    assert.equal(scoped.length, expected.total)

    for (const level of [
      'COUNTRY_REGION',
      'PROVINCE_STATE',
      'CITY',
    ]) {
      assert.equal(
        scoped.filter(region => region.level === level).length,
        expected[level],
        `${domain}/${level} 数量错误`,
      )
    }
  }
})

test('中国大陆包含直辖市同名叶子和 32 个省直管业务叶子', async () => {
  const { regions } = await buildRegionSeed({ dataDirectory: DATA_DIRECTORY })

  for (const [provinceCode, cityCode, expectedName] of [
    ['CN-110000', 'CN-110000-CITY', '北京市'],
    ['CN-120000', 'CN-120000-CITY', '天津市'],
    ['CN-310000', 'CN-310000-CITY', '上海市'],
    ['CN-500000', 'CN-500000-CITY', '重庆市'],
  ]) {
    const province = findRegion(regions, provinceCode)
    const city = findRegion(regions, cityCode)
    assert.equal(province.name, expectedName)
    assert.equal(city.name, expectedName)
    assert.equal(city.parentId, province.id)
    assert.equal(city.administrativeType, 'MUNICIPALITY_CITY')
  }

  const directAdmin = regions.filter(
    region => region.administrativeType === 'DIRECT_ADMIN_COUNTY_LEVEL',
  )
  assert.equal(directAdmin.length, 32)

  for (const name of ['济源市', '仙桃市', '五指山市', '定安县']) {
    assert.ok(
      directAdmin.some(region => region.name === name),
      `缺少省直管业务叶子 ${name}`,
    )
  }
})

test('中国台湾固定为中国台湾/台湾/高雄市并保留双来源代码', async () => {
  const { regions } = await buildRegionSeed({ dataDirectory: DATA_DIRECTORY })
  const [country, province, kaohsiung] = regionPath(regions, 'TW-64000')

  assert.deepEqual(
    [country.name, province.name, kaohsiung.name],
    ['中国台湾', '台湾', '高雄市'],
  )
  assert.equal(kaohsiung.sourceName, '高雄市')
  assert.equal(kaohsiung.sourceCode, 'E/64000')
  assert.equal(kaohsiung.administrativeType, 'COUNTY_CITY')
})

test('中国台湾全部 22 个三级县市采用来源中的台湾繁体名称', async () => {
  const { regions } = await buildRegionSeed({ dataDirectory: DATA_DIRECTORY })
  const cities = regions.filter(region => region.code.startsWith('TW-') && region.level === 'CITY')

  assert.equal(cities.length, 22)
  for (const city of cities) {
    assert.equal(city.name, city.sourceName, city.code)
    assert.equal(city.normalizedName, city.sourceName, city.code)
  }
  assert.equal(findRegion(regions, 'TW-63000').name, '臺北市')
  assert.equal(findRegion(regions, 'TW-10002').name, '宜蘭縣')
  assert.equal(findRegion(regions, 'TW-10014').name, '臺東縣')
})

test('马来西亚四个无下级州区使用同名三级叶子', async () => {
  const { regions } = await buildRegionSeed({ dataDirectory: DATA_DIRECTORY })

  for (const [provinceCode, cityCode, sourceName] of [
    ['MY-09', 'MY-09-01', 'Perlis'],
    ['MY-14', 'MY-14-01', 'W.P. Kuala Lumpur'],
    ['MY-15', 'MY-15-01', 'W.P. Labuan'],
    ['MY-16', 'MY-16-01', 'W.P. Putrajaya'],
  ]) {
    const province = findRegion(regions, provinceCode)
    const city = findRegion(regions, cityCode)
    assert.equal(province.sourceName, sourceName)
    assert.equal(city.name, sourceName)
    assert.equal(city.sourceName, sourceName)
    assert.equal(city.parentId, province.id)
    assert.equal(city.administrativeType, 'ADMINISTRATIVE_DISTRICT')
  }
})

test('生成器源码不包含运行时联网或临时目录输入', async () => {
  const source = await readFile(
    resolve(SCRIPT_DIRECTORY, 'generate-region-seed.mjs'),
    'utf8',
  )

  assert.doesNotMatch(source, /\bfetch\s*\(/)
  assert.doesNotMatch(source, /\bhttps?:\/\//)
  assert.doesNotMatch(source, /tmpdir|\b\/tmp\b/)
})
