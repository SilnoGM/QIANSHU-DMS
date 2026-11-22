import { registerAs } from '@nestjs/config'

/**
 * 猎豹 CheetahGo 开放平台的固定入口。
 *
 * 与 IPFoxy 同理不接受环境变量覆盖：出站地址是安全边界的一部分，
 * 避免配置漂移把 appid/secret 发往非预期主机。
 */
export const CHEETAHGO_API_BASE_URL = 'https://open-api.cmcm.com' as const

export interface CheetahGoConfiguration {
  readonly baseUrl: string
  readonly enabled: boolean
}

export default registerAs('cheetahgo', (): CheetahGoConfiguration => Object.freeze({
  baseUrl: CHEETAHGO_API_BASE_URL,
  // 凭据可选：缺省时同步任务跳过并如实上报，不阻断本地开发与服务启动。
  enabled: Boolean(process.env.CHEETAHGO_APPID && process.env.CHEETAHGO_SECRET),
}))
