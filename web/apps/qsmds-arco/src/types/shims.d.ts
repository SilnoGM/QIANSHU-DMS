declare interface Window {
  webkitDevicePixelRatio: any
  mozDevicePixelRatio: any
}

declare const __SYSTEM_INFO__: {
  pkg: {
    version: string
    dependencies: Record<string, string>
    devDependencies: Record<string, string>
  }
  lastBuildTime: string
}

declare module 'virtual:fantastic-admin/turbo-console' {
  export function warnKeepAliveComponentNameMissing(filePath: string): void
}

/**
 * 构建期生成数据：由 `vite/development-map.ts` 从 Git 历史与依赖清单产出，
 * 运行时不访问 Git。数据契约见 `@/types/development-map`。
 */
declare module 'virtual:qianshu/release-notes' {
  import type { ReleaseNotesData } from './development-map'

  const data: ReleaseNotesData
  export default data
}

declare module 'virtual:qianshu/development-map' {
  import type { DevelopmentMapData } from './development-map'

  const data: DevelopmentMapData
  export default data
}

declare module 'virtual:qianshu/build-source' {
  import type { DevelopmentMapSource } from './development-map'

  const data: DevelopmentMapSource
  export default data
}
