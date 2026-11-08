import {
  MAX_NOTIFICATION_TEMPLATE_LENGTH,
  MAX_NOTIFICATION_VARIABLE_LENGTH,
} from './notification.types'

export interface NotificationTemplateVariable {
  readonly name: string
  readonly required?: boolean
  readonly maxLength?: number
  readonly sensitive?: boolean
}

export type NotificationTemplateRenderResult =
  | {
    readonly ok: true
    readonly content: string
    readonly linkUrl: string | null
    readonly truncated: boolean
    readonly warnings: readonly 'SENSITIVE_VARIABLE_MASKED'[]
  }
  | {
    readonly ok: false
    readonly code: 'TEMPLATE_VARIABLE_MISSING' | 'TEMPLATE_TOO_LONG'
    readonly message: string
  }

const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/gu
const SINGLE_BRACE_PATTERN = /(?<!\{)\{([a-zA-Z0-9_]+)\}(?!\})/gu

function stringifyValue(value: string | number | null, maxLength: number): string {
  const raw = value === null ? '' : String(value)
  if (raw.length <= maxLength) {
    return raw
  }
  return `${raw.slice(0, Math.max(0, maxLength - 1))}…`
}

function truncate(text: string, maxLength: number): { readonly content: string, readonly truncated: boolean } {
  if (text.length <= maxLength) {
    return { content: text, truncated: false }
  }
  return { content: `${text.slice(0, Math.max(0, maxLength - 1))}…`, truncated: true }
}

/**
 * 模板只支持 {{variable}} 占位，不执行表达式、不渲染 HTML。
 *
 * 缺失变量、未知占位或超长模板都返回失败结果，由发布层落失败记录；
 * 这里不抛异常，避免通知配置问题回滚业务事务。
 */
export function renderNotificationTemplate(input: {
  readonly body: string
  readonly linkUrlTemplate?: string | null
  readonly variables: Readonly<Record<string, string | number | null>>
  readonly allowed: readonly NotificationTemplateVariable[]
  readonly allowSensitive: boolean
  readonly maxLength?: number
}): NotificationTemplateRenderResult {
  const maxLength = Math.min(
    Math.max(1, input.maxLength ?? MAX_NOTIFICATION_TEMPLATE_LENGTH),
    MAX_NOTIFICATION_TEMPLATE_LENGTH,
  )
  const definitions = new Map(input.allowed.map(variable => [variable.name, variable]))
  const warnings: 'SENSITIVE_VARIABLE_MASKED'[] = []
  const placeholders = new Set<string>()

  for (const match of input.body.matchAll(PLACEHOLDER_PATTERN)) {
    const name = match[1]
    if (name !== undefined) {
      placeholders.add(name)
    }
  }
  if (input.linkUrlTemplate) {
    for (const match of input.linkUrlTemplate.matchAll(PLACEHOLDER_PATTERN)) {
      const name = match[1]
      if (name !== undefined) {
        placeholders.add(name)
      }
    }
  }

  for (const name of placeholders) {
    const definition = definitions.get(name)
    if (definition === undefined) {
      return {
        ok: false,
        code: 'TEMPLATE_VARIABLE_MISSING',
        message: `模板包含未声明变量：${name}`,
      }
    }
    const value = input.variables[name]
    if ((value === undefined || value === null || value === '') && definition.required !== false) {
      return {
        ok: false,
        code: 'TEMPLATE_VARIABLE_MISSING',
        message: `模板变量缺失：${name}`,
      }
    }
  }

  const resolve = (name: string): string => {
    const definition = definitions.get(name)!
    const value = input.variables[name] ?? ''
    if (definition.sensitive === true && !input.allowSensitive) {
      warnings.push('SENSITIVE_VARIABLE_MASKED')
      return '***'
    }
    return stringifyValue(
      value,
      Math.min(definition.maxLength ?? MAX_NOTIFICATION_VARIABLE_LENGTH, MAX_NOTIFICATION_VARIABLE_LENGTH),
    )
  }

  const renderedBody = input.body.replace(PLACEHOLDER_PATTERN, (_match, name: string) => resolve(name))
  const renderedLink = input.linkUrlTemplate
    ? input.linkUrlTemplate.replace(PLACEHOLDER_PATTERN, (_match, name: string) => resolve(name))
    : null
  const truncated = truncate(renderedBody, maxLength)

  return {
    ok: true,
    content: truncated.content,
    linkUrl: renderedLink,
    truncated: truncated.truncated,
    warnings: [...new Set(warnings)],
  }
}

/**
 * 保存模板时使用：返回占位符清单与未声明变量，供管理端阻止坏模板。
 */
export function inspectNotificationTemplate(input: {
  readonly body: string
  readonly titleTemplate?: string | null
  readonly linkUrlTemplate?: string | null
  readonly allowed: readonly NotificationTemplateVariable[]
}): {
  readonly placeholders: readonly string[]
  readonly undeclared: readonly string[]
  readonly singleBrace: readonly string[]
} {
  const names = new Set(input.allowed.map(variable => variable.name))
  const placeholders = new Set<string>()
  const singleBrace = new Set<string>()
  for (const text of [input.body, input.titleTemplate ?? '', input.linkUrlTemplate ?? '']) {
    for (const match of text.matchAll(PLACEHOLDER_PATTERN)) {
      const name = match[1]
      if (name !== undefined) {
        placeholders.add(name)
      }
    }
    for (const match of text.matchAll(SINGLE_BRACE_PATTERN)) {
      const name = match[1]
      if (name !== undefined) {
        singleBrace.add(name)
      }
    }
  }
  return {
    placeholders: [...placeholders].sort(),
    undeclared: [...placeholders].filter(name => !names.has(name)).sort(),
    singleBrace: [...singleBrace].sort(),
  }
}
