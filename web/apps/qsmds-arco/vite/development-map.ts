import type { PluginOption } from 'vite'
import type { DevelopmentMapData, ReleaseNotesData } from '../src/types/development-map'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDevelopmentMapData } from '../../../scripts/development-map'

/**
 * 开发图谱数据的构建期注入：在 Vite 进程内读一次 Git 历史与依赖清单，把结果作为
 * 虚拟模块交给页面静态导入。数据随页面路由代码一起进入懒加载 chunk，
 * 运行时不访问 Git，也不产生新的工作树文件（Release 构建后的 `git diff` 检查保持干净）。
 */
export const releaseNotesModuleId = 'virtual:qianshu/release-notes'
export const developmentMapModuleId = 'virtual:qianshu/development-map'
/** 只含来源元信息：系统状态页需要展示数据锚点，但不应拉入整份图谱数据。 */
export const buildSourceModuleId = 'virtual:qianshu/build-source'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// 仓库根在 Web 应用之上三层：repo/web/apps/qsmds-arco。
const repoRoot = path.resolve(appRoot, '../../..')

export function createDevelopmentMapPlugin(): PluginOption {
  // 单次构建内只生成一次：三个虚拟模块共享同一份生成结果。
  let pending: Promise<{ developmentMap: DevelopmentMapData, releaseNotes: ReleaseNotesData }> | null = null
  const loadData = () => pending ??= createDevelopmentMapData({ repoRoot, appRoot })

  const moduleSelectors = new Map<string, (data: Awaited<ReturnType<typeof loadData>>) => unknown>([
    [releaseNotesModuleId, data => data.releaseNotes],
    [developmentMapModuleId, data => data.developmentMap],
    [buildSourceModuleId, data => data.developmentMap.source],
  ])

  return {
    name: 'qsmds-development-map',
    resolveId(id) {
      if (moduleSelectors.has(id)) {
        return `\0${id}`
      }
    },
    async load(id) {
      const select = id.startsWith('\0') ? moduleSelectors.get(id.slice(1)) : undefined
      if (!select) {
        return
      }
      const data = await loadData()
      return `export default ${JSON.stringify(select(data))}`
    },
  } satisfies PluginOption
}
