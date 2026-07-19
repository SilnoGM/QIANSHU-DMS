import * as fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import {
  applyFailureToProcess,
  CommandExecutionError,
  isDirectEntry,
} from './run-command.mjs'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const defaultRepositoryRoot = path.resolve(scriptsDirectory, '..')

// 这是唯一允许自动删除的根目录产物清单。必须使用精确名称，不能改成 glob、
// 前缀或递归扫描，否则可能把 Web、Server 依赖域或用户文件误判为违规产物。
export const forbiddenRootArtifacts = Object.freeze([
  'pnpm-workspace.yaml',
  'pnpm-lock.yaml',
  'node_modules',
  '.pnpm-store',
])

export function validateRootArtifactCleanerArguments(argv = process.argv) {
  // CLI 不接受目录参数：正式运行只能清理本脚本所属仓库根。repositoryRoot
  // 注入仅用于隔离测试，不构成对外命令行能力。
  if (!Array.isArray(argv) || argv.length !== 2) {
    throw new CommandExecutionError(
      'Unsupported root artifact cleaner arguments',
    )
  }
}

async function verifyRepositoryRoot(repositoryRoot, fileSystem) {
  try {
    const manifest = JSON.parse(await fileSystem.readFile(
      path.join(repositoryRoot, 'package.json'),
      'utf8',
    ))
    if (manifest.name !== 'qianshu-dms' || manifest.private !== true) {
      throw new Error('repository identity mismatch')
    }
  } catch {
    // 解析失败、权限问题和身份不匹配都使用固定错误文本，既禁止删除，也不把
    // 底层路径或文件内容带入日志。
    throw new CommandExecutionError(
      'Root artifact guard could not verify repository root',
    )
  }
}

async function removeExactArtifact(targetPath, status, fileSystem) {
  if (status.isSymbolicLink() || !status.isDirectory()) {
    // 对符号链接只 unlink 链接本身，绝不能递归到仓库外的真实目标。
    await fileSystem.unlink(targetPath)
    return
  }

  await fileSystem.rm(targetPath, { force: false, recursive: true })
}

export async function cleanRootArtifacts({
  fileSystem = fs,
  logger = console,
  repositoryRoot = defaultRepositoryRoot,
} = {}) {
  const resolvedRepositoryRoot = path.resolve(repositoryRoot)
  await verifyRepositoryRoot(resolvedRepositoryRoot, fileSystem)

  const failures = []
  const removed = []

  // 单项失败不能阻止其余精确白名单继续清理；全部尝试结束后统一返回非零，
  // 既尽量恢复仓库边界，也让调用方明确知道本次清理并未完全成功。
  for (const name of forbiddenRootArtifacts) {
    const targetPath = path.join(resolvedRepositoryRoot, name)
    let status
    try {
      status = await fileSystem.lstat(targetPath)
    } catch (error) {
      if (error?.code === 'ENOENT') {
        continue
      }
      failures.push(name)
      continue
    }

    try {
      await removeExactArtifact(targetPath, status, fileSystem)
      removed.push(name)
      logger.log(`Root artifact guard removed: ${name}`)
    } catch (error) {
      if (error?.code === 'ENOENT') {
        // 两个入口可能同时清理同一根产物。删除阶段报告 ENOENT 时必须再次
        // 确认目标确实不存在；只有确认缺失才按幂等成功处理，伪造的 ENOENT
        // 不能掩盖仍留在根目录中的违规产物。
        try {
          await fileSystem.lstat(targetPath)
        } catch (verificationError) {
          if (verificationError?.code === 'ENOENT') {
            continue
          }
        }
      }
      failures.push(name)
    }
  }

  if (failures.length > 0) {
    throw new CommandExecutionError(
      `Root artifact cleanup failed: ${failures.join(', ')}`,
    )
  }

  if (removed.length === 0) {
    logger.log('Root artifact guard passed.')
  }

  return { removed }
}

if (isDirectEntry(import.meta.url)) {
  Promise.resolve()
    .then(() => validateRootArtifactCleanerArguments())
    .then(() => cleanRootArtifacts())
    .catch(error => applyFailureToProcess(error))
}
