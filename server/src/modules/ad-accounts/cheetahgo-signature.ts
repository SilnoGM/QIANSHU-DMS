import { createHash } from 'node:crypto'

/**
 * 猎豹 CheetahGo 开放平台的请求签名。
 *
 * 协议规定：appid、secret、timestamp 三个参数按字典序排序后拼成
 * `appid=..&secret=..&timestamp=..`，再做 SHA1 得到 signature。
 *
 * 这里的 SHA1 是对方服务端协议的一部分，只用于证明请求由持有 secret 的一方发起
 * （防篡改、防重放）；它不用于密码存储、token 校验或任何本地凭据保护。
 * 换成 SHA256/HMAC 会导致对方验签失败，因此不能替换。
 */
export function signCheetahGoTokenRequest(
  appid: string,
  secret: string,
  timestamp: number,
): string {
  const canonical = `appid=${appid}&secret=${secret}&timestamp=${timestamp}`

  return createHash('sha1').update(canonical).digest('hex')
}
