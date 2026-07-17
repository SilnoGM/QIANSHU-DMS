import type { Type } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'

import { AuthAdminModule } from './auth-admin.module'
import {
  AuthAdminOperationError,
  AuthAdminService,
} from './auth-admin.service'
import {
  runAuthAdminCommand,
  type AuthAdminCommand,
  type AuthAdminIO,
} from './auth-admin.runner'
import {
  AuthAdminCliCancelledError,
  AuthAdminTerminalInputError,
} from './terminal-io'

export interface AuthAdminCliApplication {
  get<T>(type: Type<T>): T
  close(): Promise<void>
}

export type CreateAuthAdminApplication =
  () => Promise<AuthAdminCliApplication>

export const createAuthAdminApplication =
  async (): Promise<AuthAdminCliApplication> =>
    NestFactory.createApplicationContext(AuthAdminModule, {
      abortOnError: false,
      logger: false,
    })

/**
 * CLI 最外层安全边界。
 *
 * TTY 检查先于 Nest/Prisma 初始化；任何未知异常只输出固定文案，避免连接串、SQL
 * 参数或密码库细节进入终端历史和运维采集。
 */
export async function executeAuthAdminCli(
  command: AuthAdminCommand,
  io: AuthAdminIO,
  createApplication: CreateAuthAdminApplication = createAuthAdminApplication,
): Promise<number> {
  if (!io.isInteractive()) {
    io.writeLine('该命令只允许在交互式 TTY 中执行')
    return 1
  }

  let application: AuthAdminCliApplication | undefined
  let exitCode = 0

  try {
    application = await createApplication()
    const service = application.get(AuthAdminService)
    await runAuthAdminCommand(command, io, service)
  }
  catch (error) {
    io.writeLine(toSafeCliMessage(error))
    exitCode = 1
  }
  finally {
    if (application !== undefined) {
      try {
        await application.close()
      }
      catch {
        io.writeLine('系统管理员操作资源释放失败')
        exitCode = 1
      }
    }
  }

  return exitCode
}

function toSafeCliMessage(error: unknown): string {
  if (
    error instanceof AuthAdminOperationError
    || error instanceof AuthAdminCliCancelledError
    || error instanceof AuthAdminTerminalInputError
  ) {
    return error.message
  }

  return '系统管理员操作失败'
}
