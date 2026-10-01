import type {
  AuthContextDto,
  HealthFailureResponseDto,
  HealthSuccessResponseDto,
} from '@/api/generated/types.gen'
import dayjs from 'dayjs'
import { UAParser } from 'ua-parser-js'

export type StatusTone = 'ok' | 'down' | 'unknown'

export interface StatusEntry {
  label: string
  value: string
  hint?: string | null
}

export interface HealthProbeResult {
  tone: StatusTone
  label: string
  detail: string
  httpStatus: number | null
  requestId: string | null
  durationMs: number | null
  databaseTone: StatusTone
  databaseLabel: string
  checkedAt: string
}

/** 状态点配色统一走主题语义 token，亮色与暗色都随主题更新。 */
export function toneColor(tone: StatusTone): string {
  if (tone === 'ok') {
    return 'oklch(var(--primary))'
  }
  if (tone === 'down') {
    return 'oklch(var(--destructive))'
  }
  return 'oklch(var(--muted-foreground))'
}

export function formatStatusMoment(value: string): string {
  const moment = dayjs(value)
  return moment.isValid() ? moment.format('YYYY-MM-DD HH:mm:ss') : value
}

/** 兼容 AxiosHeaders 与普通对象两种响应头容器。 */
export function readRequestId(headers: unknown): string | null {
  if (typeof headers !== 'object' || headers === null) {
    return null
  }
  const container = headers as { get?: (name: string) => unknown, [key: string]: unknown }
  if (typeof container.get === 'function') {
    const value = container.get.call(headers, 'x-request-id')
    return typeof value === 'string' && value.length > 0 ? value : null
  }
  for (const [name, value] of Object.entries(container)) {
    if (name.toLowerCase() === 'x-request-id' && typeof value === 'string' && value.length > 0) {
      return value
    }
  }
  return null
}

/** 请求失败时 API Client 抛出的归一化错误只保留状态码与 requestId，这里做最后一道提取。 */
export function readFailureRequestId(error: unknown): string | null {
  const candidate = error as { requestId?: unknown, body?: { requestId?: unknown } }
  if (typeof candidate?.requestId === 'string' && candidate.requestId.length > 0) {
    return candidate.requestId
  }
  if (typeof candidate?.body?.requestId === 'string' && candidate.body.requestId.length > 0) {
    return candidate.body.requestId
  }
  return null
}

export function buildHealthProbeResult(input: {
  httpStatus: number | null
  body: HealthSuccessResponseDto | HealthFailureResponseDto | null
  requestId: string | null
  durationMs: number | null
  checkedAt: string
  unreachable?: boolean
}): HealthProbeResult {
  const databaseStatus = input.body?.info?.database?.status ?? input.body?.error?.database?.status ?? null
  const databaseTone: StatusTone = databaseStatus === 'up' ? 'ok' : databaseStatus === 'down' ? 'down' : 'unknown'
  const healthy = input.httpStatus === 200 && input.body?.status === 'ok'

  return {
    tone: healthy ? 'ok' : 'down',
    label: healthy ? '运行正常' : '不可用',
    detail: healthy
      ? '服务端与数据库均可用'
      : input.unreachable === true
        ? '无法连接服务端；服务可能未启动或网络不可达'
        : '服务端返回了异常状态，请结合状态码与请求编号排查',
    httpStatus: input.httpStatus,
    requestId: input.requestId,
    durationMs: input.durationMs,
    databaseTone,
    databaseLabel: databaseTone === 'ok' ? '可用' : databaseTone === 'down' ? '不可用' : '未返回',
    checkedAt: input.checkedAt,
  }
}

export function describeFrontendBuild(input: {
  productVersion: string
  buildTime: string
  buildMode: string
  source: {
    available: boolean
    tag: string | null
    shortCommit: string | null
    mode: string
  }
}): StatusEntry[] {
  const anchor = input.source.available
    ? [input.source.tag ?? '未打 Tag', input.source.shortCommit ?? ''].filter(value => value.length > 0).join(' · ')
    : '构建环境未提供 Git 历史'
  return [
    { label: '产品版本', value: input.productVersion },
    { label: '构建时间', value: input.buildTime },
    { label: '构建模式', value: input.buildMode },
    {
      label: '数据锚点',
      value: anchor,
      hint: '版本更新与开发图谱的数据截止到该提交',
    },
    {
      label: '数据来源',
      value: input.source.mode === 'release' ? '正式发版构建' : input.source.mode === 'development' ? '本地开发构建' : '不可用',
    },
  ]
}

/**
 * 登录态接口当前只返回用户标识、权限与会话时间，不返回角色列表；
 * 展示角色需要 users:read 权限或新增接口，这里如实标注「未提供」。
 */
export function describeIdentity(context: AuthContextDto | null): StatusEntry[] {
  if (context === null) {
    return [{ label: '登录身份', value: '未获取', hint: '当前没有认证上下文' }]
  }
  return [
    { label: '用户名', value: context.user.username },
    { label: '显示名', value: context.user.displayName },
    { label: '权限条数', value: `${context.permissions.length} 条` },
    {
      label: '角色',
      value: '未提供',
      hint: '当前登录态接口不返回角色列表；展示角色需要 users:read 权限或新增接口',
    },
    { label: '强制修改密码', value: context.user.mustChangePassword ? '是' : '否' },
    { label: '会话建立时间', value: formatStatusMoment(context.session.createdAt) },
    { label: '最后活动时间', value: formatStatusMoment(context.session.lastActivityAt) },
    { label: '空闲失效时间', value: formatStatusMoment(context.session.idleExpiresAt), hint: '超时未操作需要重新登录' },
    { label: '会话最长有效期', value: formatStatusMoment(context.session.absoluteExpiresAt) },
  ]
}

export interface BrowserEnvironmentInput {
  userAgent: string
  language: string
  timezone: string
  viewportWidth: number
  viewportHeight: number
  devicePixelRatio: number
  online: boolean
  storageAvailable: boolean
}

export function describeBrowserEnvironment(input: BrowserEnvironmentInput): StatusEntry[] {
  const parser = new UAParser(input.userAgent)
  const browser = parser.getBrowser()
  const engine = parser.getEngine()
  const os = parser.getOS()
  const joinVersion = (name?: string, version?: string) => [name, version].filter(value => typeof value === 'string' && value.length > 0).join(' ') || '未知'

  return [
    { label: '浏览器', value: joinVersion(browser.name, browser.version) },
    { label: '渲染引擎', value: joinVersion(engine.name, engine.version) },
    { label: '操作系统', value: joinVersion(os.name, os.version) },
    { label: '视口', value: `${input.viewportWidth} × ${input.viewportHeight}` },
    { label: '像素比', value: String(input.devicePixelRatio) },
    { label: '界面语言', value: input.language },
    { label: '时区', value: input.timezone },
    { label: '网络', value: input.online ? '在线' : '离线' },
    { label: '本地存储', value: input.storageAvailable ? '可用' : '不可用' },
  ]
}
