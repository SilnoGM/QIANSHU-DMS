import type {
  RegionLevel,
  RegionSelectorChange,
  RegionSelectorChangeSource,
  RegionSelectorCountryPath,
  RegionSelectorNode,
  RegionSelectorPath,
  RegionSelectorProvincePath,
  RegionSelectorSelectedPath,
  RegionSelectorValue,
} from './types'

export interface RegionSelectOption {
  readonly label: string
  readonly value: string
  readonly disabled: boolean
}

export interface RegionRequestVersion {
  /**
   * 开始一次新请求，并返回本次请求唯一的顺序号。
   */
  readonly next: () => number
  /**
   * 使当前请求立即过期；用于 value 变化、provider 失效和组件卸载。
   */
  readonly invalidate: () => void
  /**
   * 响应落地前再次核对版本，拒绝迟到响应覆盖较新的 UI 状态。
   */
  readonly isCurrent: (version: number) => boolean
}

export function createEmptyRegionSelectorValue(): RegionSelectorValue {
  return Object.freeze({
    cityId: null,
    countryRegionId: null,
    provinceStateId: null,
  })
}

/**
 * FaSelect 只接收 label/value/disabled；领域节点仍保存在组件自己的同层数组中。
 * 这样第三方宽泛 value 类型不会进入公共 API，也无需构造整棵地区树。
 */
export function createRegionSelectOptions(
  nodes: readonly RegionSelectorNode[],
): RegionSelectOption[] {
  return nodes.map(node => ({
    disabled: !node.enabled || !node.effectiveEnabled,
    label: node.name,
    value: node.id,
  }))
}

/**
 * 历史路径可能已停用并因此不在正常 options 响应中。只把当前已选节点追加到末尾，
 * 不改变 Server 已返回节点的顺序，也不制造重复 UUID。
 */
export function mergeSelectedRegionNode<L extends RegionLevel>(
  nodes: readonly RegionSelectorNode<L>[],
  selected: RegionSelectorNode<L> | null,
): RegionSelectorNode<L>[] {
  if (!selected || nodes.some(node => node.id === selected.id)) {
    return [...nodes]
  }
  return [...nodes, selected]
}

/**
 * 在同层 options 进入组件状态之前校验父子 level。
 *
 * Provider 能验证 parentId 和同批同层，但仅凭 UUID 无法知道被展开父级的 level；
 * 组件持有父节点，必须补齐 COUNTRY→PROVINCE、PROVINCE→CITY 的最后一道边界。
 */
export function validateRegionChildren(
  parent: RegionSelectorNode,
  children: readonly RegionSelectorNode[],
): readonly RegionSelectorNode[] {
  const expectedLevel = parent.level === 'COUNTRY_REGION'
    ? 'PROVINCE_STATE'
    : parent.level === 'PROVINCE_STATE'
      ? 'CITY'
      : null

  if (
    expectedLevel === null
    || children.some(child =>
      child.parentId !== parent.id || child.level !== expectedLevel,
    )
  ) {
    throw new Error('Invalid region child hierarchy')
  }

  return children
}

function isValidPathStructure(
  path: readonly RegionSelectorNode[],
): path is RegionSelectorPath {
  if (path.length !== 3) {
    return false
  }
  const [country, province, city] = path
  return country?.level === 'COUNTRY_REGION'
    && country.parentId === null
    && province?.level === 'PROVINCE_STATE'
    && province.parentId === country.id
    && city?.level === 'CITY'
    && city.parentId === province.id
}

/**
 * 完整外部值必须与 Provider 解析出的严格 path 三个 UUID 全部一致。
 */
export function validateRegionSelectorPath(
  path: readonly RegionSelectorNode[],
  value: RegionSelectorValue,
): path is RegionSelectorPath {
  if (!isValidPathStructure(path)) {
    return false
  }
  return path[0].id === value.countryRegionId
    && path[1].id === value.provinceStateId
    && path[2].id === value.cityId
}

/**
 * 运行时收敛调用方传入的结构化值；畸形或跳级状态保持字段原值，交由回显校验
 * 明确报错，组件不会擅自改写业务数据。
 */
export function normalizeRegionSelectorValue(
  value: RegionSelectorValue | null | undefined,
): RegionSelectorValue {
  const normalizeId = (id: unknown): string | null =>
    typeof id === 'string' && id.length > 0 ? id : null

  return Object.freeze({
    cityId: normalizeId(value?.cityId),
    countryRegionId: normalizeId(value?.countryRegionId),
    provinceStateId: normalizeId(value?.provinceStateId),
  })
}

export function isCompleteRegionSelectorValue(
  value: RegionSelectorValue,
): boolean {
  return value.countryRegionId !== null
    && value.provinceStateId !== null
    && value.cityId !== null
}

function assertChangePath(
  source: RegionSelectorChangeSource,
  path: RegionSelectorSelectedPath,
): void {
  const expectedLength = source === 'clear'
    ? 0
    : source === 'countryRegion'
      ? 1
      : source === 'provinceState'
        ? 2
        : 3

  if (path.length !== expectedLength) {
    throw new Error('Invalid region selection path')
  }
  if (path[0] && (
    path[0].level !== 'COUNTRY_REGION'
    || path[0].parentId !== null
  )) {
    throw new Error('Invalid region selection path')
  }
  if (path[1] && (
    path[1].level !== 'PROVINCE_STATE'
    || path[1].parentId !== path[0]?.id
  )) {
    throw new Error('Invalid region selection path')
  }
  if (path[2] && (
    path[2].level !== 'CITY'
    || path[2].parentId !== path[1]?.id
  )) {
    throw new Error('Invalid region selection path')
  }
}

/**
 * 用户每选择一级就产生一个完整对象；下级字段由 path 长度确定为 `null`。
 */
export function createRegionSelectorChange(
  source: RegionSelectorChangeSource,
  path: RegionSelectorSelectedPath,
): RegionSelectorChange {
  assertChangePath(source, path)
  const value = Object.freeze({
    cityId: path[2]?.id ?? null,
    countryRegionId: path[0]?.id ?? null,
    provinceStateId: path[1]?.id ?? null,
  })
  const frozenPath = Object.freeze([...path])

  if (source === 'countryRegion') {
    return Object.freeze({
      complete: false,
      path: frozenPath as RegionSelectorCountryPath,
      source,
      value,
    })
  }
  if (source === 'provinceState') {
    return Object.freeze({
      complete: false,
      path: frozenPath as RegionSelectorProvincePath,
      source,
      value,
    })
  }
  if (source === 'city') {
    return Object.freeze({
      complete: true,
      path: frozenPath as RegionSelectorPath,
      source,
      value,
    })
  }
  return Object.freeze({
    complete: false,
    path: frozenPath as readonly [],
    source,
    value,
  })
}

/**
 * 用户可见的完整地区以一个 ASCII 空格分隔。历史路径任一层停用时附加文字，
 * 状态不只依赖颜色表达。
 */
export function formatRegionPathLabel(
  path: readonly RegionSelectorNode[],
): string {
  const label = path.map(node => node.name).join(' ')
  const stopped = path.some(node =>
    !node.enabled || !node.effectiveEnabled,
  )

  return stopped && label ? `${label}（已停用）` : label
}

/**
 * 每个 root、parent、path、search 状态使用独立实例；版本只在该实例内比较。
 */
export function createRegionRequestVersion(): RegionRequestVersion {
  let current = 0

  return Object.freeze({
    invalidate: () => {
      current += 1
    },
    isCurrent: (version: number) => version === current,
    next: () => {
      current += 1
      return current
    },
  })
}
