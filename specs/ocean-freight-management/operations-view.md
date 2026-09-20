# 运营海运柜次接入记录

日期：2026-09-20。范围：将已验收的 `QsOceanContainerList` 接入运营真实页面。阶段 4 海运账单与费用继续暂缓，不新增数据库结构，不接入资金引擎。

## 展示与归属

- 入口：千树运营工作台 → 仓储运输 → 海运柜次，路由 `/qs-operations/warehouse-transport/ocean-containers`。
- 卡片显示柜次名称、编号、装柜日期、仓库、整柜明细数、我的明细数、总毛重与总材积；整柜概览不因销售归属改变。
- 支持按柜次名称、编号搜索，默认每页 10 个柜次；多个卡片可同时展开，每柜个人明细独立分页，每页 20 条。
- 个人归属唯一依据：装柜明细 → 货件 → 采购订单 → 销售订单 → `issuerUserId` 等于当前登录用户。管理员在运营页也遵守此规则。
- 未匹配货件、独立备货、缺少销售来源及他人销售订单的行不属于本人明细；无本人明细的柜次仍展示整柜概览，展开显示专用空状态。
- 整柜毛重或材积任一行缺失时，对应汇总显示待完善，不以部分合计代替完整合计；空柜显示零。
- 明细每行显示海运唛头、品名、来源、收件人、代收货款；海运唛头支持复制，查看明细打开 `QsGenericDrawer`。
- 抽屉显示入仓参考、完整收件信息、包装件数、重量尺寸、材积、代收货款与备注。重量尺寸整数、材积两位，缺失代收显示占位。

## 只读接口与权限

页面与接口使用已有 `sales-orders:read`，不要求授予完整的柜次管理权限。

| 接口 | 作用 |
| --- | --- |
| `GET /api/operations/ocean-containers` | 整柜概览、整柜统计及当前登录人的个人明细计数 |
| `GET /api/operations/ocean-containers/:id/items` | 本柜个人明细分页 |
| `GET /api/operations/ocean-containers/:id/items/:itemId` | 重新校验归属后返回个人明细详情 |

- 归属在数据库查询中限制，不接受前端传入用户 ID。详情不存在、跨柜或不属于本人统一返回 404。
- DTO 使用字段白名单，不返回来源文件、来源快照、其他销售人员客户资料或管理操作字段。
- 列表与两类统计使用同一数据库快照，避免并发归属变更造成计数矛盾。个人分页与计数同样使用一致快照。
- 响应标记为 `private, no-store`；页面离开、搜索变化、登录身份变化或撤权时取消请求并清除个人缓存，迟到响应不得恢复旧内容。
- 每次打开抽屉重新请求详情。个人总数变化时清除该柜旧分页，更新计数并关闭其旧详情；总数为零直接清空，页数缩减重新请求有效页。
- 三个接口不修改柜次、货件状态、审计记录或资金数据。

## 实现位置

- Server：`server/src/modules/container-batches/operations-ocean-container.*.ts`。
- Web API：`web/apps/qsmds-arco/src/api/modules/operations-ocean-containers.ts`。
- 页面与抽屉：`web/apps/qsmds-arco/src/views/operations/ocean-containers/`。
- 保持现有组件契约，演示数据只在组件库中使用。

## 验证记录

- Server 定向单元测试：4 个套件、18 项通过；覆盖读取权限、契约及原柜次管理回归。
- 隔离 PostgreSQL HTTP 测试：8 项通过；覆盖多销售与管理员隔离、越权详情、未知归属参数拒绝、归属即时变更、空柜和缺失值、分页及无资金副作用。
- Web 定向测试：16 项通过（页面状态与查询 10 项、既有卡片 6 项）；覆盖按需加载、缓存、迟到响应、身份变化、撤权、详情复验与计数缩减。
- 工作台路由回归：10 项通过；旧测试的海运占位预期更新为真实页面与销售读取权限，并验证菜单权限正反向过滤。
- OpenAPI 仅新增以上三个 GET 路径及对应 DTO；根入口 `node --run contract:sync`、`node --run contract:check` 通过。
- 定向 ESLint、Stylelint、Web 类型检查通过。
- 真实浏览器验证已有业务数据：卡片概览、本人明细与无本人明细空态、搜索及清空恢复、空结果、详情与键盘关闭、明暗主题；390 × 844 窄屏无根级横向溢出。业务数据库未插入验收数据。

复跑隔离 HTTP 测试：

```sh
node scripts/ci-postgres.mjs -- pnpm -C server exec jest --config test/jest-e2e.json --runInBand --runTestsByPath test/operations-ocean-containers.e2e-spec.ts
```

权限隔离和跨页明细分页由隔离测试验证；真实页面验收使用当前已有业务记录。
