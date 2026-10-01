import { runSeedCli } from './seed.main'
import { executeSeedCli } from './seed.runner'

/**
 * 入口保持极薄：参数解析、错误码收敛与退出码都在 runner 内完成，
 * 默认只预览，`--apply` 才写入内置数据。
 */
async function main(): Promise<void> {
  process.exitCode = await executeSeedCli(process.argv.slice(2), {
    run: options => runSeedCli(options),
    io: { writeLine: line => process.stdout.write(`${line}\n`) },
  })
}

void main()
