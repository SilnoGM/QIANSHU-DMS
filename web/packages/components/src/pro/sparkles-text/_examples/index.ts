import Basic from './_basic.vue'
import BasicRaw from './_basic.vue?raw'
import Color from './_color.vue'
import ColorRaw from './_color.vue?raw'
import Count from './_count.vue'
import CountRaw from './_count.vue?raw'

export default [
  {
    title: '基础',
    component: Basic,
    componentRaw: BasicRaw,
  },
  {
    title: '数量',
    component: Count,
    componentRaw: CountRaw,
  },
  {
    title: '颜色',
    component: Color,
    componentRaw: ColorRaw,
  },
]
