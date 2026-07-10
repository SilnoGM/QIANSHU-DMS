import Basic from './_basic.vue'
import BasicRaw from './_basic.vue?raw'
import Color from './_color.vue'
import ColorRaw from './_color.vue?raw'
import Opacity from './_opacity.vue'
import OpacityRaw from './_opacity.vue?raw'
import Size from './_size.vue'
import SizeRaw from './_size.vue?raw'

export default [
  {
    title: '基础',
    component: Basic,
    componentRaw: BasicRaw,
  },
  {
    title: '尺寸',
    component: Size,
    componentRaw: SizeRaw,
  },
  {
    title: '颜色',
    component: Color,
    componentRaw: ColorRaw,
  },
  {
    title: '透明度',
    component: Opacity,
    componentRaw: OpacityRaw,
  },
]
