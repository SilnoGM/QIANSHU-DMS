import 'dotenv/config'
import 'reflect-metadata'

import { readFile } from 'node:fs/promises'

import { ApiException } from '../infrastructure/http/api.exception'
import {
  parseProductImportManifest,
  ProductImportOperationError,
  type ProductImportResult,
  type ProductImportRow,
} from './product-import.service'

interface ProductImportCliOptions {
  readonly apply: boolean
  readonly manifestPath: string
}

interface Dependencies {
  run(options: ProductImportCliOptions): Promise<ProductImportResult>
  output: { log(value: string): void; error(value: string): void }
  processRef: { exitCode?: number | string | null }
}

function parseArguments(argv: readonly string[]): ProductImportCliOptions {
  let apply = false
  let manifestPath: string | null = null
  const seen = new Set<string>()

  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (key === '--apply' || key === '--dry-run') {
      if (seen.has('mode')) throw new Error('Conflicting product import mode')
      seen.add('mode')
      apply = key === '--apply'
      continue
    }
    if (key === '--file') {
      if (seen.has('file')) throw new Error('Duplicate product import file')
      seen.add('file')
      const value = argv[++index] ?? ''
      if (value.length === 0 || value.length > 4096) {
        throw new Error('Invalid product import file')
      }
      manifestPath = value
      continue
    }
    throw new Error('Unknown product import argument')
  }

  if (manifestPath === null) throw new Error('Missing product import file')
  return { apply, manifestPath }
}

async function readManifest(path: string): Promise<readonly ProductImportRow[]> {
  const raw = JSON.parse(await readFile(path, 'utf8')) as unknown
  return parseProductImportManifest(raw)
}

async function runDefault(
  options: ProductImportCliOptions,
): Promise<ProductImportResult> {
  const [
    { NestFactory },
    { ProductImportModule },
    { ProductImportService },
  ] = await Promise.all([
    import('@nestjs/core'),
    import('./product-import.module'),
    import('./product-import.service'),
  ])
  const rows = await readManifest(options.manifestPath)
  const application = await NestFactory.createApplicationContext(ProductImportModule, {
    abortOnError: false,
    logger: false,
  })
  try {
    return await application
      .get(ProductImportService)
      .run({ apply: options.apply, rows })
  }
  finally {
    await application.close()
  }
}

/** 默认预览；只输出稳定摘要与错误码，不把连接串或底层异常带入运维日志。 */
export async function runProductImportCli(
  argv: readonly string[],
  dependencies: Dependencies = { run: runDefault, output: console, processRef: process },
): Promise<void> {
  try {
    const options = parseArguments(argv)
    const result = await dependencies.run(options)
    dependencies.output.log(JSON.stringify({
      kind: 'product_import',
      ...result,
    }))
    if (result.failed > 0 || result.conflicts.length > 0) {
      dependencies.processRef.exitCode = 1
    }
  }
  catch (error) {
    dependencies.output.error(JSON.stringify({
      kind: 'product_import',
      status: 'failed',
      code: error instanceof ApiException
        ? error.code
        : error instanceof ProductImportOperationError
          ? error.code
          : error instanceof SyntaxError
            ? 'MANIFEST_JSON_INVALID'
            : 'PRODUCT_IMPORT_FAILED',
    }))
    dependencies.processRef.exitCode = 1
  }
}

if (require.main === module) {
  void runProductImportCli(process.argv.slice(2))
}
