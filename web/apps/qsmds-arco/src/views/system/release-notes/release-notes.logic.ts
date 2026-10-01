import type { ReleaseNotesGroup, ReleaseNotesRelease } from '@/types/development-map'

export { describeDevelopmentDataSource as describeDataSource } from '../shared/development-data-source'

/** 单个分类默认展示的条目上限，超出后由「展开全部」补齐。 */
export const releaseGroupItemLimit = 6

export function shouldFoldGroup(group: ReleaseNotesGroup): boolean {
  return group.items.length > releaseGroupItemLimit
}

export function visibleGroupItems(group: ReleaseNotesGroup, expanded: boolean): ReleaseNotesGroup['items'] {
  return expanded ? group.items : group.items.slice(0, releaseGroupItemLimit)
}

/** 分类标签的语义色：新功能为主色、修复与回退为警示色，其余弱化显示。 */
export function groupToneClass(type: string): string {
  if (type === 'feat') {
    return 'text-primary'
  }
  if (type === 'fix' || type === 'revert') {
    return 'text-destructive'
  }
  return 'text-muted-foreground'
}

export function formatReleaseDate(datetime: string): string {
  return datetime.slice(0, 10)
}

export function releaseCardSubtitle(release: ReleaseNotesRelease): string {
  return `${formatReleaseDate(release.datetime)} · 提交 ${release.commitCount}`
}

export function graphRouteFor(tag: string | null): { path: string, query?: { version: string } } {
  return tag === null
    ? { path: '/system/development-map' }
    : { path: '/system/development-map', query: { version: tag } }
}
