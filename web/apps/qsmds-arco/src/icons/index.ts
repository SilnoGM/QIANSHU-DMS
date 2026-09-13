import type { BrandIconEntry } from './brand-icons'
import inventory from './project-icon-inventory.generated.json'

export { brandIcons } from './brand-icons'

export interface IconCatalogEntry extends BrandIconEntry {
  source: 'brand' | 'local' | 'iconify'
}

// 清单由静态扫描脚本生成，页面不读取源文件，也不加载整个 Iconify 数据集。
export const projectIcons = inventory as readonly IconCatalogEntry[]
