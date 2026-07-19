import { executeAuthAdminCli } from './auth-admin.main'
import { NodeTerminalIO } from './terminal-io'

async function main(): Promise<void> {
  const exitCode = await executeAuthAdminCli(
    'recover',
    new NodeTerminalIO(),
  )
  process.exitCode = exitCode
}

void main()
