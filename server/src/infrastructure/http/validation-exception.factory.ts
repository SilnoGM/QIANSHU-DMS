import { HttpStatus } from '@nestjs/common'
import type { ValidationError } from 'class-validator'

import type { ApiFieldErrors } from './api-error.dto'
import { ApiException } from './api.exception'

const translatedConstraintMessages: Readonly<Record<string, string>> = {
  whitelistValidation: '不允许提交该字段',
  isString: '必须是字符串',
  isNotEmpty: '不能为空',
}

const defaultMessageFragmentByConstraint: Readonly<Record<string, string>> = {
  whitelistValidation: 'should not exist',
  isString: 'must be a string',
  isNotEmpty: 'should not be empty',
}

function hasChineseText(message: string): boolean {
  return /[\u3400-\u9fff]/u.test(message)
}

function isExplicitChineseMessage(
  message: string,
  property: string,
): boolean {
  // class-validator 会把 property 原样插入默认文案；判定公开中文前必须移除全部确切插值，不能让中文字段名替英文内部详情背书。
  const messageWithoutProperty = property
    ? message.split(property).join('')
    : message
  return (
    hasChineseText(messageWithoutProperty) &&
    !/[A-Za-z]/u.test(messageWithoutProperty)
  )
}

function safeConstraintMessage(
  constraintName: string,
  originalMessage: string,
  property: string,
): string {
  const translatedMessage = translatedConstraintMessages[constraintName]
  const defaultMessageFragment =
    defaultMessageFragmentByConstraint[constraintName]

  // 默认英文模板会插入属性名；即使属性名含中文，也必须先识别英文片段，避免将混合文案误判为显式中文契约。
  if (
    translatedMessage &&
    (defaultMessageFragment
      ? originalMessage.includes(defaultMessageFragment)
      : !hasChineseText(originalMessage))
  ) {
    return translatedMessage
  }

  // 排除 property 后仍为纯中文内容的 decorator 文案属于显式公共契约；其余内部文本不得透传。
  if (isExplicitChineseMessage(originalMessage, property)) {
    return originalMessage
  }

  return translatedMessage ?? '字段校验失败'
}

export function flattenValidationErrors(
  errors: readonly ValidationError[],
): ApiFieldErrors {
  const messagesByPath = new Map<string, Set<string>>()

  function visit(error: ValidationError, parentPath: string): void {
    const path = parentPath
      ? `${parentPath}.${error.property}`
      : error.property

    if (error.constraints && path) {
      const messages = messagesByPath.get(path) ?? new Set<string>()

      for (const [constraintName, originalMessage] of Object.entries(
        error.constraints,
      )) {
        messages.add(
          safeConstraintMessage(
            constraintName,
            originalMessage,
            error.property,
          ),
        )
      }

      messagesByPath.set(path, messages)
    }

    for (const child of error.children ?? []) {
      visit(child, path)
    }
  }

  for (const error of errors) {
    visit(error, '')
  }

  // Object.fromEntries 可安全保留名为 __proto__ 的非法输入字段，避免普通对象赋值触发原型污染。
  return Object.fromEntries(
    [...messagesByPath].map(([path, messages]) => [path, [...messages]]),
  )
}

export function createValidationException(
  errors: ValidationError[],
): ApiException {
  return new ApiException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'VALIDATION_FAILED',
    '请求参数校验失败',
    flattenValidationErrors(errors),
  )
}
