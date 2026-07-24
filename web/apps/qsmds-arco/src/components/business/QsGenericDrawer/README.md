# QsGenericDrawer 维护说明

`QsGenericDrawer` 是千树 DMS 的声明式业务抽屉。底层继续使用 `FaDrawer`，本目录只统一任务型抽屉的尺寸、状态、关闭守卫、焦点恢复和视觉分区，不请求 API，也不读取 Store。

## 生命周期

组件使用 `localOpen` 隔离父级 `modelValue` 与 `FaDrawer` 内部状态：

1. 父级打开时，记录当前焦点并打开 `FaDrawer`。
2. 自定义关闭按钮先以 `close-button` 执行守卫，通过后再更新 `v-model`。
3. `FaDrawer` 原生关闭只可能来自遮罩或 `Escape`。组件在 `document` 的 capture 阶段短暂记录 `Escape`，其余原生关闭归为 `overlay`。
4. 父级把 `modelValue` 改为 `false` 时，以 `programmatic` 执行同一守卫；拒绝后回写 `true`，避免受控状态与可见状态分叉。
5. `closed` 动画结束后，把焦点恢复到打开前仍存在的元素。

`submitting` 会在守卫之前拒绝所有关闭方式，同时把 Footer 设为 `inert`。调用方必须保证异步流程最终释放该状态；组件不会设置超时或擅自取消业务请求。

## 底层约束

`FaDrawer` 的 `beforeClose` 将遮罩和 `Escape` 都表示为 `close`，因此来源区分由本组件完成。不得改为读取 `data-drawer-id` 等私有 DOM，也不得在没有真实浏览器验证的情况下增加嵌套抽屉栈。

自定义 Header 需要底层隐藏的 `SheetTitle` 和 `SheetDescription` 继续承载真实标题文本。`web/packages/components/src/basic/drawer/index.vue` 中对应无障碍修复是本组件可访问名称的前置条件。

## 响应式规则

- `right`：窄屏全宽；从 `768px` 开始使用 `sm=384px`、`md=480px`、`lg=640px`、`xl=768px`。
- 桌面右侧宽度不超过 `calc(100vw - 48px)`。
- `bottom`：高度不超过 `calc(100dvh - 16px)`，顶部保留圆角。
- Footer 使用 `env(safe-area-inset-bottom)`，业务按钮的移动端全宽样式由调用方声明。

## 验证

```bash
pnpm -C web exec tsx --test \
  apps/qsmds-arco/test/views/generic-drawer.test.ts \
  apps/qsmds-arco/test/views/generic-drawer-showcase.test.ts

pnpm -C web typecheck
pnpm -C web build
```
