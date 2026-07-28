import { HttpStatus } from '@nestjs/common'

import { ApiException } from '../../infrastructure/http/api.exception'

interface PersistenceErrorFacts {
  readonly codes: Set<string>
  readonly constraints: Set<string>
  readonly fieldNames: Set<string>
  readonly targets: Set<string>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function addString(
  destination: Set<string>,
  value: unknown,
): void {
  if (typeof value === 'string') {
    destination.add(value.toLowerCase())
  }
}

function addTargets(destination: Set<string>, value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string') {
        destination.add(item.toLowerCase().replaceAll('_', ''))
      }
    }
    return
  }

  if (typeof value === 'string') {
    destination.add(value.toLowerCase().replaceAll('_', ''))
  }
}

function addConstraintFacts(
  facts: PersistenceErrorFacts,
  value: unknown,
): void {
  if (typeof value === 'string') {
    addString(facts.constraints, value)
    return
  }
  if (!isRecord(value)) {
    return
  }

  // Prisma 7 driver adapter 使用结构化 constraint，而旧 client 使用字符串名称。
  // 这里只读取明确的 fields/index/name，绝不扫描 message/detail。
  addTargets(facts.targets, value.fields)
  addString(facts.constraints, value.index)
  addString(facts.constraints, value.name)
}

/**
 * 只读取白名单结构字段，不解析数据库 message/detail，避免内部 SQL 或用户值被误当
 * 成稳定错误信号，也确保未知异常不会随响应向外泄露。
 */
function readPersistenceErrorFacts(error: unknown): PersistenceErrorFacts {
  const facts: PersistenceErrorFacts = {
    codes: new Set<string>(),
    constraints: new Set<string>(),
    fieldNames: new Set<string>(),
    targets: new Set<string>(),
  }
  const pending: unknown[] = [error]
  const visited = new Set<object>()

  while (pending.length > 0) {
    const candidate = pending.pop()
    if (!isRecord(candidate) || visited.has(candidate)) {
      continue
    }
    visited.add(candidate)

    addString(facts.codes, candidate.code)
    addConstraintFacts(facts, candidate.constraint)
    addString(facts.fieldNames, candidate.field_name)
    addString(facts.fieldNames, candidate.fieldName)
    addTargets(facts.targets, candidate.target)

    // Prisma 与 driver adapter 的结构在不同运行模式下会多包一层，只遍历已知容器。
    for (const key of [
      'meta',
      'database_error',
      'databaseError',
      'driver_adapter_error',
      'driverAdapterError',
      'cause',
    ]) {
      const nested = candidate[key]
      if (isRecord(nested)) {
        pending.push(nested)
      }
    }
  }

  return facts
}

function hasCode(
  facts: PersistenceErrorFacts,
  code: string,
): boolean {
  return facts.codes.has(code.toLowerCase())
}

function hasConstraint(
  facts: PersistenceErrorFacts,
  constraint: string,
): boolean {
  return facts.constraints.has(constraint.toLowerCase())
}

function hasParentForeignKeyFieldName(
  facts: PersistenceErrorFacts,
): boolean {
  return [...facts.fieldNames].some(fieldName =>
    /^regions_parent_id_fkey(?:\s+\(index\))?$/u.test(fieldName),
  )
}

function mappedException(
  status: HttpStatus,
  code: string,
  publicMessage: string,
): ApiException {
  return new ApiException(status, code, publicMessage)
}

export function mapRegionPersistenceError(error: unknown): ApiException {
  if (error instanceof ApiException) {
    return error
  }

  const facts = readPersistenceErrorFacts(error)
  const isUniqueViolation = hasCode(facts, 'P2002') || hasCode(facts, '23505')
  const isForeignKeyViolation =
    hasCode(facts, 'P2003') || hasCode(facts, '23503')

  if (
    isUniqueViolation
    && (
      facts.targets.has('code')
      || hasConstraint(facts, 'regions_code_key')
    )
  ) {
    return mappedException(
      HttpStatus.CONFLICT,
      'REGION_CODE_ALREADY_EXISTS',
      '地区编码已存在',
    )
  }

  if (
    isUniqueViolation
    && (
      (
        facts.targets.size === 1
        && facts.targets.has('normalizedname')
      )
      ||
      (
        facts.targets.has('parentid')
        && facts.targets.has('normalizedname')
      )
      || hasConstraint(
        facts,
        'regions_parent_id_normalized_name_key',
      )
      || hasConstraint(
        facts,
        'regions_root_normalized_name_key',
      )
    )
  ) {
    return mappedException(
      HttpStatus.CONFLICT,
      'REGION_NAME_ALREADY_EXISTS',
      '同一上级下地区名称已存在',
    )
  }

  if (
    isForeignKeyViolation
    && (
      hasParentForeignKeyFieldName(facts)
      || facts.targets.has('parentid')
      || hasConstraint(facts, 'regions_parent_id_fkey')
    )
  ) {
    return mappedException(
      HttpStatus.NOT_FOUND,
      'REGION_PARENT_NOT_FOUND',
      '上级地区不存在',
    )
  }

  if (
    hasCode(facts, 'P2034')
    || hasCode(facts, '40001')
    || hasCode(facts, '40P01')
    || hasCode(facts, '55P03')
  ) {
    return mappedException(
      HttpStatus.CONFLICT,
      'REGION_STATE_CHANGED',
      '地区状态已变化，请刷新后重试',
    )
  }

  if (
    hasCode(facts, '23514')
    && hasConstraint(facts, 'regions_hierarchy_check')
  ) {
    return mappedException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'REGION_HIERARCHY_INVALID',
      '地区层级关系不合法',
    )
  }

  return mappedException(
    HttpStatus.INTERNAL_SERVER_ERROR,
    'INTERNAL_ERROR',
    '服务器内部错误',
  )
}
