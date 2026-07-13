import { randomUUID } from 'node:crypto'
import {
  mkdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  resolve,
} from 'node:path'

import { createOpenApiDocument } from './openapi-document.factory'
import { OpenApiModule } from './openapi.module'

export interface GenerateOpenApiOptions {
  outputPath: string
}

const serverRoot = resolve(__dirname, '../..')
export const defaultSnapshotPath = join(
  serverRoot,
  'openapi/openapi.json',
)

const INVALID_ARGUMENTS_MESSAGE = 'Invalid OpenAPI generator arguments'
const GENERATION_FAILURE_MESSAGE = 'OpenAPI snapshot generation failed'
const TEMP_FILE_COLLISION_RETRIES = 3

function invalidArguments(): never {
  throw new Error(INVALID_ARGUMENTS_MESSAGE)
}

export function parseGenerateOpenApiArguments(
  argv: readonly string[],
): GenerateOpenApiOptions {
  if (argv.length === 0) {
    return { outputPath: defaultSnapshotPath }
  }

  if (
    argv.length !== 2 ||
    argv[0] !== '--output' ||
    argv[1].trim().length === 0 ||
    argv[1].startsWith('--')
  ) {
    return invalidArguments()
  }

  const outputPath = argv[1]

  return {
    outputPath: isAbsolute(outputPath)
      ? outputPath
      : resolve(serverRoot, outputPath),
  }
}

function createSiblingTemporaryPath(outputPath: string): string {
  return join(
    dirname(outputPath),
    `.${basename(outputPath)}.${process.pid}.${randomUUID()}.tmp`,
  )
}

function isFileExistsError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    Reflect.get(error, 'code') === 'EEXIST'
  )
}

async function writeUniqueTemporaryFile(
  outputPath: string,
  contents: string,
): Promise<string> {
  for (
    let attempt = 0;
    attempt < TEMP_FILE_COLLISION_RETRIES;
    attempt += 1
  ) {
    const temporaryPath = createSiblingTemporaryPath(outputPath)

    try {
      await writeFile(temporaryPath, contents, {
        encoding: 'utf8',
        flag: 'wx',
      })
      return temporaryPath
    } catch (error) {
      if (isFileExistsError(error)) {
        continue
      }

      // writeFile 可能在部分字节落盘后才失败；仅清理本次随机命名的 sibling 临时文件。
      await rm(temporaryPath, { force: true })
      throw error
    }
  }

  throw new Error('OpenAPI snapshot temporary file collision')
}

export async function generateOpenApiSnapshot(
  outputPath: string = defaultSnapshotPath,
): Promise<void> {
  const document = await createOpenApiDocument(OpenApiModule)
  const outputDirectory = dirname(outputPath)
  await mkdir(outputDirectory, { recursive: true })
  const contents = `${JSON.stringify(document, null, 2)}\n`
  const temporaryPath = await writeUniqueTemporaryFile(
    outputPath,
    contents,
  )

  try {
    // 同目录 rename 为单快照提供原子替换；失败时旧快照保持原样。
    await rename(temporaryPath, outputPath)
  } finally {
    await rm(temporaryPath, { force: true })
  }
}

export async function runGenerateOpenApi(
  argv: readonly string[] = process.argv.slice(2),
  generate: (
    outputPath?: string,
  ) => Promise<void> = generateOpenApiSnapshot,
): Promise<void> {
  try {
    const options = parseGenerateOpenApiArguments(argv)
    await generate(options.outputPath)
  } catch {
    // CLI 边界只输出固定文本，避免路径、文档内容或底层错误详情进入日志。
    console.error(GENERATION_FAILURE_MESSAGE)
    process.exitCode = 1
  }
}

// 测试和根级编排会导入本模块；只有直接执行编译产物时才允许生成快照。
if (require.main === module) {
  void runGenerateOpenApi()
}
