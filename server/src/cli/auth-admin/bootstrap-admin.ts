import { executeAuthAdminCli } from './auth-admin.main'
import { NodeTerminalIO } from './terminal-io'

async function main(): Promise<void> {
  const exitCode = await executeAuthAdminCli(
    'bootstrap',
    new NodeTerminalIO(),
  )
  process.exitCode = exitCode
}

void main()
