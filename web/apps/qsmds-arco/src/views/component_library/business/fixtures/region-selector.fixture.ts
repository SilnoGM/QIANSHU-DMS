import type {
  RegionSelectorNode,
  RegionSelectorPath,
  RegionSelectorProvider,
} from '@/components/business/QsRegionSelector/types'

interface RegionSelectorFixtureOptions {
  /**
   * 仅让第一次根节点读取失败，用于稳定复现组件的内联错误与重试流程。
   */
  failFirstRoot?: boolean
}

export const REGION_SELECTOR_FIXTURE_IDS = Object.freeze({
  beijing: '7e2e5bb3-2aa7-53cf-9772-bb50bc0f7050',
  malaysiaKualaLumpur: '5bb627db-828b-5dc3-8c42-ef2fdbbb2bb6',
  stoppedCity: 'f0000000-0000-4000-8000-000000000001',
  taiwanKaohsiung: '78f9134e-3d72-5f6e-9897-ca7e50004229',
} as const)

function freezeNode<L extends RegionSelectorNode['level']>(
  node: RegionSelectorNode<L>,
): RegionSelectorNode<L> {
  return Object.freeze(node)
}

function freezePath(
  path: RegionSelectorPath,
): RegionSelectorPath {
  return Object.freeze(path)
}

const china = freezeNode({
  code: 'CN',
  effectiveEnabled: true,
  enabled: true,
  englishName: null,
  hasChildren: true,
  id: '90f34764-3527-58d8-9c15-9e8586ea6f28',
  level: 'COUNTRY_REGION',
  name: '中国',
  parentId: null,
})

const beijingProvince = freezeNode({
  code: 'CN-110000',
  effectiveEnabled: true,
  enabled: true,
  englishName: null,
  hasChildren: true,
  id: '4bdb6632-7f57-5eb4-84cf-ba733771dbaf',
  level: 'PROVINCE_STATE',
  name: '北京市',
  parentId: china.id,
})

const beijingCity = freezeNode({
  code: 'CN-110000-CITY',
  effectiveEnabled: true,
  enabled: true,
  englishName: null,
  hasChildren: false,
  id: REGION_SELECTOR_FIXTURE_IDS.beijing,
  level: 'CITY',
  name: '北京市',
  parentId: beijingProvince.id,
})

const stoppedCity = freezeNode({
  code: 'FIXTURE-STOPPED',
  effectiveEnabled: false,
  enabled: false,
  englishName: 'Stopped fixture city',
  hasChildren: false,
  id: REGION_SELECTOR_FIXTURE_IDS.stoppedCity,
  level: 'CITY',
  name: '历史示例市',
  parentId: beijingProvince.id,
})

const taiwan = freezeNode({
  code: 'TW',
  effectiveEnabled: true,
  enabled: true,
  englishName: null,
  hasChildren: true,
  id: '2e30acdf-7559-5fc2-8e00-c5b069d3df8b',
  level: 'COUNTRY_REGION',
  name: '中国台湾',
  parentId: null,
})

const taiwanProvince = freezeNode({
  code: 'TW-TAIWAN',
  effectiveEnabled: true,
  enabled: true,
  englishName: null,
  hasChildren: true,
  id: 'ee82c572-f653-51d2-98d4-f11ac5928aa1',
  level: 'PROVINCE_STATE',
  name: '台湾',
  parentId: taiwan.id,
})

const kaohsiung = freezeNode({
  code: 'TW-64000',
  effectiveEnabled: true,
  enabled: true,
  englishName: null,
  hasChildren: false,
  id: REGION_SELECTOR_FIXTURE_IDS.taiwanKaohsiung,
  level: 'CITY',
  name: '高雄市',
  parentId: taiwanProvince.id,
})

const malaysia = freezeNode({
  code: 'MY',
  effectiveEnabled: true,
  enabled: true,
  englishName: null,
  hasChildren: true,
  id: '856ded05-d4d3-5a84-b8f2-a2d8ce5ca562',
  level: 'COUNTRY_REGION',
  name: '马来西亚',
  parentId: null,
})

const kualaLumpurState = freezeNode({
  code: 'MY-14',
  effectiveEnabled: true,
  enabled: true,
  englishName: 'W.P. Kuala Lumpur',
  hasChildren: true,
  id: '3f3457fc-a2b0-5858-b904-3cc126b7bf8e',
  level: 'PROVINCE_STATE',
  name: '吉隆坡联邦直辖区',
  parentId: malaysia.id,
})

const kualaLumpurCity = freezeNode({
  code: 'MY-14-01',
  effectiveEnabled: true,
  enabled: true,
  englishName: null,
  hasChildren: false,
  id: REGION_SELECTOR_FIXTURE_IDS.malaysiaKualaLumpur,
  level: 'CITY',
  name: 'W.P. Kuala Lumpur',
  parentId: kualaLumpurState.id,
})

const beijingPath = freezePath([
  china,
  beijingProvince,
  beijingCity,
])
const stoppedPath = freezePath([
  china,
  beijingProvince,
  stoppedCity,
])
const taiwanPath = freezePath([
  taiwan,
  taiwanProvince,
  kaohsiung,
])
const malaysiaPath = freezePath([
  malaysia,
  kualaLumpurState,
  kualaLumpurCity,
])

const roots = Object.freeze([china, taiwan, malaysia])
const activePaths = Object.freeze([
  beijingPath,
  taiwanPath,
  malaysiaPath,
])
const pathByCityId = new Map<string, RegionSelectorPath>([
  [beijingCity.id, beijingPath],
  [stoppedCity.id, stoppedPath],
  [kaohsiung.id, taiwanPath],
  [kualaLumpurCity.id, malaysiaPath],
])
const childrenByParentId = new Map<string | null, readonly RegionSelectorNode[]>([
  [null, roots],
  [china.id, Object.freeze([beijingProvince])],
  [beijingProvince.id, Object.freeze([beijingCity])],
  [taiwan.id, Object.freeze([taiwanProvince])],
  [taiwanProvince.id, Object.freeze([kaohsiung])],
  [malaysia.id, Object.freeze([kualaLumpurState])],
  [kualaLumpurState.id, Object.freeze([kualaLumpurCity])],
])

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException('The operation was aborted', 'AbortError')
  }
}

function matchesPath(path: RegionSelectorPath, query: string): boolean {
  const searchableText = path.flatMap(node => [
    node.name,
    node.englishName,
    node.code,
  ]).filter((value): value is string => value !== null).join(' ').normalize('NFC').toLocaleLowerCase('en-US')

  return searchableText.includes(query)
}

/**
 * 组件库专用的确定性内存 Provider。
 *
 * 它刻意不复用默认 Provider 的缓存、身份和广播能力，也不读取正式 API。这样示例既能
 * 演示完整交互，又不会因登录状态、后端数据或管理操作而产生副作用。
 */
export function createRegionSelectorFixtureProvider(
  options: RegionSelectorFixtureOptions = {},
): RegionSelectorProvider {
  let failNextRoot = options.failFirstRoot === true

  const provider: RegionSelectorProvider = {
    async listChildren({ parentId, signal }) {
      assertNotAborted(signal)
      if (parentId === null && failNextRoot) {
        failNextRoot = false
        throw new Error('fixture root failure')
      }
      return childrenByParentId.get(parentId) ?? Object.freeze([])
    },

    async resolvePath({ cityId, signal }) {
      assertNotAborted(signal)
      const path = pathByCityId.get(cityId)
      if (!path) {
        throw new Error('Fixture region path not found')
      }
      return path
    },

    async search({ query, signal }) {
      assertNotAborted(signal)
      const normalizedQuery = query
        .normalize('NFC')
        .trim()
        .toLocaleLowerCase('en-US')
      const paths = Object.freeze(
        activePaths.filter(path => matchesPath(path, normalizedQuery)),
      )
      return Object.freeze({
        hasMore: false,
        paths,
      })
    },
  }

  return Object.freeze(provider)
}
