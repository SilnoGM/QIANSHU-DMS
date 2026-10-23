export type ImageGroupFit = 'contain' | 'cover'
export type ImageGroupRadius = 'full' | 'lg' | 'md' | 'none' | 'sm' | number
export type ImageGroupSize = 'lg' | 'md' | 'sm' | number
/** rich 使用带图片的浮层；native 使用浏览器原生 title，适合表格内大量缩略图。 */
export type ImageGroupTooltipMode = 'native' | 'rich'

export interface ImageGroupItem {
  alt?: string
  key?: number | string
  previewSrc?: string
  src: string
  tooltip?: string
}

export interface ImageGroupProps {
  fit?: ImageGroupFit
  items: readonly ImageGroupItem[]
  maxCount?: number
  overlap?: number
  preview?: boolean
  radius?: ImageGroupRadius
  size?: ImageGroupSize
  tooltip?: boolean
  tooltipDelay?: number
  tooltipMode?: ImageGroupTooltipMode
}

export interface NormalizedImageGroupItem {
  index: number
  item: ImageGroupItem
  key: string
}

export interface ImageGroupImageEntry {
  image: NormalizedImageGroupItem
  type: 'image'
}

export interface ImageGroupOverflowEntry {
  hiddenCount: number
  previewIndex: number
  type: 'overflow'
}

export type ImageGroupEntry = ImageGroupImageEntry | ImageGroupOverflowEntry

export interface ImageGroupPreviewEvent {
  index: number
  item: ImageGroupItem
}

export interface ImageGroupErrorEvent extends ImageGroupPreviewEvent {}
