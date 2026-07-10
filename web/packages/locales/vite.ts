import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const packageLocalesInclude = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'lang/**/*',
)
