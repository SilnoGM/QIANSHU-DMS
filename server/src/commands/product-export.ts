import 'dotenv/config'
import 'reflect-metadata'

import { writeFile } from 'node:fs/promises'

import { ProductCatalogManifestError } from './product-catalog.manifest'

interface ProductExportCliOptions {
  readonly file: string
  readonly env: string
  readonly release: string
}

interface ProductExportSummary {
  readonly file: string
  readonly env: string
  readonly release: string
  readonly suppliers: number
  readonly categories: number
  readonly heads: number
  readonly products: number
  readonly incompleteProducts: number
  readonly dataChecksum: string
}

interface Dependencies {
  run(options: ProductExportCliOptions): Promise<ProductExportSummary>
  output: { log(value: string): void, error(value: string): void }
  processRef: { exitCode?: number | string | null }
}

function parseArguments(argv: readonly string[]): ProductExportCliOptions {
  let file: string | null = null
  let env = process.env.MEDIA_STORAGE_ENV ?? 'unknown'
  let release = process.env.QIANSHU_IMAGE_TAG ?? process.env.npm_package_version ?? 'unknown'
  const seen = new Set<string>()

  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (key === '--file' || key === '--source-env' || key === '--release') {
      if (seen.has(key)) throw new Error('Duplicate product export argument')
      seen.add(key)
      const value = argv[++index] ?? ''
      if (value.length === 0 || value.length > 4096) {
        throw new Error('Invalid product export argument')
      }
      if (key === '--file') file = value
      else if (key === '--source-env') env = value
      else release = value
      continue
    }
    throw new Error('Unknown product export argument')
  }

  if (file === null) throw new Error('Missing product export file')
  return { file, env, release }
}

async function runDefault(options: ProductExportCliOptions): Promise<ProductExportSummary> {
  const [{ NestFactory }, { ProductExportModule }, { ProductExportService }] =
    await Promise.all([
      import('@nestjs/core'),
      import('./product-export.module'),
      import('./product-export.service'),
    ])
  const application = await NestFactory.createApplicationContext(ProductExportModule, {
    abortOnError: false,
    logger: false,
  })
  try {
    const manifest = await application.get(ProductExportService).buildManifest({
      env: options.env,
      release: options.release,
      now: new Date(),
    })
    await writeFile(options.file, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    return {
      file: options.file,
      env: options.env,
      release: options.release,
      suppliers: manifest.suppliers.length,
      categories: manifest.categories.length,
      heads: manifest.heads.length,
      products: manifest.products.length,
      incompleteProducts: manifest.incompleteProducts.length,
      dataChecksum: manifest.dataChecksum,
    }
  }
  finally {
    await application.close()
  }
}

/** 只读导出；不修改数据库。存在无法同步的历史产品时以非零退出码提示。 */
export async function runProductExportCli(
  argv: readonly string[],
  dependencies: Dependencies = { run: runDefault, output: console, processRef: process },
): Promise<void> {
  try {
    const options = parseArguments(argv)
    const result = await dependencies.run(options)
    dependencies.output.log(JSON.stringify({ kind: 'product_catalog_export', ...result }))
    if (result.incompleteProducts > 0) dependencies.processRef.exitCode = 1
  }
  catch (error) {
    dependencies.output.error(JSON.stringify({
      kind: 'product_catalog_export',
      status: 'failed',
      code: error instanceof ProductCatalogManifestError
        ? error.code
        : error instanceof Error && error.message === 'Missing product export file'
          ? 'EXPORT_FILE_REQUIRED'
          : 'PRODUCT_EXPORT_FAILED',
    }))
    dependencies.processRef.exitCode = 1
  }
}

if (require.main === module) {
  void runProductExportCli(process.argv.slice(2))
}
