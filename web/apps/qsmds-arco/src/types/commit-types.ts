/**
 * conventional commit 类型的中文标签：变更条目分组（构建期生成）与线路图类型标签
 * （页面展示）共用同一份真相源，避免两处各维护一套映射。
 */
export const commitTypeLabels: Readonly<Record<string, string>> = Object.freeze({
  feat: '新功能',
  fix: '修复',
  perf: '优化',
  refactor: '重构',
  docs: '文档',
  test: '测试',
  style: '样式',
  chore: '构建与杂项',
  ci: '持续集成',
  build: '构建',
  revert: '回退',
  merge: '合并',
  other: '其他',
})

export function commitTypeLabel(type: string): string {
  return commitTypeLabels[type] ?? commitTypeLabels.other
}
