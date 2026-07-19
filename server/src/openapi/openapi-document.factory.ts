import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type {
  INestApplication,
  NestApplicationOptions,
  Type,
} from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import {
  DocumentBuilder,
  type OpenAPIObject,
  SwaggerModule,
} from '@nestjs/swagger'

import { API_PREFIX } from '../app.constants'
import { ApiError } from '../infrastructure/http/api-error.dto'
import {
  CACHE_CONTROL_HEADER_NAME,
  MISSING_OPERATION_ID_PREFIX,
  OPENAPI_TITLE,
  OPENAPI_VERSION,
  PRIVATE_NO_STORE_CACHE_CONTROL,
  PRODUCTION_SESSION_COOKIE_NAME,
  QIANSHU_CONTRACT_EXTENSION,
  SESSION_COOKIE_SECURITY_SCHEME,
} from './openapi.constants'
import type {
  ApiSessionRequirement,
  QianshuContractMetadata,
} from './contract-metadata'

const OPENAPI_OPERATION_METHODS = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
] as const

function sessionSecurity(
  session: ApiSessionRequirement,
): OpenAPIObject['security'] {
  if (session === 'none') {
    return []
  }

  if (session === 'optional') {
    return [{ [SESSION_COOKIE_SECURITY_SCHEME]: [] }, {}]
  }

  return [{ [SESSION_COOKIE_SECURITY_SCHEME]: [] }]
}

/**
 * Nest Swagger 的公开 decorator 不能直接表达 security: []，也无法给一个 operation
 * 的全部响应统一补 Header，因此在唯一文档工厂中按契约元数据做确定性收口。
 */
function finalizeApplicationContracts(document: OpenAPIObject): void {
  for (const pathItem of Object.values(document.paths)) {
    for (const method of OPENAPI_OPERATION_METHODS) {
      const operation = pathItem[method]

      if (!operation) {
        continue
      }

      const metadata = Reflect.get(
        operation,
        QIANSHU_CONTRACT_EXTENSION,
      ) as QianshuContractMetadata | undefined

      if (!metadata || metadata.kind !== 'application') {
        continue
      }

      const session = metadata.session ??
        (metadata.authentication ? 'required' : undefined)

      if (session) {
        operation.security = sessionSecurity(session)
      }

      if (!metadata.privateNoStore) {
        continue
      }

      for (const response of Object.values(operation.responses)) {
        if (!response || '$ref' in response) {
          continue
        }

        response.headers = {
          ...response.headers,
          [CACHE_CONTROL_HEADER_NAME]: {
            description: '身份相关响应禁止缓存',
            schema: {
              type: 'string',
              enum: [PRIVATE_NO_STORE_CACHE_CONTROL],
            },
          },
        }
      }
    }
  }
}

export function missingOperationIdFactory(
  controllerKey: string,
  methodKey: string,
  version?: string,
): string {
  return `${MISSING_OPERATION_ID_PREFIX}${controllerKey}_${methodKey}${version ?? ''}`
}

export type OpenApiApplicationFactory = (
  rootModule: Type<unknown>,
  options: NestApplicationOptions,
) => Promise<INestApplication>

const defaultApplicationFactory: OpenApiApplicationFactory = (
  rootModule,
  options,
) => NestFactory.create(rootModule, options)

function readServerPackageVersion(): string {
  // src/openapi 与编译后的 dist/openapi 到 server/package.json 都恰好是两级目录。
  const packageJson = JSON.parse(
    readFileSync(resolve(__dirname, '../../package.json'), 'utf8'),
  ) as { version?: unknown }

  if (typeof packageJson.version !== 'string') {
    throw new Error('Server package version is missing')
  }

  return packageJson.version
}

/**
 * 通过 preview application 扫描 Controller metadata，不初始化监听端口。
 * 无论文档扫描成功或抛错，都必须关闭已创建应用，避免测试与离线生成器泄漏资源。
 */
export async function createOpenApiDocument(
  rootModule: Type<unknown>,
  applicationFactory: OpenApiApplicationFactory = defaultApplicationFactory,
): Promise<OpenAPIObject> {
  const application = await applicationFactory(rootModule, {
    preview: true,
    logger: false,
    abortOnError: false,
  })

  try {
    application.setGlobalPrefix(API_PREFIX)
    const configuration = new DocumentBuilder()
      .setOpenAPIVersion(OPENAPI_VERSION)
      .setTitle(OPENAPI_TITLE)
      .setVersion(readServerPackageVersion())
      .addTag('health')
      .addCookieAuth(
        PRODUCTION_SESSION_COOKIE_NAME,
        { type: 'apiKey', in: 'cookie' },
        SESSION_COOKIE_SECURITY_SCHEME,
      )
      .build()

    const document = SwaggerModule.createDocument(application, configuration, {
      extraModels: [ApiError],
      operationIdFactory: missingOperationIdFactory,
    })

    finalizeApplicationContracts(document)
    return document
  } finally {
    await application.close()
  }
}
