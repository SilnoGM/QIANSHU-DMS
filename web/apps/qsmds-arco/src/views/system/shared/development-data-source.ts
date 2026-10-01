import type { DevelopmentMapSource } from '@/types/development-map'

export interface DevelopmentDataSourceNotice {
  variant: 'default' | 'destructive'
  icon: string
  title: string
  description: string
}

/**
 * 数据来源提示：版本更新与开发图谱共用。正式发版构建不提示；本地开发构建与降级构建
 * 必须让读者知道屏幕上的内容代表什么，避免把本地历史或空态当成已发布版本的事实。
 */
export function describeDevelopmentDataSource(source: DevelopmentMapSource): DevelopmentDataSourceNotice | null {
  if (!source.available) {
    return {
      variant: 'destructive',
      icon: 'i-lucide:circle-alert',
      title: '构建环境未提供 Git 历史',
      description: '本次构建缺少可用的 Git 仓库或历史不完整（例如浅克隆），因此没有可展示的提交数据。正式发版流水线构建的版本不受影响。',
    }
  }
  if (source.mode === 'development') {
    return {
      variant: 'default',
      icon: 'i-lucide:info',
      title: '本地开发数据',
      description: `数据截至 ${source.shortCommit ?? '未知提交'}${source.tag ? `（${source.tag} 之后）` : ''}，来自本地工作区的提交历史，不代表已发布版本的内容。`,
    }
  }
  return null
}
