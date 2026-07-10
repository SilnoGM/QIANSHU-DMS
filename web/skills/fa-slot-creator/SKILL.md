---
name: fa-slot-creator
description: 在 Fantastic-admin 框架中创建插槽，向布局的任意位置注入自定义内容。当用户提到以下任何需求时必须使用此技能：在头部/侧边栏/工具栏/标签栏加东西、logo 旁边加内容、侧边栏底部加用户信息、加个悬浮按钮、在导航菜单右侧加自定义组件、想在框架布局某个区域插入内容、在页面顶部或底部插入全局横幅/公告/版权栏。即使用户只是说"在顶部加个 XX"或"侧边栏加点东西"，也应触发此技能。支持 19 个插槽位置。
---

# Fantastic-admin 插槽创建器

框架通过约定自动发现插槽：目录名必须与插槽名完全匹配（区分大小写），文件名固定为 `index.vue`。不符合约定的文件不会被加载，这是框架的自动发现机制决定的。

## 第一步：确定工作区边界（必须执行）

本项目只有一个正式业务应用。普通业务需求以及用户所说的“正式应用”“业务应用”，都默认作用于 `apps/qsmds-arco`，无需重复询问应用名称；插槽默认位于 `apps/qsmds-arco/src/slots/`。

- `examples/*` 可按需只读查阅。只有用户明确指定参考应用时，才把它作为处理目标；即便已点名，仍必须同时明确要求修改，才允许写入对应的 `examples/<name>`。仅要求参考或读取不构成写入授权。
- 下文所有 `apps/qsmds-arco/...` 都是正式业务需求的默认路径。获得上述参考应用写入授权后，先将目标根目录固定为用户点名的精确 `examples/<name>`，再把下文路径前缀 `apps/qsmds-arco` 替换为该目标根目录；除非用户另行明确要求，不得同时修改 `apps/qsmds-arco` 或其他 `examples/*`。
- `packages/*` 只承载跨应用稳定复用的框架能力；带有业务语义的布局内容不得下沉。
- 如果用户给出的目标路径与上述边界冲突，先说明冲突并确认意图，不得把正式业务改动复制到参考应用。

## 创建插槽（手动步骤）

1. 创建目录：`apps/qsmds-arco/src/slots/{插槽名称}/`
2. 在该目录下创建 `index.vue` 文件，内容参考下方模板

### 普通插槽模板

```vue
<script setup lang="ts">
// 在此添加插槽逻辑
</script>

<template>
  <div>
    <!-- 在此添加插槽内容 -->
  </div>
</template>

<style scoped>
/* 在此添加插槽样式 */
</style>
```

### FreePosition 插槽模板

```vue
<script setup lang="ts">
// 在此添加插槽逻辑
</script>

<template>
  <div class="free-position-slot">
    <!-- 在此添加插槽内容 -->
    <!-- 注意：此插槽需要绝对定位 -->
  </div>
</template>

<style scoped>
.free-position-slot {
  position: absolute;
  /* 在此设置定位坐标，例如： */
  /* bottom: 20px; */
  /* right: 20px; */
  /* z-index: 1000; */
}
</style>
```

## 可用插槽位置

| 区域 | 插槽名称 |
|------|---------|
| 布局 | `LayoutTop`、`LayoutBottom` |
| 头部 | `HeaderStart`、`HeaderAfterLogo`、`HeaderAfterMenu`、`HeaderEnd` |
| 主侧边栏 | `MainSidebarTop`、`MainSidebarAfterLogo`、`MainSidebarAfterMenu`、`MainSidebarBottom` |
| 子侧边栏 | `SubSidebarTop`、`SubSidebarAfterLogo`、`SubSidebarAfterMenu`、`SubSidebarBottom` |
| 标签栏 | `TabbarStart`、`TabbarEnd` |
| 工具栏 | `ToolbarStart`、`ToolbarEnd` |
| 自由定位 | `FreePosition` |

## 选择指南

- 全局顶部横幅/公告（覆盖整个布局最上方） → `LayoutTop`
- 全局底部栏/版权声明（覆盖整个布局最下方） → `LayoutBottom`
- 全局导航元素 → `HeaderStart` / `HeaderEnd`
- 侧边栏用户信息/品牌内容 → `MainSidebarTop` / `MainSidebarAfterLogo`
- 工具栏自定义操作 → `ToolbarStart` / `ToolbarEnd`
- 悬浮元素（需要绝对定位） → `FreePosition`

> `LayoutTop` / `LayoutBottom` 位于整个布局的最外层，内容会横跨全宽，适合全局公告横幅、版权栏等需要独占一行的场景。

## FreePosition 特殊说明

`FreePosition` 插槽需要在样式中手动设置定位，否则内容不可见（模板见上方"FreePosition 插槽模板"）。

## 故障排除

插槽未显示？检查：
- 目录名是否与插槽名完全匹配（区分大小写）
- 文件名是否为 `index.vue`
- `apps/qsmds-arco/src/slots/` 目录是否存在
