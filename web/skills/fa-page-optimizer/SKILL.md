---
name: fa-page-optimizer
description: "优化 Vue 页面，用 Fantastic-admin 框架内建组件（packages/components/）替换自定义实现和原生 HTML。当用户说：'帮我优化这个页面'、'把这些原生 HTML 换成框架组件'、'用 FaCard/FaModal/FaButton 重构一下'、'这个页面太乱了'、'统一一下 UI 风格'、'用内建组件替换自定义弹窗/分页/加载'，即使用户只是说'看看这个页面能不能改进'也应触发此技能。"
---

# 页面优化器

利用 Fantastic-admin 的 80+ 内建组件优化 Vue 页面，用框架组件替换自定义实现，减少重复代码，保持 UI 一致性。

## 第一步：确定工作区边界（必须执行）

本项目只有一个正式业务应用。普通业务需求以及用户所说的“正式应用”“业务应用”，都默认作用于 `apps/qsmds-arco`，无需重复询问应用名称；页面默认位于 `apps/qsmds-arco/src/views/`。

- `examples/*` 可按需只读查阅。只有用户明确指定参考应用时，才把它作为处理目标；即便已点名，仍必须同时明确要求修改，才允许写入对应的 `examples/<name>`。仅要求参考或读取不构成写入授权。
- 下文所有 `apps/qsmds-arco/...` 都是正式业务需求的默认路径。获得上述参考应用写入授权后，先将目标根目录固定为用户点名的精确 `examples/<name>`，再把下文路径前缀 `apps/qsmds-arco` 替换为该目标根目录；除非用户另行明确要求，不得同时修改 `apps/qsmds-arco` 或其他 `examples/*`。
- `packages/*` 只承载跨应用稳定复用的框架能力；页面中的业务逻辑和业务组件不得下沉。
- 如果用户给出的目标路径与上述边界冲突，先说明冲突并确认意图，不得把正式业务改动复制到参考应用。

## 优化工作流

### 步骤 1: 分析页面，识别替换机会

读取目标页面，找出三类可优化点：

- **原生 HTML 元素**：`<button>`、`<input>`、`<select>`、自定义卡片 div 等
- **重复造轮子的自定义组件**：自定义弹窗、分页、加载状态、提示消息等
- **可简化的内联逻辑**：手动标签页切换、手动状态管理等

### 步骤 2: 查找合适的框架组件

先查组件目录确认有哪些可用组件：

```
Read: references/components-catalog.md
```

确定组件后，读取对应 README 了解完整 API（props、slots、events）：

```
Read: packages/components/src/basic/<component-name>/README.md
Read: packages/components/src/pro/<component-name>/README.md
```

先按组件目录所属的 `basic/` 或 `pro/` 选择一条真实路径。README 是最权威的用法来源，不确定时优先看文档而不是猜。

### 步骤 3: 参考优化模式（可选）

如果不确定如何替换，查看前后对比示例：

```
Read: references/optimization-patterns.md
```

### 步骤 4: 实施替换

替换时保留所有原始功能，不要改变业务逻辑。框架组件通常提供组合式函数用于编程式控制，优先使用：

- `useFaModal()` — 编程式打开/关闭弹窗、confirm 确认框
- `useFaToast()` — 显示成功/错误提示
- `useFaLoading()` — 控制加载遮罩

组件可以组合使用，例如：

```vue
<FaCard title="用户列表">
  <FaSearchBar v-model="keyword" />
  <FaEmpty v-if="users.length === 0" />
  <template #footer>
    <FaPagination :page="page" :size="size" :total="total" />
  </template>
</FaCard>
```

### 步骤 5: 验证

Fa 组件通过 `unplugin-auto-import` 自动导入，无需手动写 import 语句。替换后确认 props 和 v-model 绑定符合组件 API。如有问题，回到 `packages/components/src/basic/<component-name>/README.md` 或 `packages/components/src/pro/<component-name>/README.md` 核对。
