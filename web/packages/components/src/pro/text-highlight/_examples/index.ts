import Basic from './_basic.vue'
import BasicRaw from './_basic.vue?raw'
import Direction from './_direction.vue'
import DirectionRaw from './_direction.vue?raw'
import Rounded from './_rounded.vue'
import RoundedRaw from './_rounded.vue?raw'
import TextColor from './_text-color.vue'
import TextColorRaw from './_text-color.vue?raw'
import Theme from './_theme.vue'
import ThemeRaw from './_theme.vue?raw'

export default [
  {
    title: '基础',
    component: Basic,
    componentRaw: BasicRaw,
  },
  {
    title: '圆角',
    component: Rounded,
    componentRaw: RoundedRaw,
  },
  {
    title: '主题色',
    component: Theme,
    componentRaw: ThemeRaw,
  },
  {
    title: '文本颜色',
    component: TextColor,
    componentRaw: TextColorRaw,
  },
  {
    title: '方向',
    component: Direction,
    componentRaw: DirectionRaw,
  },
]
