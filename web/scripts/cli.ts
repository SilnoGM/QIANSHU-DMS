#!/usr/bin/env node

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as p from '@clack/prompts'

interface PackageJson {
  name: string
  description?: string
  scripts?: Record<string, string>
}

export type WorkspaceKind = 'business' | 'example'

export interface WorkspaceEntry {
  kind: WorkspaceKind
  name: string
  packageJsonPath: string
}

export interface AppInfo {
  kind: WorkspaceKind
  name: string
  packageName: string
  description: string
  scripts: string[]
}

export interface AppChoice {
  value: string
  label: string
  hint: string
}

interface RunMessageContext {
  app: AppInfo
  script: string
}

interface ModeConfig {
  action: Mode
  intro: string
  noAppsMessage: string
  appSelectMessage: string
  scriptMatcher: (scriptName: string) => boolean
  selectionMode: 'single' | 'multiple'
  completionMessage?: string
  getRunMessage?: (context: RunMessageContext) => string
  showRunMessageWhenSingleApp?: boolean
}

type Mode = 'build' | 'dev' | 'serve'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(currentDir, '..')
const isWindows = process.platform === 'win32'
const validModes: Mode[] = ['build', 'dev', 'serve']
const modeConfigs: Record<Mode, ModeConfig> = {
  build: {
    action: 'build',
    intro: 'Select apps to build',
    noAppsMessage: 'No apps found with build script',
    appSelectMessage: 'Which apps do you want to build?',
    scriptMatcher: isBuildScript,
    selectionMode: 'multiple',
    completionMessage: 'Build complete!',
    getRunMessage: ({ app, script }) => `Building "${app.name}" with script "${script}"...`,
  },
  dev: {
    action: 'dev',
    intro: 'Select an app to run',
    noAppsMessage: 'No apps found with dev script',
    appSelectMessage: 'Which app do you want to run?',
    scriptMatcher: isDevScript,
    selectionMode: 'single',
    getRunMessage: ({ app }) => `Starting ${app.packageName}...`,
  },
  serve: {
    action: 'serve',
    intro: 'Select an app to serve',
    noAppsMessage: 'No apps found with serve script',
    appSelectMessage: 'Which app do you want to serve?',
    scriptMatcher: isServeScript,
    selectionMode: 'single',
    getRunMessage: ({ app, script }) => `Serving "${app.name}" with script "${script}"...`,
  },
}

let childProcess: ReturnType<typeof spawn> | null = null

function isBuildScript(scriptName: string): boolean {
  return scriptName === 'build' || scriptName.startsWith('build:')
}

function isDevScript(scriptName: string): boolean {
  return scriptName === 'dev' || scriptName.startsWith('dev:')
}

function isServeScript(scriptName: string): boolean {
  return scriptName === 'serve' || scriptName.startsWith('serve:')
}

export function getWorkspaceEntries(workspaceRoot = rootDir): WorkspaceEntry[] {
  const entries: WorkspaceEntry[] = []
  const workspaceDirectories: Array<{ directory: string, kind: WorkspaceKind }> = [
    { directory: 'apps', kind: 'business' },
    { directory: 'examples', kind: 'example' },
  ]

  for (const { directory, kind } of workspaceDirectories) {
    const absoluteDirectory = path.resolve(workspaceRoot, directory)
    if (!fs.existsSync(absoluteDirectory)) {
      continue
    }

    const children = fs.readdirSync(absoluteDirectory, { withFileTypes: true })
      .filter(child => child.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name, 'en'))

    for (const child of children) {
      const packageJsonPath = path.join(absoluteDirectory, child.name, 'package.json')
      if (!fs.existsSync(packageJsonPath)) {
        continue
      }

      entries.push({
        kind,
        name: child.name,
        packageJsonPath,
      })
    }
  }

  return entries
}

function readPackageJson(packageJsonPath: string): PackageJson {
  return JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as PackageJson
}

export function getApps(scriptMatcher: (scriptName: string) => boolean, workspaceRoot = rootDir): AppInfo[] {
  const apps: AppInfo[] = []

  for (const entry of getWorkspaceEntries(workspaceRoot)) {
    const packageJson = readPackageJson(entry.packageJsonPath)
    const scripts = Object.keys(packageJson.scripts ?? {}).filter(scriptMatcher)

    if (scripts.length === 0) {
      continue
    }

    apps.push({
      kind: entry.kind,
      name: entry.name,
      packageName: packageJson.name,
      description: packageJson.description || '',
      scripts,
    })
  }

  return apps
}

export function getAppChoices(apps: AppInfo[]): AppChoice[] {
  return apps.map(app => ({
    value: app.packageName,
    label: `[${app.kind}] ${app.name}`,
    hint: app.description,
  }))
}

function getAppByPackageName(apps: AppInfo[], packageName: string): AppInfo {
  const app = apps.find(item => item.packageName === packageName)

  if (!app) {
    throw new Error(`App not found: ${packageName}`)
  }

  return app
}

function resolvePromptValue<T>(value: T | symbol): T {
  if (p.isCancel(value)) {
    p.cancel('Operation cancelled')
    process.exit(0)
  }

  return value
}

async function selectScript(app: AppInfo, action: Mode): Promise<string> {
  if (app.scripts.length === 1) {
    return app.scripts[0]
  }

  const script = await p.select({
    message: `Select ${action} script for "${app.name}":`,
    options: app.scripts.map(name => ({
      value: name,
      label: name,
    })),
  })

  return resolvePromptValue(script)
}

async function runPackageScript(packageName: string, script: string): Promise<void> {
  return new Promise((resolve, reject) => {
    childProcess = spawn('pnpm', ['--filter', packageName, 'run', script], {
      stdio: 'inherit',
      cwd: rootDir,
      shell: isWindows,
    })

    childProcess.on('close', (code) => {
      childProcess = null

      if (code === 0 || code === null) {
        resolve()
        return
      }

      reject(new Error(`Process exited with code ${code}`))
    })

    childProcess.on('error', (error) => {
      childProcess = null
      reject(error)
    })
  })
}

async function selectApps(apps: AppInfo[], message: string, selectionMode: ModeConfig['selectionMode']): Promise<AppInfo[]> {
  if (selectionMode === 'multiple') {
    const selectedPackageNames = resolvePromptValue(await p.multiselect({
      message,
      options: getAppChoices(apps),
      required: true,
    }))

    return selectedPackageNames.map(packageName => getAppByPackageName(apps, packageName))
  }

  const selectedPackageName = resolvePromptValue(await p.select({
    message,
    options: getAppChoices(apps),
  }))

  return [getAppByPackageName(apps, selectedPackageName)]
}

async function runSelectedApps(apps: AppInfo[], config: ModeConfig, showRunMessage: boolean): Promise<void> {
  for (const app of apps) {
    const script = await selectScript(app, config.action)

    if (showRunMessage) {
      const runMessage = config.getRunMessage?.({
        app,
        script,
      })

      if (runMessage) {
        p.log.info(runMessage)
      }
    }

    await runPackageScript(app.packageName, script)
  }
}

async function runMode(config: ModeConfig): Promise<void> {
  p.intro(config.intro)

  const apps = getApps(config.scriptMatcher)

  if (apps.length === 0) {
    p.log.error(config.noAppsMessage)
    process.exitCode = 1
    return
  }

  if (apps.length === 1) {
    p.log.info(`Only one app found: ${apps[0].name}`)
    await runSelectedApps([apps[0]], config, config.showRunMessageWhenSingleApp ?? false)

    if (config.completionMessage) {
      p.outro(config.completionMessage)
    }

    return
  }

  const selectedApps = await selectApps(apps, config.appSelectMessage, config.selectionMode)
  await runSelectedApps(selectedApps, config, true)

  if (config.completionMessage) {
    p.outro(config.completionMessage)
  }
}

function parseModeArg(argv: string[]): string | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--mode' || arg === '-m') {
      return argv[index + 1]
    }

    if (arg.startsWith('--mode=')) {
      return arg.slice('--mode='.length)
    }

    if (arg.startsWith('-m=')) {
      return arg.slice('-m='.length)
    }
  }

  return undefined
}

function hasHelpArg(argv: string[]): boolean {
  return argv.includes('--help') || argv.includes('-h')
}

function isMode(value: string | undefined): value is Mode {
  return value !== undefined && validModes.includes(value as Mode)
}

export function printHelp(): void {
  console.log(`Usage: tsx scripts/cli.ts --mode=<${validModes.join('|')}>`)
  console.log('Examples:')
  console.log('  pnpm dev:select')
  console.log('  pnpm build:select')
  console.log('  pnpm serve:select')
}

async function main(): Promise<void> {
  const forwardSigint = () => childProcess?.kill('SIGINT')
  process.on('SIGINT', forwardSigint)

  try {
    const argv = process.argv.slice(2)
    const modeArg = parseModeArg(argv)

    if (hasHelpArg(argv)) {
      printHelp()
      return
    }

    if (!isMode(modeArg)) {
      p.log.error(`Invalid or missing mode. Expected one of: ${validModes.join(', ')}`)
      printHelp()
      process.exitCode = 1
      return
    }

    await runMode(modeConfigs[modeArg])
  }
  finally {
    process.off('SIGINT', forwardSigint)
  }
}

function isDirectEntry(moduleUrl: string, entryPath = process.argv[1]): boolean {
  if (!entryPath) {
    return false
  }

  return pathToFileURL(path.resolve(entryPath)).href === moduleUrl
}

if (isDirectEntry(import.meta.url)) {
  main().catch((error: Error) => {
    p.log.error(error.message)
    process.exitCode = 1
  })
}
