/**
 * 构建期生成数据的对外契约：由 `web/scripts/development-map.ts` 在构建时读取
 * Git 历史与依赖清单产出，经虚拟模块 `virtual:qianshu/*` 注入前端。
 *
 * 运行时不再访问 Git：这里只描述可序列化的数据形状，生成器、虚拟模块声明与
 * 页面共用同一份定义，避免三处各写一套字段。
 */

/** 数据来源元信息，页面据此区分正式发版构建与本地开发构建。 */
export interface DevelopmentMapSource {
  /** 构建环境是否具备完整 Git 历史；浅克隆或无 .git 时为 false。 */
  available: boolean
  mode: 'release' | 'development' | 'unavailable'
  /** mode 为 development / unavailable 时的原因标识。 */
  reason: string | null
  /** 产品版本，取自 Web app package.json。 */
  version: string
  /** 构建提交上精确命中的发版 Tag；开发构建为 null。 */
  tag: string | null
  commit: string | null
  shortCommit: string | null
  branch: string | null
  /** `git describe --tags --always --dirty` 原样结果。 */
  describe: string | null
  dirty: boolean
  shallow: boolean
  generatedAt: string
}

export interface ReleaseNotesItem {
  sha: string
  subject: string
}

export interface ReleaseNotesGroup {
  /** conventional commit 类型：feat / fix / … / other。 */
  type: string
  label: string
  count: number
  items: ReleaseNotesItem[]
}

export interface ReleaseNotesRelease {
  version: string
  tag: string
  /** annotated Tag 的首行说明，缺失时为 null。 */
  label: string | null
  /** Tag 创建时间（ISO），用于时间线排序与展示。 */
  datetime: string
  commit: string
  /** 区间内非合并提交总数。 */
  commitCount: number
  range: { from: string | null, to: string }
  groups: ReleaseNotesGroup[]
}

export interface ReleaseNotesData {
  schemaVersion: 1
  source: DevelopmentMapSource
  releases: ReleaseNotesRelease[]
  /** 最新 Tag 之后尚未发版的提交；正式发版构建恒为 null。 */
  unreleased: { commitCount: number, groups: ReleaseNotesGroup[] } | null
}

/** Git 线路图按行渲染所需的最小数据，泳道布局已在构建时算完。 */
export interface GitGraphCommit {
  /** 短哈希。 */
  sha: string
  /** 本提交所在泳道。 */
  lane: number
  /** 行下边沿需要绘制的泳道（含本提交自己的泳道）。 */
  lanes: number[]
  subject: string
  /** 提交类型：feat / fix / … / merge / other。 */
  type: string
  date: string
  /** 本行上的引用徽标：发版 Tag 名或 HEAD。 */
  refs: string[]
  /** 所属发版在 versions 中的下标；尚未发版为 -1。 */
  release: number
}

export interface GitGraphVersion {
  version: string
  tag: string
  datetime: string
  commitCount: number
}

export interface GitGraphData {
  maxLane: number
  commits: GitGraphCommit[]
  versions: GitGraphVersion[]
}

export interface DevelopmentMapData {
  schemaVersion: 1
  source: DevelopmentMapSource
  graph: GitGraphData
}
