import type {
  RegionSelectorChange,
  RegionSelectorNode,
  RegionSelectorPath,
} from './types'

const UNICODE_WHITESPACE_PATTERN = /\p{White_Space}+/gu

/**
 * ACascader 的私有适配结构。
 *
 * 这里故意不继承或导入 Arco 类型，避免第三方组件的宽泛 value/event 契约进入
 * QsRegionSelector 的公共 API。`region` 和 `searchText` 只供组件内部校验与搜索使用。
 */
export interface RegionCascaderOption {
  readonly value: string
  readonly label: string
  readonly disabled: boolean
  readonly isLeaf: boolean
  readonly region: RegionSelectorNode
  readonly searchText: string
  children?: RegionCascaderOption[]
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

function createSearchText(path: readonly RegionSelectorNode[]): string {
  const searchableParts = path.flatMap(node => [
    node.name,
    node.englishName,
    node.code,
  ]).filter((value): value is string => value !== null)

  return normalizeRegionSearchText(searchableParts.join(' '))
}

function createOption(
  region: RegionSelectorNode,
  path: readonly RegionSelectorNode[],
): RegionCascaderOption {
  const fullPath = [...path, region]

  return {
    disabled: region.level === 'CITY'
      && (!region.enabled || !region.effectiveEnabled),
    isLeaf: region.level === 'CITY',
    label: region.name,
    region,
    searchText: createSearchText(fullPath),
    value: region.id,
  }
}

/**
 * 重新计算整棵树的祖先相关搜索文本。
 *
 * navigation 的 lazy children 初次建立时并不知道祖先；每次挂载、合并或替换 children
 * 后统一从 root 重建，确保 leaf 始终包含完整三级名称、英文名和 code。
 */
function rebuildTree(
  options: readonly RegionCascaderOption[],
  ancestors: readonly RegionSelectorNode[] = [],
): RegionCascaderOption[] {
  return options.map((option) => {
    const currentPath = [...ancestors, option.region]
    const children = option.children === undefined
      ? undefined
      : rebuildTree(option.children, currentPath)

    return {
      ...option,
      children,
      searchText: createSearchText(currentPath),
    }
  })
}

/**
 * 把 Server 按序返回的同层节点转换为私有 Cascader options。
 */
export function createRegionOptions(
  nodes: readonly RegionSelectorNode[],
): RegionCascaderOption[] {
  return nodes.map(region => createOption(region, []))
}

/**
 * 把严格三级 path 转为一条嵌套分支。Provider 已负责响应结构校验；组件 change
 * handler 仍会通过 `resolveRegionSelection` 再做一次完整结构校验。
 */
export function createRegionPathTree(
  path: RegionSelectorPath,
): RegionCascaderOption[] {
  const [country, province, city] = path
  const countryOption = createOption(country, [])
  const provinceOption = createOption(province, [country])
  const cityOption = createOption(city, [country, province])

  provinceOption.children = [cityOption]
  countryOption.children = [provinceOption]
  return [countryOption]
}

function mergeOptionLists(
  primary: readonly RegionCascaderOption[],
  secondary: readonly RegionCascaderOption[],
): RegionCascaderOption[] {
  const merged = primary.map(option => ({
    ...option,
    children: option.children?.map(child => ({ ...child })),
  }))
  const indexById = new Map(
    merged.map((option, index) => [option.value, index] as const),
  )

  for (const incoming of secondary) {
    const existingIndex = indexById.get(incoming.value)
    if (existingIndex === undefined) {
      indexById.set(incoming.value, merged.length)
      merged.push({
        ...incoming,
        children: incoming.children?.map(child => ({ ...child })),
      })
      continue
    }

    const existing = merged[existingIndex]!
    let children: RegionCascaderOption[] | undefined
    if (existing.children !== undefined && incoming.children !== undefined) {
      children = mergeOptionLists(existing.children, incoming.children)
    }
    else if (existing.children !== undefined) {
      children = existing.children
    }
    else if (incoming.children !== undefined) {
      children = incoming.children.map(child => ({ ...child }))
    }

    merged[existingIndex] = {
      ...existing,
      // 任一来源认定该历史 CITY 已停用时，合并结果都不能重新变成可选。
      disabled: existing.disabled || incoming.disabled,
      children,
    }
  }

  return merged
}

/**
 * 按来源优先级合并 navigation、resolved 和 search 三棵树。
 *
 * 第一棵树确定已有节点的顺序；后续树只按自己的 Server 顺序追加尚未出现的 UUID，
 * 相同 UUID 递归合并 children，避免当前值和搜索结果制造重复分支。
 */
export function mergeRegionTrees(
  ...trees: readonly (readonly RegionCascaderOption[])[]
): RegionCascaderOption[] {
  const merged = trees.reduce<RegionCascaderOption[]>(
    (current, tree) => mergeOptionLists(current, tree),
    [],
  )
  return rebuildTree(merged)
}

/**
 * 构造真正交给 ACascader 的交互树。
 *
 * `resolvedPathTree` 刻意不进入此函数：历史回显只是一条部分路径，若把它的 children
 * 合进普通 navigation，Arco 会误判该父级已经完整 lazy load，用户将无法切换同国省州
 * 或同省城市。搜索完整 path 只在搜索输入非空时临时参与，清空后立即恢复 navigation
 * 的 `children=undefined` 未加载语义。
 */
export function createRegionInteractiveTree(
  navigationTree: readonly RegionCascaderOption[],
  searchTree: readonly RegionCascaderOption[],
  searching: boolean,
): RegionCascaderOption[] {
  return searching
    ? mergeRegionTrees(navigationTree, searchTree)
    : mergeRegionTrees(navigationTree)
}

/**
 * 搜索结果只由“本次”完整 paths 构造。调用方直接替换 searchTree ref，不接收旧树，
 * 从函数边界上避免历史搜索结果持续累积。
 */
export function createRegionSearchTree(
  paths: readonly RegionSelectorPath[],
): RegionCascaderOption[] {
  return mergeRegionTrees(...paths.map(createRegionPathTree))
}

function replaceChildrenInBranch(
  options: readonly RegionCascaderOption[],
  parentId: string,
  children: readonly RegionSelectorNode[],
): RegionCascaderOption[] {
  return options.map((option) => {
    if (option.value === parentId) {
      return {
        ...option,
        children: createRegionOptions(children),
      }
    }

    if (option.children === undefined) {
      return { ...option }
    }

    return {
      ...option,
      children: replaceChildrenInBranch(
        option.children,
        parentId,
        children,
      ),
    }
  })
}

/**
 * lazy 成功后按 Server 的完整响应替换该 parent 的直属 children。
 *
 * root 请求同样采用整批替换；这能移除服务端已停用或已调整顺序的旧 navigation
 * 节点。函数不修改输入树，迟到请求是否可以调用本函数由 request version 决定。
 */
export function replaceRegionChildren(
  tree: readonly RegionCascaderOption[],
  parentId: string | null,
  children: readonly RegionSelectorNode[],
): RegionCascaderOption[] {
  if (parentId === null) {
    return createRegionOptions(children)
  }

  return rebuildTree(replaceChildrenInBranch(tree, parentId, children))
}

/**
 * 在 lazy 结果进入树之前校验父子 level。
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

/**
 * 搜索 query 与 option 索引使用完全相同的确定性规范化，避免系统 locale 影响结果。
 */
export function normalizeRegionSearchText(value: string): string {
  return value
    .normalize('NFC')
    .replace(UNICODE_WHITESPACE_PATTERN, ' ')
    .trim()
    .toLocaleLowerCase('en-US')
    .normalize('NFC')
}

/**
 * 本地 filter 只检查 Server 已返回或已经 lazy 加载的 leaf 搜索索引，不推断未加载数据。
 */
export function filterRegionOption(
  inputValue: string,
  option: RegionCascaderOption,
): boolean {
  if (
    option.disabled
    || !option.region.enabled
    || !option.region.effectiveEnabled
  ) {
    return false
  }

  const normalizedQuery = normalizeRegionSearchText(inputValue)
  return normalizedQuery.length === 0
    || option.searchText.includes(normalizedQuery)
}

function isStructurallyValidOptionPath(
  options: readonly RegionCascaderOption[],
  expectedCityId: string,
): boolean {
  if (options.length !== 3) {
    return false
  }

  const [country, province, city] = options
  if (!country || !province || !city) {
    return false
  }

  return country.value === country.region.id
    && province.value === province.region.id
    && city.value === city.region.id
    && country.region.level === 'COUNTRY_REGION'
    && province.region.level === 'PROVINCE_STATE'
    && city.region.level === 'CITY'
    && country.region.parentId === null
    && province.region.parentId === country.region.id
    && city.region.parentId === province.region.id
    && city.region.id === expectedCityId
    && !country.isLeaf
    && !province.isLeaf
    && city.isLeaf
}

function findRegionOptionPathByCityId(
  tree: readonly RegionCascaderOption[],
  cityId: string,
): readonly RegionCascaderOption[] | null {
  const visit = (
    options: readonly RegionCascaderOption[],
    ancestors: readonly RegionCascaderOption[],
  ): readonly RegionCascaderOption[] | null => {
    for (const option of options) {
      const path = [...ancestors, option]
      if (
        option.value === cityId
        && isStructurallyValidOptionPath(path, cityId)
      ) {
        return path
      }

      if (option.children !== undefined) {
        const found = visit(option.children, path)
        if (found) {
          return found
        }
      }
    }

    return null
  }

  return visit(tree, [])
}

/**
 * 从当前合并树中恢复 readonly 领域 path。结构不完整时返回 null，绝不拼接半条路径。
 */
export function findRegionPathByCityId(
  tree: readonly RegionCascaderOption[],
  cityId: string,
): RegionSelectorPath | null {
  const options = findRegionOptionPathByCityId(tree, cityId)
  if (!options) {
    return null
  }

  const [country, province, city] = options
  return Object.freeze([
    country!.region as RegionSelectorNode<'COUNTRY_REGION'>,
    province!.region as RegionSelectorNode<'PROVINCE_STATE'>,
    city!.region as RegionSelectorNode<'CITY'>,
  ])
}

/**
 * 始终展示完整三级 label；历史路径任一层自身或继承停用时追加明确文字，
 * 状态不只依赖颜色表达。
 */
export function formatRegionPathLabel(
  options: readonly RegionCascaderOption[],
): string {
  const label = options.map(option => option.region.name).join(' / ')
  const stopped = options.some(option =>
    !option.region.enabled
    || !option.region.effectiveEnabled
    || option.disabled,
  )

  return stopped && label ? `${label}（已停用）` : label
}

/**
 * 收敛 ACascader 的宽泛 change value：
 *
 * - `'' | null | undefined` 统一成为公共 clear/null；
 * - 非 string、非完整三级或停用 CITY 一律忽略；
 * - 只有合并树中可验证的有效 CITY 才产生 select change。
 */
export function resolveRegionSelection(
  arcoValue: unknown,
  tree: readonly RegionCascaderOption[],
): RegionSelectorChange | null {
  if (arcoValue === '' || arcoValue === null || arcoValue === undefined) {
    return Object.freeze({
      path: null,
      source: 'clear',
      value: null,
    })
  }

  if (typeof arcoValue !== 'string') {
    return null
  }

  const options = findRegionOptionPathByCityId(tree, arcoValue)
  if (
    !options
    || options.some(option =>
      option.disabled
      || !option.region.enabled
      || !option.region.effectiveEnabled,
    )
  ) {
    return null
  }

  const [country, province, city] = options
  const path = Object.freeze([
    country!.region as RegionSelectorNode<'COUNTRY_REGION'>,
    province!.region as RegionSelectorNode<'PROVINCE_STATE'>,
    city!.region as RegionSelectorNode<'CITY'>,
  ]) as RegionSelectorPath

  return Object.freeze({
    path,
    source: 'select',
    value: arcoValue,
  })
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
