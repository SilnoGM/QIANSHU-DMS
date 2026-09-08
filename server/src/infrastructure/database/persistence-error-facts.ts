export interface PersistenceErrorFacts {
  readonly codes: ReadonlySet<string>
  readonly constraints: ReadonlySet<string>
  readonly fieldNames: ReadonlySet<string>
  readonly targets: ReadonlySet<string>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function addString(destination: Set<string>, value: unknown): void {
  if (typeof value === 'string') {
    destination.add(value.toLowerCase())
  }
}

function addTargets(destination: Set<string>, value: unknown): void {
  const values = Array.isArray(value) ? value : [value]

  for (const item of values) {
    if (typeof item === 'string') {
      destination.add(item.toLowerCase().replaceAll('_', ''))
    }
  }
}

function addConstraint(
  constraints: Set<string>,
  targets: Set<string>,
  value: unknown,
): void {
  if (typeof value === 'string') {
    addString(constraints, value)
    return
  }
  if (!isRecord(value)) {
    return
  }

  addTargets(targets, value.fields)
  addString(constraints, value.index)
  addString(constraints, value.name)
}

/**
 * Prisma Client 与 driver adapter 会使用不同的结构包装数据库错误。这里仅遍历
 * 已知容器和白名单字段，绝不解析 message/detail，避免 SQL 与用户值进入稳定
 * 错误判断或意外泄漏到 HTTP 响应。
 */
export function readPersistenceErrorFacts(
  error: unknown,
): PersistenceErrorFacts {
  const codes = new Set<string>()
  const constraints = new Set<string>()
  const fieldNames = new Set<string>()
  const targets = new Set<string>()
  const pending: unknown[] = [error]
  const visited = new Set<object>()

  while (pending.length > 0) {
    const candidate = pending.pop()
    if (!isRecord(candidate) || visited.has(candidate)) {
      continue
    }
    visited.add(candidate)

    addString(codes, candidate.code)
    // Prisma 7 driver adapter 把 PostgreSQL SQLSTATE 放在 cause.originalCode；
    // 只读取这个稳定白名单字段，绝不解析可能包含 SQL 或参数的 originalMessage。
    addString(codes, candidate.originalCode)
    addConstraint(constraints, targets, candidate.constraint)
    addString(fieldNames, candidate.field_name)
    addString(fieldNames, candidate.fieldName)
    addTargets(targets, candidate.target)

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

  return { codes, constraints, fieldNames, targets }
}

export function hasPersistenceCode(
  facts: PersistenceErrorFacts,
  code: string,
): boolean {
  return facts.codes.has(code.toLowerCase())
}

export function hasPersistenceConstraint(
  facts: PersistenceErrorFacts,
  constraint: string,
): boolean {
  return facts.constraints.has(constraint.toLowerCase())
}

export function hasPersistenceTarget(
  facts: PersistenceErrorFacts,
  target: string,
): boolean {
  return facts.targets.has(target.toLowerCase().replaceAll('_', ''))
}

export function hasPersistenceFieldName(
  facts: PersistenceErrorFacts,
  pattern: RegExp,
): boolean {
  return [...facts.fieldNames].some(fieldName => pattern.test(fieldName))
}
