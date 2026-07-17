import assert from 'node:assert/strict'
import test from 'node:test'

import { createValidContractFixture } from './fixtures/openapi-contract-fixture.mjs'
import {
  ContractValidationError,
  applyContractFailureToProcess,
  assertOpenApiContract,
  assertOperationIdBaseline,
  assertSnapshotBytesEqual,
  collectOperationIds,
  collectOperations,
  parseOpenApiSnapshot,
  serializeOpenApiSnapshot,
  sha256,
} from './openapi-contract.mjs'
import { CommandExecutionError } from './run-command.mjs'

const DOCUMENT_CANARY = 'do-not-log-openapi-document-body'
const API_ERROR_REF = '#/components/schemas/ApiError'
const ENVELOPE_REF = '#/components/schemas/ForbiddenEnvelope'
const WIDGET_PATH = '/api/widgets/{widgetId}'

function cloneDocument(document = createValidContractFixture()) {
  return structuredClone(document)
}

function operation(document, path, method) {
  return document.paths[path][method]
}

function apiError(document) {
  return document.components.schemas.ApiError
}

function createSuccess(document) {
  return operation(document, '/api/widgets', 'post').responses['201']
}

function updateSuccessSchema(document) {
  return operation(document, WIDGET_PATH, 'put').responses['200']
    .content['application/json'].schema
}

function expectContractError(callback, pattern) {
  assert.throws(callback, error => {
    assert.ok(error instanceof ContractValidationError)
    assert.match(error.message, pattern)
    assert.equal(error.message.includes(DOCUMENT_CANARY), false)
    return true
  })
}

function mutationTest(name, mutate, pattern) {
  test(name, () => {
    const document = cloneDocument()
    mutate(document)
    expectContractError(() => assertOpenApiContract(document), pattern)
  })
}

test('快照基础 API 使用稳定字节、hash 与安全解析行为', () => {
  const document = createValidContractFixture()
  const serialized = serializeOpenApiSnapshot(document)

  assert.equal(serialized, `${JSON.stringify(document, null, 2)}\n`)
  assert.deepEqual(
    parseOpenApiSnapshot(Buffer.from(serialized), 'fixture snapshot'),
    document,
  )
  assert.equal(
    sha256('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  )
  assert.doesNotThrow(() =>
    assertSnapshotBytesEqual({
      actual: Buffer.from(serialized),
      expected: serialized,
      actualLabel: 'generated',
      expectedLabel: 'committed',
    }),
  )
})

test('parseOpenApiSnapshot 拒绝无效 JSON 且不回显内容', () => {
  const contents = `{${DOCUMENT_CANARY}`
  expectContractError(
    () => parseOpenApiSnapshot(contents, 'fixture snapshot'),
    /fixture snapshot/,
  )
})

test('parseOpenApiSnapshot 拒绝非对象根节点', () => {
  expectContractError(
    () => parseOpenApiSnapshot('[]', 'array snapshot'),
    /array snapshot/,
  )
})

test('serializeOpenApiSnapshot 包装循环对象错误且不泄露内容', () => {
  const document = { secret: DOCUMENT_CANARY }
  document.self = document
  expectContractError(
    () => serializeOpenApiSnapshot(document),
    /serialize OpenAPI snapshot/i,
  )
})

test('assertSnapshotBytesEqual 精确比较换行且只报告 label', () => {
  expectContractError(
    () =>
      assertSnapshotBytesEqual({
        actual: `{\"secret\":\"${DOCUMENT_CANARY}\"}\n`,
        expected: '{}\n',
        actualLabel: 'generated snapshot',
        expectedLabel: 'committed snapshot',
      }),
    /generated snapshot.*committed snapshot/,
  )
})

test('collectOperations 与 collectOperationIds 不受对象插入顺序影响', () => {
  const document = createValidContractFixture()
  const expectedOperations = [
    ['/api/health', 'get'],
    ['/api/reports', 'get'],
    ['/api/widgets', 'post'],
    [WIDGET_PATH, 'delete'],
    [WIDGET_PATH, 'put'],
  ]
  const expectedIds = [
    'health_get',
    'report_download',
    'widget_create',
    'widget_delete',
    'widget_update',
  ]

  assert.deepEqual(
    collectOperations(document).map(({ path, method }) => [path, method]),
    expectedOperations,
  )
  assert.deepEqual(collectOperationIds(document), expectedIds)

  document.paths = Object.fromEntries(
    Object.entries(document.paths).reverse(),
  )
  assert.deepEqual(
    collectOperations(document).map(({ path, method }) => [path, method]),
    expectedOperations,
  )
  assert.deepEqual(collectOperationIds(document), expectedIds)
})

function documentUsingExtensionPathItem(path, extensionName) {
  const document = createValidContractFixture()
  document['x-path-items'] = {
    [extensionName]: document.paths[path],
  }
  document.paths[path] = {
    $ref: `#/x-path-items/${extensionName}`,
  }
  return document
}

test('collectOperations 解析 extension Path Item ref 并保留 resolved pathItem', () => {
  const document = documentUsingExtensionPathItem(
    '/api/reports',
    'ReferencedReports',
  )
  const referencedPathItem = document['x-path-items'].ReferencedReports
  const record = collectOperations(document).find(
    candidate => candidate.path === '/api/reports',
  )

  assert.equal(record?.pathItem, referencedPathItem)
  assert.equal(record?.operation, referencedPathItem.get)
  assert.doesNotThrow(() => assertOpenApiContract(document))
})

test('纯 ref 的 /api/health 使用 resolved health Path Item 校验', () => {
  const document = documentUsingExtensionPathItem(
    '/api/health',
    'ReferencedHealth',
  )

  assert.doesNotThrow(() => assertOpenApiContract(document))
})

test('health ref wrapper sibling 不得掩护 resolved operationId 漂移', () => {
  const document = createValidContractFixture()
  const rawHealthOperation = document.paths['/api/health'].get
  const referencedHealthPathItem = cloneDocument(
    document.paths['/api/health'],
  )
  referencedHealthPathItem.get.operationId = 'health_ref_bypass'
  document['x-path-items'] = {
    ReferencedHealthBypass: referencedHealthPathItem,
  }
  document.paths['/api/health'] = {
    $ref: '#/x-path-items/ReferencedHealthBypass',
    get: rawHealthOperation,
  }

  expectContractError(
    () => assertOpenApiContract(document),
    /health_get/,
  )
})

test('Path Item ref 到 extension 后仍检查 operation metadata', () => {
  const document = documentUsingExtensionPathItem(
    '/api/reports',
    'MissingMetadata',
  )
  delete document['x-path-items'].MissingMetadata.get[
    'x-qianshu-contract'
  ]

  expectContractError(
    () => assertOpenApiContract(document),
    /x-qianshu-contract/,
  )
})

test('Path Item ref 到 extension 后仍检查 X-Request-Id Header', () => {
  const document = documentUsingExtensionPathItem(
    '/api/reports',
    'MissingRequestId',
  )
  delete document['x-path-items'].MissingRequestId.get.responses['200']
    .headers['X-Request-Id']

  expectContractError(
    () => assertOpenApiContract(document),
    /X-Request-Id/,
  )
})

test('referenced Path Item 的 path parameter 仍要求 400', () => {
  const document = documentUsingExtensionPathItem(
    WIDGET_PATH,
    'WidgetPathParameters',
  )
  delete document['x-path-items'].WidgetPathParameters.delete.responses['400']

  expectContractError(
    () => assertOpenApiContract(document),
    /400/,
  )
})

test('referenced Path Item operation 的 query parameter 仍要求 400', () => {
  const document = documentUsingExtensionPathItem(
    '/api/reports',
    'ReportQueryParameters',
  )
  delete document['x-path-items'].ReportQueryParameters.get.responses['400']

  expectContractError(
    () => assertOpenApiContract(document),
    /400/,
  )
})

test('拒绝 circular Path Item refs', () => {
  const document = createValidContractFixture()
  document['x-path-items'] = {
    First: { $ref: '#/x-path-items/Second' },
    Second: { $ref: '#/x-path-items/First' },
  }
  document.paths['/api/reports'] = {
    $ref: '#/x-path-items/First',
  }

  expectContractError(
    () => assertOpenApiContract(document),
    /Circular non-schema local \$ref/,
  )
})

test('operationId baseline 允许新增 operationId', () => {
  const baselineDocument = createValidContractFixture()
  const currentDocument = cloneDocument(baselineDocument)
  currentDocument.paths['/api/version'] = {
    get: {
      operationId: 'version_get',
      'x-qianshu-contract': {
        kind: 'application',
        authentication: false,
        authorization: false,
        resourceLocator: false,
        conflict: false,
        validation: false,
      },
      responses: {
        200: {
          description: '',
          headers: {
            'X-Request-Id': { schema: { type: 'string' } },
          },
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/WidgetCreateResponse',
              },
            },
          },
        },
        500: cloneDocument(
          operation(currentDocument, '/api/widgets', 'post').responses['500'],
        ),
      },
    },
  }

  assert.doesNotThrow(() =>
    assertOperationIdBaseline(currentDocument, baselineDocument),
  )
  assert.doesNotThrow(() =>
    assertOpenApiContract(currentDocument, { baselineDocument }),
  )
})

test('operationId baseline 拒绝删除', () => {
  const baselineDocument = createValidContractFixture()
  const currentDocument = cloneDocument(baselineDocument)
  delete currentDocument.paths['/api/reports']
  expectContractError(
    () => assertOperationIdBaseline(currentDocument, baselineDocument),
    /report_download/,
  )
})

test('operationId baseline 拒绝改名', () => {
  const baselineDocument = createValidContractFixture()
  const currentDocument = cloneDocument(baselineDocument)
  operation(currentDocument, '/api/reports', 'get').operationId =
    'report_fetch'
  expectContractError(
    () => assertOpenApiContract(currentDocument, { baselineDocument }),
    /report_download/,
  )
})

test('applyContractFailureToProcess 固定输出且未知错误归一为 1', () => {
  const processRef = { exitCode: undefined }
  const calls = []
  const consoleRef = {
    error(message) {
      assert.equal(typeof message, 'string')
      calls.push(message)
    },
  }

  applyContractFailureToProcess(
    new Error(`postgresql://user:${DOCUMENT_CANARY}@localhost/private`),
    processRef,
    consoleRef,
  )

  assert.equal(processRef.exitCode, 1)
  assert.deepEqual(calls, ['OpenAPI contract check failed'])
  assert.equal(calls.includes(DOCUMENT_CANARY), false)
})

test('applyContractFailureToProcess 保留 CommandExecutionError 非零失败码', () => {
  const processRef = { exitCode: undefined }
  const calls = []
  applyContractFailureToProcess(
    new CommandExecutionError(`Command failed: ${DOCUMENT_CANARY}`, 9),
    processRef,
    { error: message => calls.push(message) },
  )
  assert.equal(processRef.exitCode, 9)
  assert.deepEqual(calls, ['OpenAPI contract check failed'])
})

test('applyContractFailureToProcess 拒绝真实 Error 通过替换 prototype 伪造退出码', async (t) => {
  const forgedPositiveError = Object.assign(
    new Error(`forged-positive-${DOCUMENT_CANARY}`),
    { exitCode: 9 },
  )
  Object.setPrototypeOf(forgedPositiveError, CommandExecutionError.prototype)
  const forgedOutOfRangeError = Object.assign(
    new Error(`forged-256-${DOCUMENT_CANARY}`),
    { exitCode: 256 },
  )
  Object.setPrototypeOf(
    forgedOutOfRangeError,
    CommandExecutionError.prototype,
  )
  let throwingExitCodeReadCount = 0
  const throwingExitCodeError = new Error(`forged-getter-${DOCUMENT_CANARY}`)
  Object.defineProperty(throwingExitCodeError, 'exitCode', {
    get() {
      throwingExitCodeReadCount += 1
      throw new Error('exitCode getter must not run')
    },
  })
  Object.setPrototypeOf(throwingExitCodeError, CommandExecutionError.prototype)

  for (const fixtureCase of [
    { error: forgedPositiveError, label: 'positive exitCode' },
    { error: forgedOutOfRangeError, label: '256 exitCode' },
    {
      error: throwingExitCodeError,
      label: 'throwing exitCode getter',
      readCount: () => throwingExitCodeReadCount,
    },
  ]) {
    await t.test(fixtureCase.label, () => {
      const processRef = { exitCode: undefined }
      const calls = []

      assert.doesNotThrow(() => {
        applyContractFailureToProcess(
          fixtureCase.error,
          processRef,
          { error: message => calls.push(message) },
        )
      })
      assert.equal(processRef.exitCode, 1)
      assert.equal(fixtureCase.readCount?.() ?? 0, 0)
      assert.deepEqual(calls, ['OpenAPI contract check failed'])
      assert.equal(calls.some(message => message.includes(DOCUMENT_CANARY)), false)
    })
  }
})

test('完整 fixture 通过契约校验并解析所有 escaped/local refs', () => {
  assert.doesNotThrow(() =>
    assertOpenApiContract(createValidContractFixture()),
  )
})

mutationTest(
  '拒绝非 OpenAPI 3.0.3',
  document => {
    document.openapi = '3.1.0'
  },
  /3\.0\.3/,
)
mutationTest(
  '拒绝缺失 /api/health',
  document => {
    delete document.paths['/api/health']
  },
  /\/api\/health/,
)
mutationTest(
  '拒绝遗留 /health 路由',
  document => {
    document.paths['/health'] = {}
  },
  /\/health/,
)
mutationTest(
  '拒绝 health operationId 漂移',
  document => {
    operation(document, '/api/health', 'get').operationId = 'health_status'
  },
  /health_get/,
)
mutationTest(
  '拒绝重复 operationId',
  document => {
    operation(document, '/api/reports', 'get').operationId = 'widget_delete'
  },
  /Duplicate operationId/,
)
mutationTest(
  'Path Item alias ref 不得隐藏重复 operationId',
  document => {
    document.paths['/api/reports-alias'] = {
      $ref: '#/paths/~1api~1reports',
    }
  },
  /Duplicate operationId/,
)
mutationTest(
  '拒绝缺失 operationId',
  document => {
    delete operation(document, '/api/reports', 'get').operationId
  },
  /operationId/,
)
mutationTest(
  '拒绝 sentinel operationId',
  document => {
    operation(document, '/api/reports', 'get').operationId =
      '__missing_operation_id__ReportController_get'
  },
  /sentinel|missing operationId/i,
)
mutationTest(
  '拒绝响应缺失 X-Request-Id',
  document => {
    delete createSuccess(document).headers['X-Request-Id']
  },
  /X-Request-Id/,
)
mutationTest(
  '拒绝 X-Request-Id 非 string Header',
  document => {
    createSuccess(document).headers['X-Request-Id'].schema.type = 'number'
  },
  /X-Request-Id/,
)
mutationTest(
  '解析 component response 后仍检查 X-Request-Id',
  document => {
    delete document.components.responses['Health~Success/Response']
      .headers['X-Request-Id']
  },
  /X-Request-Id/,
)

mutationTest(
  'ApiError 必须是 object',
  document => {
    apiError(document).type = 'array'
  },
  /ApiError.*type/,
)
mutationTest(
  'ApiError properties 不得缺失字段',
  document => {
    delete apiError(document).properties.requestId
  },
  /ApiError.*properties/,
)
mutationTest(
  'ApiError properties 不得增加字段',
  document => {
    apiError(document).properties.status = { type: 'number' }
  },
  /ApiError.*properties/,
)
mutationTest(
  'ApiError required 不得缺失字段',
  document => {
    apiError(document).required.pop()
  },
  /ApiError.*required/,
)
mutationTest(
  'ApiError fieldErrors 必须保持 optional',
  document => {
    apiError(document).required.push('fieldErrors')
  },
  /ApiError.*required/,
)

for (const [label, mutate] of [
  ['code string', document => {
    apiError(document).properties.code.type = 'number'
  }],
  ['message string', document => {
    apiError(document).properties.message.type = 'number'
  }],
  ['requestId string', document => {
    apiError(document).properties.requestId.type = 'number'
  }],
  ['fieldErrors object', document => {
    apiError(document).properties.fieldErrors.type = 'array'
  }],
  ['fieldErrors values array', document => {
    apiError(document).properties.fieldErrors.additionalProperties.type =
      'object'
  }],
  ['fieldErrors items string', document => {
    apiError(document).properties.fieldErrors.additionalProperties.items.type =
      'number'
  }],
]) {
  mutationTest(
    `ApiError 拒绝错误的 ${label} 形状`,
    mutate,
    /ApiError/,
  )
}

for (const [keyword, value] of [
  ['$ref', API_ERROR_REF],
  ['allOf', []],
  ['oneOf', []],
  ['anyOf', []],
  ['not', {}],
  ['items', {}],
]) {
  mutationTest(
    `ApiError 顶层拒绝 ${keyword}`,
    document => {
      apiError(document)[keyword] = value
    },
    new RegExp(keyword.replace('$', '\\$')),
  )
}

for (const [label, select] of [
  ['top', apiError],
  ['code', document => apiError(document).properties.code],
  ['message', document => apiError(document).properties.message],
  ['requestId', document => apiError(document).properties.requestId],
  ['fieldErrors', document => apiError(document).properties.fieldErrors],
  [
    'fieldErrors.additionalProperties',
    document => apiError(document).properties.fieldErrors.additionalProperties,
  ],
  [
    'fieldErrors.additionalProperties.items',
    document =>
      apiError(document).properties.fieldErrors.additionalProperties.items,
  ],
]) {
  mutationTest(
    `ApiError ${label} 拒绝 nullable true`,
    document => {
      select(document).nullable = true
    },
    /ApiError.*nullable/,
  )
}

mutationTest(
  '拒绝缺失 x-qianshu-contract',
  document => {
    delete operation(document, '/api/reports', 'get')[
      'x-qianshu-contract'
    ]
  },
  /x-qianshu-contract/,
)
mutationTest(
  'metadata 必须包含 kind',
  document => {
    delete operation(document, '/api/reports', 'get')[
      'x-qianshu-contract'
    ].kind
  },
  /kind/,
)
mutationTest(
  'metadata kind 只能是 health 或 application',
  document => {
    operation(document, '/api/reports', 'get')[
      'x-qianshu-contract'
    ].kind = 'internal'
  },
  /kind/,
)

test('application metadata 接受认证接口所需的可选契约字段', () => {
  const document = cloneDocument()
  const metadata = operation(document, '/api/widgets', 'post')[
    'x-qianshu-contract'
  ]
  Object.assign(metadata, {
    session: 'none',
    csrf: true,
    privateNoStore: true,
    errors: [
      {
        status: 409,
        codes: ['AUTH_STATE_CHANGED'],
      },
    ],
  })

  assert.doesNotThrow(() => assertOpenApiContract(document))
})

for (const field of [
  'authentication',
  'authorization',
  'resourceLocator',
  'conflict',
  'validation',
]) {
  mutationTest(
    `metadata 必须包含 boolean ${field}`,
    document => {
      delete operation(document, '/api/reports', 'get')[
        'x-qianshu-contract'
      ][field]
    },
    new RegExp(field),
  )
  mutationTest(
    `metadata ${field} 必须是 boolean`,
    document => {
      operation(document, '/api/reports', 'get')[
        'x-qianshu-contract'
      ][field] = 'false'
    },
    new RegExp(field),
  )
}

mutationTest(
  'authorization true 必须依赖 authentication true',
  document => {
    operation(document, WIDGET_PATH, 'put')[
      'x-qianshu-contract'
    ].authentication = false
  },
  /authorization.*authentication/,
)
mutationTest(
  'health metadata 的五个 boolean 必须为 false',
  document => {
    operation(document, '/api/health', 'get')[
      'x-qianshu-contract'
    ].validation = true
  },
  /health.*validation/,
)

for (const [label, path, method, status] of [
  ['application 固定错误', '/api/reports', 'get', '500'],
  ['JSON requestBody', '/api/widgets', 'post', '400'],
  ['path parameter', WIDGET_PATH, 'delete', '400'],
  ['query parameter', '/api/reports', 'get', '400'],
  ['authentication', WIDGET_PATH, 'put', '401'],
  ['authorization', WIDGET_PATH, 'put', '403'],
  ['resourceLocator', WIDGET_PATH, 'put', '404'],
  ['conflict', WIDGET_PATH, 'put', '409'],
  ['validation', WIDGET_PATH, 'put', '422'],
]) {
  mutationTest(
    `${label} 要求 ${status} response`,
    document => {
      delete operation(document, path, method).responses[status]
    },
    new RegExp(status),
  )
}

for (const [label, path, method, status] of [
  ['widget create', '/api/widgets', 'post', '400'],
  ['widget create', '/api/widgets', 'post', '500'],
  ['widget update', WIDGET_PATH, 'put', '400'],
  ['widget update', WIDGET_PATH, 'put', '401'],
  ['widget update', WIDGET_PATH, 'put', '403'],
  ['widget update', WIDGET_PATH, 'put', '404'],
  ['widget update', WIDGET_PATH, 'put', '409'],
  ['widget update', WIDGET_PATH, 'put', '418'],
  ['widget update', WIDGET_PATH, 'put', '422'],
  ['widget update', WIDGET_PATH, 'put', '500'],
  ['widget delete', WIDGET_PATH, 'delete', '400'],
  ['widget delete', WIDGET_PATH, 'delete', '500'],
  ['report download', '/api/reports', 'get', '400'],
  ['report download', '/api/reports', 'get', '500'],
]) {
  mutationTest(
    `${label} JSON ${status} 必须直接引用 ApiError`,
    document => {
      const response = status === '418'
        ? document.components.responses.TeapotErrorResponse
        : operation(document, path, method).responses[status]
      const mediaType = status === '418'
        ? 'application/problem+json'
        : 'application/json'
      response.content[mediaType].schema.$ref =
        '#/components/schemas/WidgetCreateResponse'
    },
    new RegExp(`${status}.*ApiError|ApiError.*${status}`),
  )
}

mutationTest(
  'application error 不接受间接 ApiError alias',
  document => {
    operation(document, WIDGET_PATH, 'put').responses['500']
      .content['application/json'].schema.$ref =
      '#/components/schemas/ApiErrorAlias'
  },
  /500.*ApiError|ApiError.*500/,
)
mutationTest(
  '必要 application error 必须有 JSON content',
  document => {
    delete operation(document, WIDGET_PATH, 'put').responses['500'].content
  },
  /500.*JSON|JSON.*500/,
)
mutationTest(
  '必要 application error 必须有 schema',
  document => {
    delete operation(document, WIDGET_PATH, 'put').responses['500']
      .content['application/json'].schema
  },
  /500.*ApiError|ApiError.*500/,
)

mutationTest(
  'health 必须声明专属 503',
  document => {
    delete operation(document, '/api/health', 'get').responses['503']
  },
  /503/,
)
mutationTest(
  'health 503 不得直接引用 ApiError',
  document => {
    operation(document, '/api/health', 'get').responses['503']
      .content['application/json'].schema.$ref = API_ERROR_REF
  },
  /503.*ApiError|ApiError.*503/,
)
mutationTest(
  'health 503 不得间接引用 ApiError',
  document => {
    operation(document, '/api/health', 'get').responses['503']
      .content['application/json'].schema.$ref =
      '#/components/schemas/ApiErrorAlias'
  },
  /503.*ApiError|ApiError.*503/,
)
mutationTest(
  'health 503 拒绝 ApiError descendant schema ref',
  document => {
    operation(document, '/api/health', 'get').responses['503']
      .content['application/json'].schema.$ref =
      '#/components/schemas/ApiError/properties/code'
  },
  /503.*component|component.*503/,
)

mutationTest(
  'JSON 2xx 必须声明 content',
  document => {
    delete createSuccess(document).content
  },
  /201.*content|content.*201/,
)
mutationTest(
  'JSON 2xx 必须声明具体 JSON media type',
  document => {
    createSuccess(document).content = {
      'application/*': {
        schema: {
          $ref: '#/components/schemas/WidgetCreateResponse',
        },
      },
    }
  },
  /201.*media|media.*201/,
)
mutationTest(
  'JSON 2xx 不得缺失 media entry',
  document => {
    delete createSuccess(document).content['application/json']
  },
  /201.*content|content.*201/,
)
mutationTest(
  'JSON 2xx media 必须有 schema',
  document => {
    delete createSuccess(document).content['application/json'].schema
  },
  /201.*schema|schema.*201/,
)
mutationTest(
  'JSON 2xx 禁止 inline schema',
  document => {
    createSuccess(document).content['application/json'].schema = {
      type: 'object',
    }
  },
  /201.*component|component.*201/,
)
mutationTest(
  'JSON 2xx 禁止引用 ApiError',
  document => {
    createSuccess(document).content['application/json'].schema.$ref =
      API_ERROR_REF
  },
  /201.*ApiError|ApiError.*201/,
)
mutationTest(
  'JSON 2xx 禁止引用 ApiError alias',
  document => {
    createSuccess(document).content['application/json'].schema.$ref =
      '#/components/schemas/ApiErrorAlias'
  },
  /201.*ApiError|ApiError.*201/,
)
mutationTest(
  'JSON 2xx 拒绝 component descendant schema ref',
  document => {
    createSuccess(document).content['application/json'].schema.$ref =
      '#/components/schemas/WidgetCreateResponse/properties/id'
  },
  /201.*component|component.*201/,
)

test('JSON 2xx 接受具体 application +json media type', () => {
  const document = createValidContractFixture()
  createSuccess(document).content = {
    'application/vnd.qianshu.widget+json': {
      schema: {
        $ref: '#/components/schemas/WidgetCreateResponse',
      },
    },
  }
  assert.doesNotThrow(() => assertOpenApiContract(document))
})

test('uppercase 2XX response range 缺 content 时拒绝', () => {
  const document = createValidContractFixture()
  const responses = operation(document, '/api/widgets', 'post').responses
  const rangedResponse = cloneDocument(responses['201'])
  delete rangedResponse.content
  responses['2XX'] = rangedResponse
  delete responses['201']

  expectContractError(
    () => assertOpenApiContract(document),
    /2XX.*content|content.*2XX/,
  )
})

test('uppercase 2XX response range 拒绝全局 envelope', () => {
  const document = createValidContractFixture()
  const responses = operation(document, '/api/widgets', 'post').responses
  const rangedResponse = cloneDocument(responses['201'])
  rangedResponse.content['application/json'].schema.$ref = ENVELOPE_REF
  responses['2XX'] = rangedResponse
  delete responses['201']

  expectContractError(
    () => assertOpenApiContract(document),
    /envelope/,
  )
})

test('uppercase 2XX response range 接受 direct component', () => {
  const document = createValidContractFixture()
  const responses = operation(document, '/api/widgets', 'post').responses
  responses['2XX'] = responses['201']
  delete responses['201']

  assert.doesNotThrow(() => assertOpenApiContract(document))
})

for (const range of ['4XX', '5XX']) {
  test(`application ${range} response range 的 JSON 必须引用 ApiError`, () => {
    const document = createValidContractFixture()
    const responses = operation(document, '/api/reports', 'get').responses
    const rangedResponse = cloneDocument(responses[range[0] === '4' ? '400' : '500'])
    rangedResponse.content['application/json'].schema.$ref =
      '#/components/schemas/WidgetCreateResponse'
    responses[range] = rangedResponse

    expectContractError(
      () => assertOpenApiContract(document),
      new RegExp(`${range}.*ApiError|ApiError.*${range}`),
    )
  })

  test(`application ${range} response range 接受 JSON ApiError`, () => {
    const document = createValidContractFixture()
    const responses = operation(document, '/api/reports', 'get').responses
    responses[range] = cloneDocument(
      responses[range[0] === '4' ? '400' : '500'],
    )

    assert.doesNotThrow(() => assertOpenApiContract(document))
  })
}

for (const [keyword, mutate] of [
  ['$ref', document => {
    updateSuccessSchema(document).$ref = ENVELOPE_REF
  }],
  ['properties', document => {
    document.components.schemas['Widget~Response/V1'].properties.hidden = {
      $ref: ENVELOPE_REF,
    }
  }],
  ['items', document => {
    document.components.schemas['Widget~Response/V1'].items = {
      $ref: ENVELOPE_REF,
    }
  }],
  ['additionalProperties', document => {
    document.components.schemas['Widget~Response/V1'].additionalProperties = {
      $ref: ENVELOPE_REF,
    }
  }],
  ['allOf', document => {
    document.components.schemas['Widget~Response/V1'].allOf = [
      { $ref: ENVELOPE_REF },
    ]
  }],
  ['oneOf', document => {
    document.components.schemas['Widget~Response/V1'].oneOf = [
      { $ref: ENVELOPE_REF },
    ]
  }],
  ['anyOf', document => {
    document.components.schemas['Widget~Response/V1'].anyOf = [
      { $ref: ENVELOPE_REF },
    ]
  }],
  ['not', document => {
    document.components.schemas['Widget~Response/V1'].not = {
      $ref: ENVELOPE_REF,
    }
  }],
]) {
  mutationTest(
    `JSON 2xx 递归遍历 ${keyword} 拒绝全局 envelope`,
    mutate,
    /envelope/,
  )
}

mutationTest(
  'JSON 2xx 拒绝由多个 allOf 分支拼出的全局 envelope',
  document => {
    document.components.schemas['Widget~Response/V1'].allOf = [
      { type: 'object', properties: { code: { type: 'string' } } },
      { type: 'object', properties: { message: { type: 'string' } } },
      { type: 'object', properties: { data: { type: 'object' } } },
    ]
  },
  /envelope/,
)

mutationTest(
  '204 不得声明 content property',
  document => {
    operation(document, WIDGET_PATH, 'delete').responses['204'].content = {}
  },
  /204.*content|content.*204/,
)

mutationTest(
  'binary 2xx 必须声明 content',
  document => {
    delete operation(document, '/api/reports', 'get').responses['200'].content
  },
  /200.*content|content.*200/,
)
mutationTest(
  'binary media type 必须具体且非 JSON',
  document => {
    const response = operation(document, '/api/reports', 'get').responses['200']
    response.content = {
      'application/*': response.content['application/pdf'],
    }
  },
  /binary.*media|media.*binary/,
)
mutationTest(
  'binary 2xx 不得缺失 media entry',
  document => {
    delete operation(document, '/api/reports', 'get').responses['200']
      .content['application/pdf']
  },
  /200.*content|content.*200/,
)
mutationTest(
  'binary media type 不得伪装为 JSON',
  document => {
    const response = operation(document, '/api/reports', 'get').responses['200']
    response.content = {
      'application/json': response.content['application/pdf'],
    }
  },
  /JSON|component/,
)
mutationTest(
  'binary media 必须有 schema',
  document => {
    delete operation(document, '/api/reports', 'get').responses['200']
      .content['application/pdf'].schema
  },
  /binary.*schema|schema.*200/,
)
mutationTest(
  'binary schema type 必须是 string',
  document => {
    operation(document, '/api/reports', 'get').responses['200']
      .content['application/pdf'].schema.type = 'number'
  },
  /binary/,
)
mutationTest(
  'binary schema format 必须是 binary',
  document => {
    operation(document, '/api/reports', 'get').responses['200']
      .content['application/pdf'].schema.format = 'byte'
  },
  /binary/,
)

for (const [label, mutate] of [
  ['response', document => {
    operation(document, '/api/health', 'get').responses['200'].$ref =
      '#/components/responses/Missing'
  }],
  ['requestBody', document => {
    operation(document, '/api/widgets', 'post').requestBody.$ref =
      '#/components/requestBodies/Missing'
  }],
  ['path parameter', document => {
    document.paths[WIDGET_PATH].parameters[0].$ref =
      '#/components/parameters/Missing'
  }],
  ['operation parameter', document => {
    operation(document, '/api/reports', 'get').parameters[0].$ref =
      '#/components/parameters/Missing'
  }],
  ['nested schema', document => {
    document.components.schemas.WidgetCreateResponse.properties.id.$ref =
      '#/components/schemas/Missing'
  }],
  ['invalid JSON Pointer escape', document => {
    updateSuccessSchema(document).$ref =
      '#/components/schemas/Widget~2Response'
  }],
  ['remote ref', document => {
    updateSuccessSchema(document).$ref =
      'https://example.invalid/openapi.json#/Widget'
  }],
]) {
  mutationTest(
    `拒绝 unresolved ${label} ref`,
    mutate,
    /Unresolved|local \$ref|JSON Pointer/,
  )
}

function documentUsingGraph(schemaRef) {
  const document = createValidContractFixture()
  updateSuccessSchema(document).$ref = schemaRef
  return document
}

for (const [label, schemaRef, addEnvelope] of [
  [
    'self-recursive',
    '#/components/schemas/SelfRecursive',
    document => {
      document.components.schemas.SelfRecursive.properties.envelope = {
        $ref: ENVELOPE_REF,
      }
    },
  ],
  [
    'indirect-recursive',
    '#/components/schemas/IndirectRecursiveA',
    document => {
      document.components.schemas.IndirectRecursiveA.allOf.push({
        $ref: ENVELOPE_REF,
      })
    },
  ],
  [
    'diamond',
    '#/components/schemas/DiamondRoot',
    document => {
      document.components.schemas.DiamondShared.properties.envelope = {
        $ref: ENVELOPE_REF,
      }
    },
  ],
]) {
  test(`${label} schema 合法通过`, () => {
    assert.doesNotThrow(() =>
      assertOpenApiContract(documentUsingGraph(schemaRef)),
    )
  })

  test(`${label} schema 不得跳过 operation response matrix`, () => {
    const document = documentUsingGraph(schemaRef)
    delete operation(document, WIDGET_PATH, 'put').responses['500']
    expectContractError(
      () => assertOpenApiContract(document),
      /500/,
    )
  })

  test(`${label} schema 不得跳过 envelope 递归`, () => {
    const document = documentUsingGraph(schemaRef)
    addEnvelope(document)
    expectContractError(
      () => assertOpenApiContract(document),
      /envelope/,
    )
  })
}

test('indirect cycle 的 back-edge 不吞掉同层 unresolved sibling', () => {
  const document = documentUsingGraph(
    '#/components/schemas/IndirectRecursiveA',
  )
  document.components.schemas.IndirectRecursiveA.allOf.push({
    $ref: '#/components/schemas/MissingSibling',
  })
  expectContractError(
    () => assertOpenApiContract(document),
    /Unresolved/,
  )
})
