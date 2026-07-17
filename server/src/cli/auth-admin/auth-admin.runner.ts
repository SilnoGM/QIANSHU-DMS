import { UserStatus } from '../../generated/prisma/enums'
import { normalizePassword } from '../../modules/auth/providers/password.provider'
import {
  AuthAdminOperationError,
  AuthAdminService,
} from './auth-admin.service'

export type AuthAdminCommand = 'bootstrap' | 'recover'

/** 交互与业务服务分离，使测试不需要真实 TTY，也不会把密码放进命令参数或环境变量。 */
export interface AuthAdminIO {
  isInteractive(): boolean
  readText(prompt: string): Promise<string>
  readSecret(prompt: string): Promise<string>
  writeLine(line: string): void
}

export async function runAuthAdminCommand(
  command: AuthAdminCommand,
  io: AuthAdminIO,
  service: AuthAdminService,
): Promise<void> {
  if (!io.isInteractive()) {
    throw new AuthAdminOperationError(
      'INTERACTIVE_TTY_REQUIRED',
      '该命令只允许在交互式 TTY 中执行',
    )
  }

  if (command === 'bootstrap') {
    await runBootstrap(io, service)
    return
  }

  await runRecovery(io, service)
}

async function runBootstrap(
  io: AuthAdminIO,
  service: AuthAdminService,
): Promise<void> {
  const username = await io.readText('用户名: ')
  const displayName = await io.readText('展示名称: ')
  let password = ''
  let passwordConfirmation = ''

  try {
    password = await io.readSecret('永久密码: ')
    passwordConfirmation = await io.readSecret('再次输入永久密码: ')
    assertPasswordsMatch(password, passwordConfirmation)

    await service.bootstrap({ username, displayName, password })
    io.writeLine('system_admin 初始化完成。')
  }
  finally {
    // JavaScript 字符串无法可靠原地覆写；尽快释放引用，且禁止进入日志、argv 或环境变量。
    password = ''
    passwordConfirmation = ''
  }
}

async function runRecovery(
  io: AuthAdminIO,
  service: AuthAdminService,
): Promise<void> {
  const username = await io.readText('system_admin 用户名: ')
  const target = await service.inspectRecoveryTarget(username)
  let enableDisabled = false

  if (target.status === UserStatus.DISABLED) {
    const confirmation = await io.readText(
      '该用户已禁用；如需同时启用请输入 ENABLE，直接回车则保持禁用: ',
    )
    enableDisabled = confirmation === 'ENABLE'
  }

  let password = ''
  let passwordConfirmation = ''
  try {
    password = await io.readSecret('新永久密码: ')
    passwordConfirmation = await io.readSecret('再次输入新永久密码: ')
    assertPasswordsMatch(password, passwordConfirmation)

    await service.recover({ username, password, enableDisabled })
    // 首期没有外部告警平台，此固定高优先级终端事件是明确的运维交接点。
    io.writeLine(
      'HIGH_PRIORITY: system_admin 离线恢复完成，请立即核查审计事件。',
    )
  }
  finally {
    password = ''
    passwordConfirmation = ''
  }
}

function assertPasswordsMatch(
  password: string,
  passwordConfirmation: string,
): void {
  if (
    normalizePassword(password)
    !== normalizePassword(passwordConfirmation)
  ) {
    throw new AuthAdminOperationError(
      'PASSWORD_CONFIRMATION_MISMATCH',
      '两次输入的密码不一致',
    )
  }
}
