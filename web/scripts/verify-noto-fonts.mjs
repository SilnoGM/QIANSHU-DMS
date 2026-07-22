import path from 'node:path'
import process from 'node:process'

import {
  DEFAULT_NOTO_FONT_RELEASE_DIRECTORY,
  verifyNotoFontSnapshot,
} from './noto-font-assets.mjs'

const ALLOW_COMPRESSED_ARTIFACTS_FLAG = '--allow-compressed-artifacts'

try {
  const argumentsList = process.argv.slice(2)
  const unsupportedFlags = argumentsList.filter(argument =>
    argument.startsWith('--') && argument !== ALLOW_COMPRESSED_ARTIFACTS_FLAG)
  const positionalArguments = argumentsList.filter(argument =>
    argument !== ALLOW_COMPRESSED_ARTIFACTS_FLAG)
  if (unsupportedFlags.length > 0 || positionalArguments.length > 1) {
    throw new Error(
      `Usage: verify-noto-fonts.mjs [release-directory] [${ALLOW_COMPRESSED_ARTIFACTS_FLAG}]`,
    )
  }

  const allowCompressedArtifacts = argumentsList.includes(ALLOW_COMPRESSED_ARTIFACTS_FLAG)
  const releaseDirectory = positionalArguments[0]
    ? path.resolve(process.cwd(), positionalArguments[0])
    : DEFAULT_NOTO_FONT_RELEASE_DIRECTORY
  const verification = await verifyNotoFontSnapshot(releaseDirectory, {
    allowCompressedArtifacts,
  })
  console.log(JSON.stringify({ releaseDirectory, ...verification }, null, 2))
}
catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
