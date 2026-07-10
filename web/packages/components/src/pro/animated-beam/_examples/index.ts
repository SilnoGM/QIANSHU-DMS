import Basic from './_basic.vue'
import BasicRaw from './_basic.vue?raw'
import Dotted from './_dotted.vue'
import DottedRaw from './_dotted.vue?raw'
import Reverse from './_reverse.vue'
import ReverseRaw from './_reverse.vue?raw'

export default [
  {
    title: '基础',
    component: Basic,
    componentRaw: BasicRaw,
  },
  {
    title: '虚线',
    component: Dotted,
    componentRaw: DottedRaw,
  },
  {
    title: '反向',
    component: Reverse,
    componentRaw: ReverseRaw,
  },
]
