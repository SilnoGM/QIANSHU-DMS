import path from 'node:path'
import process from 'node:process'

import {
  DEFAULT_NOTO_FONT_RELEASE_DIRECTORY,
  verifyNotoFontSnapshot,
} from './noto-font-assets.mjs'

const releaseDirectory = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : DEFAULT_NOTO_FONT_RELEASE_DIRECTORY

try {
  const verification = await verifyNotoFontSnapshot(releaseDirectory)
  console.log(JSON.stringify({ releaseDirectory, ...verification }, null, 2))
}
catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
