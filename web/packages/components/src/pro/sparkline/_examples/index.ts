import Basic from './_basic.vue'
import BasicRaw from './_basic.vue?raw'
import Color from './_color.vue'
import ColorRaw from './_color.vue?raw'
import Size from './_size.vue'
import SizeRaw from './_size.vue?raw'
import Smooth from './_smooth.vue'
import SmoothRaw from './_smooth.vue?raw'
import Tooltip from './_tooltip.vue'
import TooltipRaw from './_tooltip.vue?raw'
import Update from './_update.vue'
import UpdateRaw from './_update.vue?raw'

export default [
  {
    title: '默认',
    component: Basic,
    componentRaw: BasicRaw,
  },
  {
    title: '自定义颜色',
    component: Color,
    componentRaw: ColorRaw,
  },
  {
    title: '开启 Tooltip',
    component: Tooltip,
    componentRaw: TooltipRaw,
  },
  {
    title: '自定义尺寸',
    component: Size,
    componentRaw: SizeRaw,
  },
  {
    title: '圆润过渡',
    component: Smooth,
    componentRaw: SmoothRaw,
  },
  {
    title: '数据更新',
    component: Update,
    componentRaw: UpdateRaw,
  },
]
