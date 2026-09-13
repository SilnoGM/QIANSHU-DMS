import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const defaultWebRoot = fileURLToPath(new URL('../', import.meta.url))
const appRelative = 'apps/qsmds-arco/src'
const primaryPaint = 'oklch(var(--primary))'
const primaryTintPaint = 'color-mix(in srgb, oklch(var(--primary)) 18%, #F7F8F4)'
const brandPalette = new Set([primaryPaint, primaryTintPaint, '#27312B', '#F7F8F4', '#9B805F', 'none'])

/** 品牌源图只承载几何绘制，拒绝可执行、远程引用和绕过调色板的内容。 */
export function validateBrandSvg(source, name) {
  const content = source.replace(/<!--[\s\S]*?-->/gu, '')
  const svgTag = content.match(/<svg\b[^>]*>/u)?.[0]
  if (!svgTag || !/\bviewBox=["']0 0 64 64["']/u.test(svgTag)) {
    throw new Error(`Brand SVG requires viewBox="0 0 64 64": ${name}`)
  }
  const allowedTags = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'title', 'desc'])
  const tags = [...content.matchAll(/<\/?([\w:-]+)/gu)].map(match => match[1])
  if (tags.some(tag => !allowedTags.has(tag))
    || /\s(?:on[\w:-]+|style|(?:xlink:)?href)\s*=/iu.test(content)
    || /<!DOCTYPE|<!ENTITY|<\?|url\s*\(/iu.test(content)) {
    throw new Error(`Unsafe content in brand SVG: ${name}`)
  }
  let hasPrimaryPaint = false
  // 只允许两条已确认的主题表达式，不把任意 CSS 变量或 color-mix 参数视为有效调色板。
  const contentWithoutPaint = content.replace(/<([\w:-]+)\b[^>]*>/gu, (tag, tagName) => {
    return tag.replace(/\s(?:fill|stroke)\s*=\s*(["'])(.*?)\1/gu, (attribute, quote, paint) => {
      const canonicalPaint = paint.startsWith('#') ? paint.toUpperCase() : paint
      if (!brandPalette.has(canonicalPaint)) {
        throw new Error(`Color outside brand palette in ${name}: ${paint}`)
      }
      if (!['title', 'desc'].includes(tagName) && [primaryPaint, primaryTintPaint].includes(paint)) {
        hasPrimaryPaint = true
      }
      return attribute.replace(`${quote}${paint}${quote}`, `${quote}${quote}`)
    })
  })
  if (/var\s*\(/iu.test(contentWithoutPaint)) {
    throw new Error(`Unsafe variable outside approved paint in brand SVG: ${name}`)
  }
  if (!hasPrimaryPaint) {
    throw new Error(`Brand SVG must bind a paint to --primary: ${name}`)
  }
}

function filesWithin(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (['_examples', 'generated', 'node_modules'].includes(entry.name)) {
      return []
    }
    const absolute = path.join(directory, entry.name)
    return entry.isDirectory() ? filesWithin(absolute) : [absolute]
  }).sort()
}

export function extractStaticIconNames(source) {
  return [...new Set(source.match(/(?<![\w-])i-[a-z][a-z\d-]*:[a-z\d]+(?:-[a-z\d]+)*/gu) ?? [])].sort()
}

export function validateBrandIcons(icons, availableSvgNames) {
  const seen = new Set()
  icons.forEach((icon) => {
    if (!/^qs-[a-z\d]+(?:-[a-z\d]+)*$/u.test(icon.name)) {
      throw new Error(`Brand icon must use a qs- name: ${icon.name}`)
    }
    if (seen.has(icon.name)) {
      throw new Error(`Duplicate brand icon: ${icon.name}`)
    }
    seen.add(icon.name)
    if (!icon.label || !icon.category || !Array.isArray(icon.usages) || icon.usages.length === 0) {
      throw new Error(`Incomplete brand icon metadata: ${icon.name}`)
    }
    if (!availableSvgNames.has(icon.name)) {
      throw new Error(`Missing SVG for brand icon: ${icon.name}`)
    }
  })
  for (const name of availableSvgNames) {
    if (name.startsWith('qs-') && !seen.has(name)) {
      throw new Error(`Unregistered brand SVG: ${name}`)
    }
  }
}

function propertyOf(object, name) {
  return object.properties.find(property => ts.isPropertyAssignment(property) && property.name.getText() === name)?.initializer
}

/** 只遍历正式路由入口的静态 import 图；示例文件和未注册路由不会成为导航真相源。 */
export function collectNavigationIcons(webRoot = defaultWebRoot) {
  const routeRoot = path.join(webRoot, appRelative, 'router')
  const visited = new Set()
  const icons = []
  function inspect(file, entry = false) {
    if (visited.has(file)) {
      return
    }
    visited.add(file)
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
    for (const statement of source.statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        const specifier = statement.moduleSpecifier.text
        if (specifier.startsWith('.')) {
          const imported = path.resolve(path.dirname(file), `${specifier}.ts`)
          if (existsSync(imported)) {
            inspect(imported)
          }
        }
      }
      if (!ts.isVariableStatement(statement)) {
        continue
      }
      for (const declaration of statement.declarationList.declarations) {
        if (entry && !['asyncRoutes', 'componentLibraryMainRoute'].includes(declaration.name.getText())) {
          continue
        }
        function visit(node) {
          if (ts.isObjectLiteralExpression(node)) {
            const meta = propertyOf(node, 'meta')
            if (meta && ts.isObjectLiteralExpression(meta)) {
              if (propertyOf(meta, 'menu')?.kind === ts.SyntaxKind.FalseKeyword) {
                return
              }
              const title = propertyOf(meta, 'title')
              if (title) {
                const icon = propertyOf(meta, 'icon')
                if (!icon || !ts.isStringLiteral(icon)) {
                  throw new Error(`Missing static navigation icon: ${title.getText()} in ${path.relative(webRoot, file)}`)
                }
                icons.push({ name: icon.text, usage: ts.isStringLiteral(title) ? title.text : title.getText() })
              }
            }
          }
          ts.forEachChild(node, visit)
        }
        if (declaration.initializer) {
          visit(declaration.initializer)
        }
      }
    }
  }
  inspect(path.join(routeRoot, 'routes.ts'), true)
  return icons
}

export function buildIconInventory(webRoot = defaultWebRoot) {
  const appRoot = path.join(webRoot, appRelative)
  const metadata = JSON.parse(readFileSync(path.join(appRoot, 'icons/brand-icons.json'), 'utf8'))
  const svgFiles = filesWithin(path.join(appRoot, 'assets/icons')).filter(file => file.endsWith('.svg'))
  const svgNames = svgFiles.map(file => path.basename(file, '.svg'))
  if (new Set(svgNames).size !== svgNames.length) {
    throw new Error('Duplicate local SVG identifier')
  }
  validateBrandIcons(metadata, new Set(svgNames))
  for (const file of svgFiles.filter(file => path.basename(file).startsWith('qs-'))) {
    if (path.dirname(file) !== path.join(appRoot, 'assets/icons')) {
      throw new Error(`Brand SVG must use the flat assets/icons directory: ${file}`)
    }
    validateBrandSvg(readFileSync(file, 'utf8'), path.basename(file, '.svg'))
  }
  const brandNames = new Set(metadata.map(icon => icon.name))
  for (const icon of collectNavigationIcons(webRoot)) {
    if (!brandNames.has(icon.name)) {
      throw new Error(`Navigation icon is not registered as a brand asset: ${icon.name} (${icon.usage})`)
    }
  }
  const usageMap = new Map()
  const sources = [
    ...filesWithin(appRoot),
    ...filesWithin(path.join(webRoot, 'packages')),
  ].filter(file => /\.(?:vue|ts|tsx|js|css|scss|json)$/u.test(file)
    && !/\/(?:icons|iconify)\//u.test(file)
    && !/\.example\./u.test(file)
    && !file.endsWith('.d.ts')
    && (file.startsWith(appRoot) || file.includes('/src/')))
  for (const file of sources) {
    const source = readFileSync(file, 'utf8')
    for (const name of extractStaticIconNames(source)) {
      const usages = usageMap.get(name) ?? new Set()
      usages.add(path.relative(webRoot, file).replaceAll(path.sep, '/'))
      usageMap.set(name, usages)
    }
    for (const name of svgNames) {
      if (source.includes(name)) {
        const usages = usageMap.get(name) ?? new Set()
        usages.add(path.relative(webRoot, file).replaceAll(path.sep, '/'))
        usageMap.set(name, usages)
      }
    }
  }
  // 仅输出图标标识和使用位置，不向浏览器打包源码或整个第三方图标集。
  return [
    ...metadata.map(icon => ({ ...icon, source: 'brand' })),
    ...svgNames.filter(name => !brandNames.has(name)).map(name => ({
      name,
      label: name,
      category: '通用图标',
      source: 'local',
      usages: [...(usageMap.get(name) ?? [])].sort(),
    })),
    ...[...usageMap.keys()].filter(name => name.startsWith('i-')).sort().map(name => ({
      name,
      label: name,
      category: '通用图标',
      source: 'iconify',
      usages: [...usageMap.get(name)].sort(),
    })),
  ]
}

export function serializeInventory(inventory) {
  return `${JSON.stringify(inventory, null, 2)}\n`
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const expected = serializeInventory(buildIconInventory())
    const output = path.join(defaultWebRoot, appRelative, 'icons/project-icon-inventory.generated.json')
    if (process.argv.includes('--check')) {
      if (!existsSync(output) || readFileSync(output, 'utf8') !== expected) {
        throw new Error('Icon inventory is stale. Run node scripts/generate-icon-inventory.mjs')
      }
      console.log('Icon inventory is current.')
    }
    else {
      writeFileSync(output, expected)
      console.log(`Generated ${JSON.parse(expected).length} icon entries.`)
    }
  }
  catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
