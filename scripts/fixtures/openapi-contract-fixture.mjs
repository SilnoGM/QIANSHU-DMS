const API_ERROR_REF = '#/components/schemas/ApiError'

function requestIdHeader() {
  return {
    'X-Request-Id': {
      schema: { type: 'string' },
    },
  }
}

function jsonResponse(schemaRef, mediaType = 'application/json') {
  return {
    description: '',
    headers: requestIdHeader(),
    content: {
      [mediaType]: {
        schema: { $ref: schemaRef },
      },
    },
  }
}

function apiErrorResponse(mediaType = 'application/json') {
  return jsonResponse(API_ERROR_REF, mediaType)
}

function noContentResponse() {
  return {
    description: '',
    headers: requestIdHeader(),
  }
}

function binaryResponse() {
  return {
    description: '',
    headers: requestIdHeader(),
    content: {
      'application/pdf': {
        schema: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  }
}

function contractMetadata(kind, overrides = {}) {
  return {
    kind,
    authentication: false,
    authorization: false,
    resourceLocator: false,
    conflict: false,
    validation: false,
    ...overrides,
  }
}

/**
 * 构造一份完全有效、可独立变异的 OpenAPI 基线。
 *
 * fixture 故意同时使用 schema、parameter、requestBody 与 response 的本地
 * `$ref`，并在 component 名中包含 `~` 和 `/`，让基线本身即可覆盖 JSON
 * Pointer 的 `~0`/`~1` 解码。递归与 diamond components 默认不参与成功响应，
 * 测试可用一次 `$ref` 替换将其接入任一操作。
 */
export function createValidContractFixture() {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Qianshu DMS API fixture',
      version: '1.0.0',
      description: 'do-not-log-openapi-document-body',
    },
    paths: {
      '/api/health': {
        get: {
          operationId: 'health_get',
          'x-qianshu-contract': contractMetadata('health'),
          responses: {
            200: {
              $ref: '#/components/responses/Health~0Success~1Response',
            },
            503: jsonResponse(
              '#/components/schemas/HealthFailureResponse',
            ),
          },
        },
      },
      '/api/widgets': {
        post: {
          operationId: 'widget_create',
          'x-qianshu-contract': contractMetadata('application'),
          requestBody: {
            $ref: '#/components/requestBodies/WidgetCreateRequest',
          },
          responses: {
            201: jsonResponse(
              '#/components/schemas/WidgetCreateResponse',
            ),
            400: apiErrorResponse(),
            500: apiErrorResponse(),
          },
        },
      },
      '/api/widgets/{widgetId}': {
        parameters: [
          {
            $ref: '#/components/parameters/Widget~0Id~1Path',
          },
        ],
        put: {
          operationId: 'widget_update',
          'x-qianshu-contract': contractMetadata('application', {
            authentication: true,
            authorization: true,
            resourceLocator: true,
            conflict: true,
            validation: true,
          }),
          responses: {
            200: jsonResponse(
              '#/components/schemas/Widget~0Response~1V1',
            ),
            400: apiErrorResponse(),
            401: apiErrorResponse(),
            403: apiErrorResponse(),
            404: apiErrorResponse(),
            409: apiErrorResponse(),
            418: {
              $ref: '#/components/responses/TeapotErrorResponse',
            },
            422: apiErrorResponse(),
            500: apiErrorResponse(),
          },
        },
        delete: {
          operationId: 'widget_delete',
          'x-qianshu-contract': contractMetadata('application'),
          responses: {
            204: noContentResponse(),
            400: apiErrorResponse(),
            500: apiErrorResponse(),
          },
        },
      },
      '/api/reports': {
        get: {
          operationId: 'report_download',
          'x-qianshu-contract': contractMetadata('application'),
          parameters: [
            {
              $ref: '#/components/parameters/ReportFormatQuery',
            },
          ],
          responses: {
            200: binaryResponse(),
            400: apiErrorResponse(),
            500: apiErrorResponse(),
          },
        },
      },
    },
    components: {
      parameters: {
        'Widget~Id/Path': {
          name: 'widgetId',
          in: 'path',
          required: true,
          schema: {
            $ref: '#/components/schemas/Identifier',
          },
        },
        ReportFormatQuery: {
          name: 'format',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
      },
      requestBodies: {
        WidgetCreateRequest: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/WidgetInput',
              },
            },
          },
        },
      },
      responses: {
        'Health~Success/Response': jsonResponse(
          '#/components/schemas/HealthSuccessResponse',
        ),
        TeapotErrorResponse: apiErrorResponse(
          'application/problem+json',
        ),
      },
      schemas: {
        ApiError: {
          type: 'object',
          properties: {
            code: { type: 'string' },
            message: { type: 'string' },
            fieldErrors: {
              type: 'object',
              additionalProperties: {
                type: 'array',
                items: { type: 'string' },
              },
            },
            requestId: { type: 'string' },
          },
          required: ['code', 'message', 'requestId'],
        },
        ApiErrorAlias: {
          $ref: API_ERROR_REF,
        },
        Identifier: {
          type: 'string',
        },
        WidgetInput: {
          type: 'object',
          properties: {
            name: { type: 'string' },
          },
          required: ['name'],
        },
        WidgetCreateResponse: {
          type: 'object',
          properties: {
            id: {
              $ref: '#/components/schemas/Identifier',
            },
          },
          required: ['id'],
        },
        'Widget~Response/V1': {
          type: 'object',
          properties: {
            id: {
              $ref: '#/components/schemas/Identifier',
            },
            name: { type: 'string' },
          },
          required: ['id', 'name'],
        },
        HealthSuccessResponse: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['ok'] },
          },
          required: ['status'],
        },
        HealthFailureResponse: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['error'] },
          },
          required: ['status'],
        },
        ForbiddenEnvelope: {
          type: 'object',
          properties: {
            code: { type: 'string' },
            message: { type: 'string' },
            data: { type: 'object' },
          },
          required: ['code', 'message', 'data'],
        },
        SelfRecursive: {
          type: 'object',
          properties: {
            next: {
              $ref: '#/components/schemas/SelfRecursive',
            },
          },
        },
        IndirectRecursiveA: {
          allOf: [
            {
              $ref: '#/components/schemas/IndirectRecursiveB',
            },
          ],
        },
        IndirectRecursiveB: {
          allOf: [
            {
              $ref: '#/components/schemas/IndirectRecursiveA',
            },
          ],
        },
        DiamondRoot: {
          allOf: [
            { $ref: '#/components/schemas/DiamondLeft' },
            { $ref: '#/components/schemas/DiamondRight' },
          ],
        },
        DiamondLeft: {
          type: 'object',
          properties: {
            shared: {
              $ref: '#/components/schemas/DiamondShared',
            },
          },
        },
        DiamondRight: {
          type: 'object',
          properties: {
            shared: {
              $ref: '#/components/schemas/DiamondShared',
            },
          },
        },
        DiamondShared: {
          type: 'object',
          properties: {
            value: { type: 'string' },
          },
        },
      },
    },
  }
}
