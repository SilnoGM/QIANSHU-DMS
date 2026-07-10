import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const typesFilePath = path.resolve(__dirname, '../src/types.ts')
const preferencesFilePath = path.resolve(__dirname, '../src/preferences.ts')

interface InterfaceProperty {
  name: string
  summary: string
  description: string
  nestedInterfaceName?: string
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

function normalizeDocText(comment: ts.JSDoc['comment']) {
  if (typeof comment === 'string') {
    return comment.trim()
  }
  if (Array.isArray(comment)) {
    return comment.map(part => typeof part === 'string' ? part : part.text).join('').trim()
  }
  return ''
}

function getJsDoc(node: ts.Node) {
  return (node as ts.Node & { jsDoc?: ts.JSDoc[] }).jsDoc ?? []
}

function getSummary(node: ts.Node, fallback: string) {
  for (const doc of getJsDoc(node)) {
    const summary = normalizeDocText(doc.comment).split(/\r?\n/).map(line => line.trim()).find(Boolean)
    if (summary) {
      return summary
    }
  }
  return fallback
}

function getTagText(node: ts.Node, tagName: string) {
  for (const doc of getJsDoc(node)) {
    for (const tag of doc.tags ?? []) {
      if (tag.tagName.text === tagName) {
        const text = normalizeDocText(tag.comment)
        if (text) {
          return text
        }
      }
    }
  }
  return ''
}

function escapeDocText(text: string) {
  return text.replaceAll('*/', '*\\/')
}

function getPropertyName(node: ts.PropertySignature) {
  if (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) {
    return node.name.text
  }
  throw new Error(`暂不支持的属性名类型：${node.name.getText()}`)
}

function getTypeName(node: ts.PropertySignature) {
  assert(node.type, `属性 ${getPropertyName(node)} 缺少类型定义`)
  const typeNode = node.type
  if (ts.isTypeReferenceNode(typeNode)) {
    if (ts.isIdentifier(typeNode.typeName)) {
      return typeNode.typeName.text
    }
    return typeNode.typeName.getText()
  }
  throw new Error(`属性 ${getPropertyName(node)} 的类型不是可引用的接口：${typeNode.getText()}`)
}

function getNestedInterfaceName(node: ts.PropertySignature, interfaces: Map<string, ts.InterfaceDeclaration>) {
  if (!node.type || !ts.isTypeReferenceNode(node.type)) {
    return undefined
  }

  const typeName = ts.isIdentifier(node.type.typeName)
    ? node.type.typeName.text
    : node.type.typeName.getText()

  return interfaces.has(typeName) ? typeName : undefined
}

function toPreferencesTypeName(interfaceName: string) {
  return interfaceName.endsWith('Settings')
    ? `${interfaceName.slice(0, -'Settings'.length)}Preferences`
    : `${interfaceName}Preferences`
}

function collectInterfaces(sourceFile: ts.SourceFile) {
  const map = new Map<string, ts.InterfaceDeclaration>()
  for (const statement of sourceFile.statements) {
    if (ts.isInterfaceDeclaration(statement)) {
      map.set(statement.name.text, statement)
    }
  }
  return map
}

function collectProperties(interfaceDecl: ts.InterfaceDeclaration, interfaces: Map<string, ts.InterfaceDeclaration>) {
  const properties: InterfaceProperty[] = []
  for (const member of interfaceDecl.members) {
    if (!ts.isPropertySignature(member)) {
      continue
    }
    const name = getPropertyName(member)
    properties.push({
      name,
      summary: getSummary(member, name),
      description: getTagText(member, 'description'),
      nestedInterfaceName: getNestedInterfaceName(member, interfaces),
    })
  }
  return properties
}

function pushDocBlock(lines: string[], options: { indent?: string, summary: string, description: string }) {
  const indent = options.indent ?? ''
  lines.push(`${indent}/**`)
  lines.push(`${indent} * ${escapeDocText(options.summary)}`)
  if (options.description) {
    lines.push(`${indent} * @description ${escapeDocText(options.description)}`)
  }
  lines.push(`${indent} */`)
}

async function main() {
  const source = await readFile(typesFilePath, 'utf8')
  const sourceFile = ts.createSourceFile(typesFilePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const interfaces = collectInterfaces(sourceFile)
  const settingsOptions = interfaces.get('SettingsOptions')

  assert(settingsOptions, '未找到 SettingsOptions 接口')

  const topLevelEntries = settingsOptions.members
    .filter(ts.isPropertySignature)
    .map((member) => {
      const name = getPropertyName(member)
      const interfaceName = getTypeName(member)
      return {
        name,
        interfaceName,
        preferencesTypeName: toPreferencesTypeName(interfaceName),
        summary: getSummary(member, name),
        description: getTagText(member, 'description'),
      }
    })
    .filter(entry => entry.name !== 'app')

  const lines: string[] = []
  lines.push('// 由 `pnpm --filter @fantastic-admin/settings generate:preferences` 自动生成，请勿手动修改。')
  lines.push('')

  const generated = new Set<string>()

  function appendPreferencesInterface(interfaceName: string) {
    if (generated.has(interfaceName)) {
      return
    }
    generated.add(interfaceName)

    const interfaceDecl = interfaces.get(interfaceName)
    assert(interfaceDecl, `未找到接口：${interfaceName}`)
    const preferencesTypeName = toPreferencesTypeName(interfaceName)
    const properties = collectProperties(interfaceDecl, interfaces)

    for (const property of properties) {
      if (property.nestedInterfaceName) {
        appendPreferencesInterface(property.nestedInterfaceName)
      }
    }

    lines.push(`export interface ${preferencesTypeName} {`)
    for (const property of properties) {
      pushDocBlock(lines, {
        indent: '  ',
        summary: property.summary,
        description: property.description
          ? `偏好设置中控制该项是否显示。原配置说明：${property.description}`
          : '偏好设置中控制该项是否显示。',
      })
      lines.push(`  ${property.name}?: boolean${property.nestedInterfaceName ? ` | ${toPreferencesTypeName(property.nestedInterfaceName)}` : ''}`)
    }
    lines.push('}')
    lines.push('')
  }

  for (const entry of topLevelEntries) {
    appendPreferencesInterface(entry.interfaceName)
  }

  lines.push('export interface SettingsPreferences {')
  for (const entry of topLevelEntries) {
    pushDocBlock(lines, {
      indent: '  ',
      summary: entry.summary,
      description: entry.description
        ? `偏好设置中控制整个分组是否显示，或继续细分到具体字段。原配置说明：${entry.description}`
        : '偏好设置中控制整个分组是否显示，或继续细分到具体字段。',
    })
    lines.push(`  ${entry.name}?: boolean | ${entry.preferencesTypeName}`)
  }
  lines.push('}')
  lines.push('')

  await writeFile(preferencesFilePath, `${lines.join('\n')}`)
}

await main()
