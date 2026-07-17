import { createHash } from 'node:crypto'
import process from 'node:process'

import { getTrustedCommandExitCode } from './run-command.mjs'

const HTTP_METHODS = new Set([
  'delete',
  'get',
  'head',
  'options',
  'patch',
  'post',
  'put',
  'trace',
])
const API_ERROR_REF = '#/components/schemas/ApiError'
const MISSING_OPERATION_ID_PREFIX = '__missing_operation_id__'
const CONTRACT_EXTENSION = 'x-qianshu-contract'
const CONTRACT_BOOLEAN_FIELDS = [
  'authentication',
  'authorization',
  'resourceLocator',
  'conflict',
  'validation',
]
const CONTRACT_METADATA_FIELDS = [
  'kind',
  ...CONTRACT_BOOLEAN_FIELDS,
]
const CONTRACT_OPTIONAL_METADATA_FIELDS = [
  'session',
  'csrf',
  'privateNoStore',
  'errors',
]
const CONTRACT_ALLOWED_METADATA_FIELDS = new Set([
  ...CONTRACT_METADATA_FIELDS,
  ...CONTRACT_OPTIONAL_METADATA_FIELDS,
])
const CONTRACT_SESSION_REQUIREMENTS = new Set([
  'none',
  'optional',
  'required',
])
const CONTRACT_ERROR_STATUSES = new Set([
  400,
  401,
  403,
  404,
  409,
  422,
  429,
  500,
  503,
])
const CONTRACT_ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/u
const API_ERROR_PROPERTIES = [
  'code',
  'fieldErrors',
  'message',
  'requestId',
]
const API_ERROR_REQUIRED = ['code', 'message', 'requestId']
const API_ERROR_FORBIDDEN_KEYWORDS = [
  '$ref',
  'allOf',
  'oneOf',
  'anyOf',
  'not',
  'items',
]

export class ContractValidationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ContractValidationError'
  }
}

function fail(message) {
  throw new ContractValidationError(message)
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOwn(value, property) {
  return isRecord(value) && Object.hasOwn(value, property)
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function normalizedLabel(value, fallback) {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

function operationContext({ path, method, operation }, status) {
  const fields = [`path=${path}`, `method=${method}`]
  if (status !== undefined) {
    fields.push(`status=${status}`)
  }
  if (
    isRecord(operation) &&
    typeof operation.operationId === 'string' &&
    operation.operationId.length > 0
  ) {
    fields.push(`operationId=${operation.operationId}`)
  }
  return `[${fields.join(' ')}]`
}

function bytesFromSnapshot(value, label) {
  if (typeof value === 'string' || Buffer.isBuffer(value)) {
    return Buffer.from(value)
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  }
  fail(`Invalid snapshot bytes: ${label}`)
}

export function parseOpenApiSnapshot(contents, sourceLabel) {
  const label = normalizedLabel(sourceLabel, 'OpenAPI snapshot')
  let parsed

  try {
    const text = bytesFromSnapshot(contents, label).toString('utf8')
    parsed = JSON.parse(text)
  } catch {
    fail(`Invalid OpenAPI snapshot: ${label}`)
  }

  if (!isRecord(parsed)) {
    fail(`Invalid OpenAPI snapshot root: ${label}`)
  }
  return parsed
}

export function serializeOpenApiSnapshot(document) {
  try {
    if (!isRecord(document)) {
      fail('Cannot serialize OpenAPI snapshot')
    }
    const serialized = JSON.stringify(document, null, 2)
    if (typeof serialized !== 'string') {
      fail('Cannot serialize OpenAPI snapshot')
    }
    return `${serialized}\n`
  } catch (error) {
    if (error instanceof ContractValidationError) {
      throw error
    }
    fail('Cannot serialize OpenAPI snapshot')
  }
}

export function sha256(contents) {
  try {
    return createHash('sha256')
      .update(bytesFromSnapshot(contents, 'OpenAPI snapshot'))
      .digest('hex')
  } catch (error) {
    if (error instanceof ContractValidationError) {
      throw error
    }
    fail('Cannot hash OpenAPI snapshot')
  }
}

export function collectOperations(document) {
  if (!isRecord(document?.paths)) {
    return []
  }

  const operations = []
  for (const path of Object.keys(document.paths).sort()) {
    const unresolvedPathItem = document.paths[path]
    if (!isRecord(unresolvedPathItem)) {
      continue
    }
    // Path Item `$ref` 可以把公开操作放到 paths 之外；必须先解析再枚举方法，
    // 否则 operationId、metadata、Header 与错误矩阵都会被整体绕过。
    const pathItem = resolveReferenceObject(document, unresolvedPathItem)
    for (const method of Object.keys(pathItem).sort()) {
      if (!HTTP_METHODS.has(method) || !isRecord(pathItem[method])) {
        continue
      }
      operations.push({
        path,
        method,
        operation: pathItem[method],
        pathItem,
      })
    }
  }
  return operations
}

export function collectOperationIds(document) {
  return collectOperations(document)
    .map(({ operation }) => operation.operationId)
    .filter(operationId =>
      typeof operationId === 'string' && operationId.length > 0,
    )
}

export function assertSnapshotBytesEqual({
  actual,
  expected,
  actualLabel,
  expectedLabel,
}) {
  const normalizedActualLabel = normalizedLabel(actualLabel, 'actual snapshot')
  const normalizedExpectedLabel = normalizedLabel(
    expectedLabel,
    'expected snapshot',
  )
  const actualBytes = bytesFromSnapshot(actual, normalizedActualLabel)
  const expectedBytes = bytesFromSnapshot(expected, normalizedExpectedLabel)

  if (!actualBytes.equals(expectedBytes)) {
    fail(
      `Snapshot bytes differ: ${normalizedActualLabel} does not match ${normalizedExpectedLabel}`,
    )
  }
}

export function assertOperationIdBaseline(currentDocument, baselineDocument) {
  const currentOperationIds = new Set(collectOperationIds(currentDocument))
  for (const baselineOperationId of collectOperationIds(baselineDocument)) {
    if (!currentOperationIds.has(baselineOperationId)) {
      fail(`Missing baseline operationId: ${baselineOperationId}`)
    }
  }
}

function decodeJsonPointerToken(token) {
  let decoded
  try {
    decoded = decodeURIComponent(token)
  } catch {
    fail('Invalid JSON Pointer in local $ref')
  }
  if (/~(?:[^01]|$)/u.test(decoded)) {
    fail('Invalid JSON Pointer in local $ref')
  }
  return decoded.replaceAll('~1', '/').replaceAll('~0', '~')
}

function parseLocalReferenceTokens(reference) {
  if (typeof reference !== 'string' || !reference.startsWith('#')) {
    fail('Only local $ref values are supported')
  }
  if (reference === '#') {
    return []
  }
  if (!reference.startsWith('#/')) {
    fail('Invalid JSON Pointer in local $ref')
  }

  return reference
    .slice(2)
    .split('/')
    .map(decodeJsonPointerToken)
}

function resolveReferenceTokens(document, tokens) {
  let current = document
  for (const token of tokens) {
    if (
      (typeof current !== 'object' || current === null) ||
      !Object.hasOwn(current, token)
    ) {
      fail('Unresolved local $ref')
    }
    current = current[token]
  }
  return current
}

function resolveLocalReference(document, reference) {
  return resolveReferenceTokens(
    document,
    parseLocalReferenceTokens(reference),
  )
}

function resolveDirectSchemaComponent(document, reference, message) {
  const tokens = parseLocalReferenceTokens(reference)
  if (
    tokens.length !== 3 ||
    tokens[0] !== 'components' ||
    tokens[1] !== 'schemas' ||
    tokens[2].length === 0
  ) {
    fail(message)
  }
  const target = resolveReferenceTokens(document, tokens)
  if (!isRecord(target)) {
    fail(message)
  }
  return target
}

function resolveReferenceObject(document, value) {
  let current = value
  const activeReferences = new Set()
  while (isRecord(current) && hasOwn(current, '$ref')) {
    const reference = current.$ref
    if (typeof reference !== 'string') {
      fail('Invalid local $ref')
    }
    if (activeReferences.has(reference)) {
      fail('Circular non-schema local $ref')
    }
    activeReferences.add(reference)
    current = resolveLocalReference(document, reference)
  }
  if (!isRecord(current)) {
    fail('Resolved local $ref must target an object')
  }
  return current
}

/**
 * 文档级 ref 扫描为一个独立 root 建立 active/completed。active 只阻断当前
 * back-edge；父节点仍会继续扫描同层其他键。只有一个对象的所有分支完整成功后
 * 才加入 completed，因此 unresolved sibling 不会被递归环或 diamond cache 吞掉。
 */
function assertAllLocalReferencesResolve(document) {
  const active = new WeakSet()
  const completed = new WeakSet()

  function visit(value) {
    if (typeof value !== 'object' || value === null) {
      return
    }
    if (active.has(value) || completed.has(value)) {
      return
    }

    active.add(value)
    try {
      if (isRecord(value) && hasOwn(value, '$ref')) {
        if (typeof value.$ref !== 'string') {
          fail('Invalid local $ref')
        }
        visit(resolveLocalReference(document, value.$ref))
      }

      const entries = Array.isArray(value)
        ? value.entries()
        : Object.entries(value).sort(([left], [right]) =>
            compareStrings(left, right),
          )
      for (const [key, child] of entries) {
        if (key === '$ref') {
          continue
        }
        visit(child)
      }
      completed.add(value)
    } finally {
      active.delete(value)
    }
  }

  visit(document)
}

function sameStringSet(value, expected) {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every(item => typeof item === 'string') &&
    new Set(value).size === value.length &&
    [...value].sort().every((item, index) => item === [...expected].sort()[index])
  )
}

function assertNonNullableType(schema, type, label) {
  if (!isRecord(schema) || schema.type !== type) {
    fail(`ApiError ${label} must have type ${type}`)
  }
  if (schema.nullable === true) {
    fail(`ApiError ${label} must not be nullable`)
  }
}

function assertApiErrorShape(document) {
  const schema = document.components?.schemas?.ApiError
  assertNonNullableType(schema, 'object', 'top')

  for (const keyword of API_ERROR_FORBIDDEN_KEYWORDS) {
    if (hasOwn(schema, keyword)) {
      fail(`ApiError must not contain ${keyword}`)
    }
  }
  if (
    !isRecord(schema.properties) ||
    JSON.stringify(Object.keys(schema.properties).sort()) !==
      JSON.stringify(API_ERROR_PROPERTIES)
  ) {
    fail('ApiError properties must be exact')
  }
  if (!sameStringSet(schema.required, API_ERROR_REQUIRED)) {
    fail('ApiError required fields must be exact')
  }

  assertNonNullableType(schema.properties.code, 'string', 'code')
  assertNonNullableType(schema.properties.message, 'string', 'message')
  assertNonNullableType(schema.properties.requestId, 'string', 'requestId')
  assertNonNullableType(
    schema.properties.fieldErrors,
    'object',
    'fieldErrors',
  )
  assertNonNullableType(
    schema.properties.fieldErrors.additionalProperties,
    'array',
    'fieldErrors.additionalProperties',
  )
  assertNonNullableType(
    schema.properties.fieldErrors.additionalProperties.items,
    'string',
    'fieldErrors.additionalProperties.items',
  )
}

function assertMetadata(record, metadata) {
  const context = operationContext(record)
  if (!isRecord(metadata)) {
    fail(`Missing x-qianshu-contract ${context}`)
  }

  const keys = Object.keys(metadata)
  const missingField = CONTRACT_METADATA_FIELDS.find(
    field => !hasOwn(metadata, field),
  )
  const unknownField = keys.find(
    field => !CONTRACT_ALLOWED_METADATA_FIELDS.has(field),
  )
  if (missingField !== undefined || unknownField !== undefined) {
    fail(
      `x-qianshu-contract ${missingField ?? unknownField ?? 'fields'} must be exact ${context}`,
    )
  }
  if (metadata.kind !== 'health' && metadata.kind !== 'application') {
    fail(`x-qianshu-contract kind is invalid ${context}`)
  }
  for (const field of CONTRACT_BOOLEAN_FIELDS) {
    if (typeof metadata[field] !== 'boolean') {
      fail(`x-qianshu-contract ${field} must be boolean ${context}`)
    }
  }
  if (metadata.authorization && !metadata.authentication) {
    fail(`authorization requires authentication ${context}`)
  }
  if (hasOwn(metadata, 'session')) {
    if (!CONTRACT_SESSION_REQUIREMENTS.has(metadata.session)) {
      fail(`x-qianshu-contract session is invalid ${context}`)
    }
    const sessionRequiresAuthentication = metadata.session === 'required'
    if (metadata.authentication !== sessionRequiresAuthentication) {
      fail(`session requirement conflicts with authentication ${context}`)
    }
  }
  for (const field of ['csrf', 'privateNoStore']) {
    if (hasOwn(metadata, field) && typeof metadata[field] !== 'boolean') {
      fail(`x-qianshu-contract ${field} must be boolean ${context}`)
    }
  }
  if (hasOwn(metadata, 'errors')) {
    assertErrorMetadata(record, metadata.errors)
  }
  if (metadata.kind === 'health') {
    for (const field of CONTRACT_BOOLEAN_FIELDS) {
      if (metadata[field]) {
        fail(`health metadata ${field} must be false ${context}`)
      }
    }
    const optionalField = CONTRACT_OPTIONAL_METADATA_FIELDS.find(
      field => hasOwn(metadata, field),
    )
    if (optionalField !== undefined) {
      fail(`health metadata cannot declare ${optionalField} ${context}`)
    }
  }
  return metadata
}

function assertErrorMetadata(record, errors) {
  const context = operationContext(record)
  if (!Array.isArray(errors) || errors.length === 0) {
    fail(`x-qianshu-contract errors must be a non-empty array ${context}`)
  }

  const seenStatuses = new Set()
  for (const error of errors) {
    if (
      !isRecord(error) ||
      Object.keys(error).length !== 2 ||
      !hasOwn(error, 'status') ||
      !hasOwn(error, 'codes')
    ) {
      fail(`x-qianshu-contract error fields must be exact ${context}`)
    }
    if (
      !Number.isInteger(error.status) ||
      !CONTRACT_ERROR_STATUSES.has(error.status) ||
      seenStatuses.has(error.status)
    ) {
      fail(`x-qianshu-contract error status is invalid ${context}`)
    }
    seenStatuses.add(error.status)
    if (
      !Array.isArray(error.codes) ||
      error.codes.length === 0 ||
      new Set(error.codes).size !== error.codes.length ||
      error.codes.some(code =>
        typeof code !== 'string' || !CONTRACT_ERROR_CODE_PATTERN.test(code),
      )
    ) {
      fail(`x-qianshu-contract error codes are invalid ${context}`)
    }
  }
}

function baseMediaType(mediaType) {
  return mediaType.split(';', 1)[0].trim().toLowerCase()
}

function isConcreteMediaType(mediaType) {
  const normalized = baseMediaType(mediaType)
  const parts = normalized.split('/')
  return (
    parts.length === 2 &&
    parts.every(part => part.length > 0 && !part.includes('*'))
  )
}

function isJsonMediaType(mediaType) {
  const [type, subtype] = baseMediaType(mediaType).split('/')
  return (
    type === 'application' &&
    (subtype === 'json' || subtype?.endsWith('+json'))
  )
}

function isSuccessResponseStatus(status) {
  return /^2(?:\d{2}|XX)$/u.test(status)
}

function isApplicationErrorResponseStatus(status) {
  return /^[45](?:\d{2}|XX)$/u.test(status)
}

function schemaEntries(content) {
  if (!isRecord(content)) {
    return []
  }
  return Object.entries(content).sort(([left], [right]) =>
    compareStrings(left, right),
  )
}

function collectComposedPropertyNames(document, rootSchema) {
  const active = new WeakSet()
  const completed = new WeakMap()

  function collect(schema) {
    if (!isRecord(schema) || active.has(schema)) {
      return new Set()
    }
    if (completed.has(schema)) {
      return new Set(completed.get(schema))
    }

    active.add(schema)
    const propertyNames = new Set(
      isRecord(schema.properties) ? Object.keys(schema.properties) : [],
    )
    try {
      if (hasOwn(schema, '$ref')) {
        for (const propertyName of collect(
          resolveLocalReference(document, schema.$ref),
        )) {
          propertyNames.add(propertyName)
        }
      }
      if (Array.isArray(schema.allOf)) {
        for (const member of schema.allOf) {
          for (const propertyName of collect(member)) {
            propertyNames.add(propertyName)
          }
        }
      }
      completed.set(schema, new Set(propertyNames))
      return propertyNames
    } finally {
      active.delete(schema)
    }
  }

  return collect(rootSchema)
}

/**
 * 每个成功响应 schema 都创建全新的 active/completed 状态。ref back-edge 只让
 * 当前分支返回，properties/items/additionalProperties 与组合关键字的兄弟分支
 * 仍逐一执行；目标完整遍历后才进入 completed，保证 self、indirect、diamond
 * 合法复用的同时不会缓存半成品。
 */
function walkSchema(document, rootSchema, visitor) {
  const active = new WeakSet()
  const completed = new WeakSet()

  function visit(schema) {
    if (!isRecord(schema)) {
      return
    }
    if (active.has(schema) || completed.has(schema)) {
      return
    }

    active.add(schema)
    try {
      visitor(schema)
      if (hasOwn(schema, '$ref')) {
        visit(resolveLocalReference(document, schema.$ref))
      }

      if (isRecord(schema.properties)) {
        for (const propertyName of Object.keys(schema.properties).sort()) {
          visit(schema.properties[propertyName])
        }
      }
      visit(schema.items)
      visit(schema.additionalProperties)
      for (const keyword of ['allOf', 'oneOf', 'anyOf']) {
        if (Array.isArray(schema[keyword])) {
          for (const member of schema[keyword]) {
            visit(member)
          }
        }
      }
      visit(schema.not)
      completed.add(schema)
    } finally {
      active.delete(schema)
    }
  }

  visit(rootSchema)
}

function assertNoApiErrorOrEnvelope(document, rootSchema, record, status) {
  const apiErrorSchema = document.components.schemas.ApiError
  const context = operationContext(record, status)
  walkSchema(document, rootSchema, schema => {
    if (schema === apiErrorSchema) {
      fail(`JSON success must not reference ApiError ${context}`)
    }
    const effectiveProperties = collectComposedPropertyNames(
      document,
      schema,
    )
    if (['code', 'message', 'data'].every(property =>
      effectiveProperties.has(property),
    )) {
      fail(`JSON success must not use the global envelope ${context}`)
    }
  })
}

function assertJsonComponentSchema(document, schema, record, status) {
  const context = operationContext(record, status)
  if (
    !isRecord(schema) ||
    typeof schema.$ref !== 'string'
  ) {
    fail(`JSON success must use a component $ref ${context}`)
  }
  resolveDirectSchemaComponent(
    document,
    schema.$ref,
    `JSON success must use a direct component $ref ${context}`,
  )
  assertNoApiErrorOrEnvelope(document, schema, record, status)
}

function assertResponseHeader(document, response, record, status) {
  const resolvedResponse = resolveReferenceObject(document, response)
  const header = resolvedResponse.headers?.['X-Request-Id']
  if (!isRecord(header)) {
    fail(`Missing X-Request-Id response Header ${operationContext(record, status)}`)
  }
  const resolvedHeader = resolveReferenceObject(document, header)
  if (!isRecord(resolvedHeader.schema)) {
    fail(`X-Request-Id Header must have string schema ${operationContext(record, status)}`)
  }
  const resolvedSchema = resolveReferenceObject(
    document,
    resolvedHeader.schema,
  )
  if (resolvedSchema.type !== 'string') {
    fail(`X-Request-Id Header must have string schema ${operationContext(record, status)}`)
  }
  return resolvedResponse
}

function assertSuccessResponses(document, record, responses) {
  for (const status of Object.keys(responses).sort()) {
    if (!isSuccessResponseStatus(status)) {
      continue
    }
    const response = resolveReferenceObject(document, responses[status])
    const context = operationContext(record, status)
    if (status === '204') {
      if (hasOwn(response, 'content')) {
        fail(`204 response cannot declare content ${context}`)
      }
      continue
    }

    const entries = schemaEntries(response.content)
    if (entries.length === 0) {
      fail(`Successful response must declare content ${context}`)
    }
    for (const [mediaType, media] of entries) {
      if (!isConcreteMediaType(mediaType)) {
        fail(`binary or JSON response media type must be concrete ${context}`)
      }
      if (!isRecord(media) || !isRecord(media.schema)) {
        const kind = isJsonMediaType(mediaType) ? 'JSON' : 'binary'
        fail(`${kind} response must declare schema ${context}`)
      }
      if (isJsonMediaType(mediaType)) {
        assertJsonComponentSchema(document, media.schema, record, status)
      } else if (
        media.schema.type !== 'string' ||
        media.schema.format !== 'binary'
      ) {
        fail(`binary response must use string/binary schema ${context}`)
      }
    }
  }
}

function hasBadRequestShape(document, record) {
  const requestBody = record.operation.requestBody
  if (requestBody !== undefined) {
    const resolvedRequestBody = resolveReferenceObject(document, requestBody)
    if (
      schemaEntries(resolvedRequestBody.content).some(([mediaType]) =>
        isJsonMediaType(mediaType),
      )
    ) {
      return true
    }
  }

  for (const owner of [record.pathItem, record.operation]) {
    if (owner.parameters === undefined) {
      continue
    }
    if (!Array.isArray(owner.parameters)) {
      fail(`OpenAPI parameters must be an array ${operationContext(record)}`)
    }
    for (const parameter of owner.parameters) {
      const resolvedParameter = resolveReferenceObject(document, parameter)
      if (
        resolvedParameter.in === 'path' ||
        resolvedParameter.in === 'query'
      ) {
        return true
      }
    }
  }
  return false
}

function jsonMediaEntries(response) {
  return schemaEntries(response.content).filter(([mediaType]) =>
    isJsonMediaType(mediaType),
  )
}

function assertApiErrorResponse(document, record, responses, status) {
  const response = responses[status]
  const context = operationContext(record, status)
  if (!isRecord(response)) {
    fail(`Missing required response ${context}`)
  }
  const resolvedResponse = resolveReferenceObject(document, response)
  const entries = jsonMediaEntries(resolvedResponse)
  if (entries.length === 0) {
    fail(`Application error requires JSON ApiError ${context}`)
  }
  for (const [, media] of entries) {
    if (!isRecord(media) || media.schema?.$ref !== API_ERROR_REF) {
      fail(`Application JSON error must reference ApiError ${context}`)
    }
  }
}

function assertApplicationContract(document, record, metadata, responses) {
  // 必需错误矩阵只由 metadata 与可解析请求形状推导，不信任 decorator 已经
  // 生成了哪些 response；这样单独删除任一 status 时 checker 仍能独立失败。
  const requiredStatuses = new Set(['500'])
  if (hasBadRequestShape(document, record)) {
    requiredStatuses.add('400')
  }
  if (metadata.authentication || metadata.authorization) {
    requiredStatuses.add('401')
  }
  if (metadata.authorization) {
    requiredStatuses.add('403')
  }
  if (metadata.resourceLocator) {
    requiredStatuses.add('404')
  }
  if (metadata.conflict) {
    requiredStatuses.add('409')
  }
  if (metadata.validation) {
    requiredStatuses.add('422')
  }

  for (const status of [...requiredStatuses].sort()) {
    assertApiErrorResponse(document, record, responses, status)
  }
  for (const status of Object.keys(responses).sort()) {
    if (!isApplicationErrorResponseStatus(status)) {
      continue
    }
    const response = resolveReferenceObject(document, responses[status])
    for (const [, media] of jsonMediaEntries(response)) {
      if (!isRecord(media) || media.schema?.$ref !== API_ERROR_REF) {
        fail(
          `Application JSON error must reference ApiError ${operationContext(record, status)}`,
        )
      }
    }
  }
}

function assertHealthContract(document, record, responses) {
  const response = responses['503']
  const context = operationContext(record, '503')
  if (!isRecord(response)) {
    fail(`health requires dedicated 503 response ${context}`)
  }
  const resolvedResponse = resolveReferenceObject(document, response)
  const entries = jsonMediaEntries(resolvedResponse)
  if (entries.length === 0) {
    fail(`health 503 requires JSON schema ${context}`)
  }
  for (const [, media] of entries) {
    if (
      !isRecord(media) ||
      !isRecord(media.schema) ||
      typeof media.schema.$ref !== 'string'
    ) {
      fail(`health 503 requires a dedicated component schema ${context}`)
    }
    resolveDirectSchemaComponent(
      document,
      media.schema.$ref,
      `health 503 requires a direct component schema ${context}`,
    )
    walkSchema(document, media.schema, schema => {
      if (schema === document.components.schemas.ApiError) {
        fail(`health 503 must not reference ApiError ${context}`)
      }
    })
  }
}

function assertHealthRoute(document) {
  if (hasOwn(document.paths, '/health')) {
    fail('Legacy /health path is forbidden')
  }
  const rawHealthPath = document.paths['/api/health']
  if (!isRecord(rawHealthPath)) {
    fail('Missing GET /api/health')
  }
  // 与 operation 收集保持同一视图：Path Item 带 `$ref` 时只读取 resolved target，
  // 不允许 raw sibling get 掩护 target 中缺失或漂移的 health operation。
  const healthPath = resolveReferenceObject(document, rawHealthPath)
  if (!isRecord(healthPath.get)) {
    fail('Missing GET /api/health')
  }
  if (healthPath.get.operationId !== 'health_get') {
    fail('GET /api/health must use operationId health_get')
  }
}

export function assertOpenApiContract(
  document,
  { baselineDocument } = {},
) {
  if (!isRecord(document)) {
    fail('Invalid OpenAPI document')
  }
  if (document.openapi !== '3.0.3') {
    fail('OpenAPI version must be 3.0.3')
  }
  if (!isRecord(document.paths)) {
    fail('OpenAPI paths must be an object')
  }

  assertHealthRoute(document)
  assertAllLocalReferencesResolve(document)
  assertApiErrorShape(document)

  const seenOperationIds = new Map()
  for (const record of collectOperations(document)) {
    const { operation } = record
    const context = operationContext(record)
    if (
      typeof operation.operationId !== 'string' ||
      operation.operationId.trim().length === 0
    ) {
      fail(`Missing operationId ${context}`)
    }
    if (operation.operationId.startsWith(MISSING_OPERATION_ID_PREFIX)) {
      fail(`Missing operationId sentinel is forbidden ${context}`)
    }
    if (seenOperationIds.has(operation.operationId)) {
      fail(`Duplicate operationId ${context}`)
    }
    seenOperationIds.set(operation.operationId, record)

    const metadata = assertMetadata(record, operation[CONTRACT_EXTENSION])
    const isOfficialHealth =
      record.path === '/api/health' && record.method === 'get'
    if ((metadata.kind === 'health') !== isOfficialHealth) {
      fail(`health kind is reserved for GET /api/health ${context}`)
    }
    if (!isRecord(operation.responses)) {
      fail(`OpenAPI responses must be an object ${context}`)
    }

    for (const status of Object.keys(operation.responses).sort()) {
      assertResponseHeader(
        document,
        operation.responses[status],
        record,
        status,
      )
    }
    assertSuccessResponses(document, record, operation.responses)
    if (metadata.kind === 'health') {
      assertHealthContract(document, record, operation.responses)
    } else {
      assertApplicationContract(
        document,
        record,
        metadata,
        operation.responses,
      )
    }
  }

  if (baselineDocument !== undefined) {
    assertOperationIdBaseline(document, baselineDocument)
  }
}

export function applyContractFailureToProcess(
  error,
  processRef = process,
  consoleRef = console,
) {
  processRef.exitCode = getTrustedCommandExitCode(error) ?? 1

  // CLI 边界永远不把异常对象交给 reporter，避免 cause、快照或连接信息泄露。
  consoleRef.error('OpenAPI contract check failed')
}
