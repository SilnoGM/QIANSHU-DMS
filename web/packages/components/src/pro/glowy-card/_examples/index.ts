import Basic from './_basic.vue'
import BasicRaw from './_basic.vue?raw'
import Color from './_color.vue'
import ColorRaw from './_color.vue?raw'
import WrapperBasic from './_wrapper-basic.vue'
import WrapperBasicRaw from './_wrapper-basic.vue?raw'

export default [
  {
    title: '基础',
    component: Basic,
    componentRaw: BasicRaw,
  },
  {
    title: '颜色',
    component: Color,
    componentRaw: ColorRaw,
  },
  {
    title: '容器',
    component: WrapperBasic,
    componentRaw: WrapperBasicRaw,
  },
]
