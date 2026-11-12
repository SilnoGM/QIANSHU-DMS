import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export type DeploymentEnvironment = 'dev' | 'test' | 'prod' | 'unknown'

export interface DeploymentEnvironmentResolution {
  readonly environment: DeploymentEnvironment
  readonly source: 'APP_ENV' | 'MEDIA_STORAGE_ENV' | 'none'
}

/**
 * 解析部署环境标识。
 *
 * 开发、测试与生产都运行 `NODE_ENV=production` 或 `development`，不能用它区分环境；
 * `MEDIA_STORAGE_ENV` 在 COS 驱动下必填，但 local 驱动可以缺省，因此只作为明确取值为
 * dev/test/prod 时的后备来源。未配置时返回 unknown，页面显示“未知环境”，不猜测。
 */
export function resolveDeploymentEnvironment(
  env: Record<string, string | undefined> = process.env,
): DeploymentEnvironmentResolution {
  const appEnvironment = env.APP_ENV?.trim().toLowerCase()
  if (appEnvironment === 'dev' || appEnvironment === 'test' || appEnvironment === 'prod') {
    return { environment: appEnvironment, source: 'APP_ENV' }
  }

  const mediaEnvironment = env.MEDIA_STORAGE_ENV?.trim().toLowerCase()
  if (mediaEnvironment === 'dev' || mediaEnvironment === 'test' || mediaEnvironment === 'prod') {
    return { environment: mediaEnvironment, source: 'MEDIA_STORAGE_ENV' }
  }

  return { environment: 'unknown', source: 'none' }
}

/**
 * 读取镜像内 package.json 的版本。
 *
 * 发布归档通过 `pnpm deploy --prod` 生成，根 package.json 会被带入镜像；运行期
 * 只读该文件。读取失败时返回 unknown，不能用进程启动参数或环境变量猜测版本。
 */
export function readServerVersion(): string {
  try {
    const contents = readFileSync(
      resolve(__dirname, '../../../package.json'),
      'utf8',
    )
    const parsed: unknown = JSON.parse(contents)
    if (typeof parsed !== 'object' || parsed === null) {
      return 'unknown'
    }
    const version = (parsed as { version?: unknown }).version
    return typeof version === 'string' && version.trim() !== ''
      ? version
      : 'unknown'
  }
  catch {
    return 'unknown'
  }
}
