import { ContainerWorkbookParseError } from './import-parser.types'

export interface XmlNode { name: string, attributes: Record<string, string>, children: XmlNode[], text: string }
const NAME = '[A-Za-z_][\\w.:-]*'
const TAG = new RegExp(`^(${NAME})([\\s\\S]*?)\\s*(/?)$`, 'u')
const ATTRIBUTE = new RegExp(`^\\s+(${NAME})\\s*=\\s*(?:"([^"<]*)"|'([^'<]*)')`, 'u')
function decode(value: string): string {
  return value.replace(/&([^;\s]+);|&/gu, (whole: string, entity: string | undefined) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
    if (entity && Object.hasOwn(named, entity)) return named[entity]
    if (entity && /^#(?:\d+|x[\da-fA-F]+)$/u.test(entity)) {
      const number = entity[1] === 'x' ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1))
      if (number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff)) return String.fromCodePoint(number)
    }
    throw new ContainerWorkbookParseError('装柜明细表含无效 XML 字符实体')
  })
}
function localName(name: string) { return name.split(':').at(-1)! }
/** 限定 OOXML 所需的 XML 子集；不解析 DTD、自定义实体或外部资源。 */
export function parseWorkbookXml(source: string): XmlNode {
  if (/<!DOCTYPE|<!ENTITY/iu.test(source)) throw new ContainerWorkbookParseError('装柜明细表不允许外部实体')
  const document: XmlNode = { name: '#document', attributes: {}, children: [], text: '' }, stack = [document], names = ['#document']
  const tokens = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]*>|[^<]+/gu
  let offset = 0, count = 0
  for (const token of source.matchAll(tokens)) {
    if (token.index !== offset || ++count > 400_000) throw new ContainerWorkbookParseError('装柜明细表 XML 无效或内容过多')
    const value = token[0]; offset += value.length
    const current = stack.at(-1)!
    if (value.startsWith('<!--') || value.startsWith('<?')) continue
    if (value.startsWith('<![CDATA[')) { current.text += value.slice(9, -3); continue }
    if (!value.startsWith('<')) { current.text += decode(value); continue }
    if (value.startsWith('</')) {
      if (stack.length <= 1 || names.pop() !== value.slice(2, -1).trim()) throw new ContainerWorkbookParseError('装柜明细表 XML 标签不匹配')
      stack.pop(); continue
    }
    const match = TAG.exec(value.slice(1, -1))
    if (!match || stack.length > 64) throw new ContainerWorkbookParseError('装柜明细表 XML 结构无效')
    const attributes: Record<string, string> = Object.create(null) as Record<string, string>
    let rest = match[2]
    while (rest.trim()) {
      const attribute = ATTRIBUTE.exec(rest)
      if (!attribute || Object.hasOwn(attributes, attribute[1])) throw new ContainerWorkbookParseError('装柜明细表 XML 属性无效')
      attributes[attribute[1]] = decode(attribute[2] ?? attribute[3]); rest = rest.slice(attribute[0].length)
    }
    const node = { name: localName(match[1]), attributes, children: [], text: '' }
    current.children.push(node)
    if (!match[3]) { stack.push(node); names.push(match[1]) }
  }
  if (offset !== source.length || stack.length !== 1 || document.children.length !== 1 || document.text.trim().replace(/^\uFEFF/u, '')) throw new ContainerWorkbookParseError('装柜明细表 XML 不完整')
  return document.children[0]
}
export function children(node: XmlNode, name: string): XmlNode[] { return node.children.filter(child => child.name === name) }
export function child(node: XmlNode, name: string): XmlNode | undefined { return node.children.find(item => item.name === name) }
export function textContent(node: XmlNode): string { return node.text + node.children.map(textContent).join('') }
export function attribute(node: XmlNode, name: string): string | undefined { return Object.entries(node.attributes).find(([key]) => localName(key) === name)?.[1] }
