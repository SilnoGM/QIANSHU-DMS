import { registerAs } from '@nestjs/config'

/**
 * IPFoxy 开放接口的固定入口。
 *
 * 不接受环境变量覆盖：出站地址是服务端安全边界的一部分，避免配置漂移把
 * 代理凭据发往非预期主机。
 */
export const IPFOXY_API_BASE_URL = 'https://apis.ipfoxy.com' as const

export interface IpfoxyConfiguration {
  readonly baseUrl: string
  readonly enabled: boolean
}

export default registerAs('ipfoxy', (): IpfoxyConfiguration => Object.freeze({
  baseUrl: IPFOXY_API_BASE_URL,
  enabled: Boolean(
    process.env.IPFOXY_API_ID
    && process.env.IPFOXY_API_TOKEN
    && process.env.PROXY_NODE_SECRET_KEY,
  ),
}))
