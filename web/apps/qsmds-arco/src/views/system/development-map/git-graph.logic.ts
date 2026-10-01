import type { GitGraphCommit, GitGraphVersion } from '@/types/development-map'
// 运行时依赖使用相对路径：本模块会被 Node 测试运行器直接加载，`@/` 别名只在 Vite 中可用。
import { commitTypeLabel } from '../../../types/commit-types'

export const gitGraphRowHeight = 28
const laneWidth = 16
const nodeRadius = 3.5

/**
 * 泳道配色循环：取自当前主题语义 token，暗色与亮色都随主题自动更新，
 * 不写死具体色值。相邻泳道交替使用主色与警示色，第三、四条走弱化与混色。
 */
const laneColors = [
  'oklch(var(--primary))',
  'oklch(var(--destructive))',
  'oklch(var(--muted-foreground))',
  'color-mix(in srgb, oklch(var(--primary)) 55%, oklch(var(--foreground)))',
]

export function laneColor(lane: number): string {
  const index = ((lane % laneColors.length) + laneColors.length) % laneColors.length
  return laneColors[index] ?? laneColors[0]!
}

function laneCenterX(lane: number): number {
  return lane * laneWidth + laneWidth / 2
}

export function graphColumnWidth(maxLane: number): number {
  return (maxLane + 1) * laneWidth
}

export interface GraphSegment {
  key: string
  path: string
  color: string
}

export interface GraphRowDrawing {
  width: number
  nodeX: number
  nodeY: number
  nodeColor: string
  segments: GraphSegment[]
}

/**
 * 单行绘制指令：上边沿到节点的连入线、节点到下边沿的连出线。
 * 泳道布局已在构建时算完，这里只做坐标换算，不在浏览器里做图布局。
 */
export function drawGraphRow(row: GitGraphCommit, topLanes: readonly number[], maxLane: number): GraphRowDrawing {
  const centerY = gitGraphRowHeight / 2
  const nodeX = laneCenterX(row.lane)
  const segments: GraphSegment[] = []

  for (const lane of topLanes) {
    const x = laneCenterX(lane)
    segments.push({
      key: `top-${lane}`,
      path: `M ${x} 0 V ${lane === row.lane ? centerY : gitGraphRowHeight}`,
      color: laneColor(lane),
    })
  }

  for (const lane of row.lanes) {
    const x = laneCenterX(lane)
    if (lane === row.lane) {
      segments.push({
        key: `down-${lane}`,
        path: `M ${nodeX} ${centerY} V ${gitGraphRowHeight}`,
        color: laneColor(lane),
      })
      continue
    }
    // 三次贝塞尔曲线：竖直离开节点、竖直进入目标泳道，形成 Git 图常见的分叉与汇入形态。
    const bend = (gitGraphRowHeight - centerY) / 2
    segments.push({
      key: `curve-${lane}`,
      path: `M ${nodeX} ${centerY} C ${nodeX} ${centerY + bend} ${x} ${gitGraphRowHeight - bend} ${x} ${gitGraphRowHeight}`,
      color: laneColor(lane),
    })
  }

  return {
    width: graphColumnWidth(maxLane),
    nodeX,
    nodeY: centerY,
    nodeColor: laneColor(row.lane),
    segments,
  }
}

export const gitGraphNodeRadius = nodeRadius

/** 类型标签的语义色：新功能主色、修复与回退警示色、其余弱化。 */
export function commitToneClass(type: string): string {
  if (type === 'feat') {
    return 'text-primary'
  }
  if (type === 'fix' || type === 'revert') {
    return 'text-destructive'
  }
  return 'text-muted-foreground'
}

/** 筛选视图的简化轨道圆点颜色，与类型语义保持一致。 */
export function commitDotColor(type: string): string {
  if (type === 'feat') {
    return 'oklch(var(--primary))'
  }
  if (type === 'fix' || type === 'revert') {
    return 'oklch(var(--destructive))'
  }
  return 'oklch(var(--muted-foreground))'
}

export interface GitGraphFilters {
  /** 发版 Tag；null 表示全部版本。 */
  version: string | null
  /** 提交类型；null 表示全部类型。 */
  type: string | null
  keyword: string
}

export function isGraphFilterActive(filters: GitGraphFilters): boolean {
  return filters.version !== null || filters.type !== null || filters.keyword.trim().length > 0
}

export function versionIndexOf(tag: string | null, versions: readonly GitGraphVersion[]): number | null {
  if (tag === null) {
    return null
  }
  const index = versions.findIndex(version => version.tag === tag)
  return index === -1 ? null : index
}

export function filterGraphCommits(
  commits: readonly GitGraphCommit[],
  versions: readonly GitGraphVersion[],
  filters: GitGraphFilters,
): GitGraphCommit[] {
  const releaseIndex = versionIndexOf(filters.version, versions)
  const keyword = filters.keyword.trim().toLowerCase()
  return commits.filter((commit) => {
    if (filters.version !== null && commit.release !== releaseIndex) {
      return false
    }
    if (filters.type !== null && commit.type !== filters.type) {
      return false
    }
    if (keyword.length > 0 && !`${commit.sha} ${commit.subject}`.toLowerCase().includes(keyword)) {
      return false
    }
    return true
  })
}

export function typeFilterOptions(commits: readonly GitGraphCommit[]): Array<{ label: string, value: string }> {
  const counts = new Map<string, number>()
  for (const commit of commits) {
    counts.set(commit.type, (counts.get(commit.type) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([type, count]) => ({ label: `${commitTypeLabel(type)}（${count}）`, value: type }))
}

export function versionFilterOptions(versions: readonly GitGraphVersion[]): Array<{ label: string, value: string }> {
  return versions.map(version => ({
    label: `${version.tag}（${version.commitCount} 条）`,
    value: version.tag,
  }))
}

/** 虚拟列表的容器高度：随视口伸缩，保证一次能看到足够的提交行。 */
export const gitGraphViewportClass = 'h-[calc(100vh-27rem)] min-h-72'
