# 采购订单列表汇总行实施任务

## 1. 实施约束

- 按失败测试 → 最小实现 → 重构 → 回归顺序执行。
- 公共列表响应扩展已获得用户确认，不继续扩大 API 或数据结构范围。
- 不修改数据库 schema、migration 或生产数据。
- 每次验证失败必须如实记录并修复。

## 2. 任务清单

- [x] T1：新增 Server 失败测试，固定全量采购汇总与空结果口径。
  - _Evidence：首次运行 `purchase-order-query.service.spec.ts` 为 2 failed / 7 passed，失败原因均为列表响应缺少 `summariesByCurrency`。_
- [x] T2：新增 Web 失败测试，固定汇总矩阵、移动布局和金额格式化。
  - _Evidence：首次可信运行 Web 定向测试为 2 failed / 14 passed，分别证明格式化函数和采购汇总矩阵尚不存在。_
- [x] T3：实现采购列表汇总 DTO 与服务端聚合。
  - _Evidence：服务端定向测试 9/9 通过，Server typecheck 通过。_
- [x] T4：同步 OpenAPI，并接入采购列表共享页面。
  - _Evidence：Web 定向测试 23/23 通过，Web typecheck 与 `node --run contract:check` 通过。_
- [x] T5：运行定向测试、完整检查、构建和真实浏览器验收。
  - _Evidence：Server 定向测试 9/9、Web 定向测试 23/23、`node --run check`、`node --run build` 全部通过；真实 Chrome 核对“全部采购”和“待办采购”均显示同一组全量 `CNY` 汇总，当前 4 张订单的本单采购、采购定价、定金、尾款、已付、待付金额与列表数据一致。_
- [x] T6：更新任务证据并完成标准 Git 提交。
  - _Evidence：已完成变更范围审计和 `git diff --check`，本任务文件将作为同一标准提交交付。_
