import path from 'node:path'
import process from 'node:process'

import {
  DEFAULT_NOTO_FONT_RELEASE_DIRECTORY,
  downloadNotoFontSnapshot,
  verifyNotoFontSnapshot,
} from './noto-font-assets.mjs'

const destinationDirectory = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : DEFAULT_NOTO_FONT_RELEASE_DIRECTORY

try {
  const manifest = await downloadNotoFontSnapshot({ destinationDirectory })
  const verification = await verifyNotoFontSnapshot(destinationDirectory)
  console.log(JSON.stringify({
    destinationDirectory,
    releaseId: manifest.releaseId,
    ...verification,
  }, null, 2))
}
catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
