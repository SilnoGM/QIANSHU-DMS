import { randomUUID } from 'node:crypto'

import { REQUEST_ID_HEADER } from '../../app.constants'

type RandomUuid = () => string
const requestIdKey = Symbol('qianshuRequestId')
type RequestWithId = {
  [requestIdKey]?: string
}

const unavailableRequestIdError =
  'Request ID is unavailable before requestIdMiddleware runs'

export function createRequestId(
  randomUuid: RandomUuid = randomUUID,
): string {
  return `req_${randomUuid()}`
}

export function requestIdMiddleware(
  request: object,
  response: { setHeader(name: string, value: string): void },
  next: () => void,
): void {
  const requestId = createRequestId()
  const requestWithId = request as RequestWithId

  // Symbol 将请求 ID 限定在当前进程内的请求对象上，避免与框架或业务字段重名，也不会被常规序列化意外暴露。
  // 必须先完成绑定，再写响应 Header，最后进入后续处理链，确保任何下游代码都只读取同一个服务端生成值。
  requestWithId[requestIdKey] = requestId
  response.setHeader(REQUEST_ID_HEADER, requestId)
  next()
}

export function getRequestId(request: object): string {
  const requestId = (request as RequestWithId)[requestIdKey]

  if (requestId === undefined) {
    // 读取发生在 middleware 之前属于生命周期错误；此处禁止补生成，否则响应 Header 与下游日志可能得到不同 ID。
    throw new Error(unavailableRequestIdError)
  }

  return requestId
}
