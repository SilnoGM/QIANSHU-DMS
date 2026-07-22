#!/usr/bin/env node
import process from 'node:process'

import { verifyFontZeroResidue } from './font-zero-residue.mjs'

const [outputDirectory, ...extraArguments] = process.argv.slice(2)

if (!outputDirectory || extraArguments.length > 0) {
  console.error('Usage: node scripts/verify-font-zero-residue.mjs <output-directory>')
  process.exitCode = 1
}
else {
  try {
    const result = await verifyFontZeroResidue(outputDirectory)
    console.log(
      `[font-zero-residue] verified ${result.fileCount} files, `
      + `${result.textArtifactCount} text artifacts, ${result.fontAssetCount} font assets`,
    )
  }
  catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
