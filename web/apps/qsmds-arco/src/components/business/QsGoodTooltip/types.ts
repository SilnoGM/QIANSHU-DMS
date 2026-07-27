export type GoodTooltipAlign = 'center' | 'end' | 'start'
export type GoodTooltipImageFit = 'contain' | 'cover'
export type GoodTooltipSide = 'bottom' | 'left' | 'right' | 'top'

export interface QsGoodTooltipContentProps {
  imageAlt?: string
  imageFit?: GoodTooltipImageFit
  imageSrc?: string | null
}

export interface QsGoodTooltipProps extends QsGoodTooltipContentProps {
  align?: GoodTooltipAlign
  delay?: number
  disabled?: boolean
  side?: GoodTooltipSide
}
