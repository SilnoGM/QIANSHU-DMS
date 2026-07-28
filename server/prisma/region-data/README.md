# 地区固定数据资产

本目录保存首期地区主数据的三份原始快照、转换清单和唯一 canonical 输出。运行时、
构建、应用启动和数据库 migration 均不得联网获取地区数据。需要更新来源时，必须新增
向前 migration，并重新评审来源、许可证、摘要、数量和已有业务 UUID 的兼容性。

## 文件职责

- `manifest.json`：锁定来源版本、许可证、归属、SHA-256、人工审校映射、转换版本、
  UUID namespace、固定数量和关键路径。
- `sources/`：保留未经改写的原始响应或固定 commit 文件。
- `regions.seed.json`：由 `server/scripts/region-data/generate-region-seed.mjs` 唯一
  生成的 canonical 数据，不得手工编辑。

生成器只使用 Node.js 内置模块。它会在解析前校验三份原始文件摘要，随后执行
Unicode NFC、空白折叠、固定 `en-US` 小写规则、三级转换、确定性 UUIDv5、数量和
层级校验。任何来源漂移、映射缺失、重复编码、错层或数量差异都会使生成失败。

## 固定来源与许可证

### 中国大陆

- 来源：[`yescallop/areacodes`](https://github.com/yescallop/areacodes)
- 固定文件：commit
  `e2c2b2e1fb4ce1fb76e879aa0b80e229adaf950c` 的
  [`codes.json`](https://raw.githubusercontent.com/yescallop/areacodes/e2c2b2e1fb4ce1fb76e879aa0b80e229adaf950c/codes.json)
- 许可证：[`CC0-1.0`](https://github.com/yescallop/areacodes/blob/e2c2b2e1fb4ce1fb76e879aa0b80e229adaf950c/LICENSE)
- SHA-256：
  `8c4e8afc5dfc16b77d34cf39b2547d07ab6a46e46b414679d494e50353970edc`
- 上游说明其数据来源包括国家地名信息库、民政部和中国政府网。

转换只取仍在用且编码小于 `710000` 的 31 个大陆省级节点。北京、天津、上海、重庆
生成同名 `CITY` 叶子；其余 27 个省级节点导入全部仍在用的直属节点。编码末两位非
`00` 的 32 个省直管县级地域保留为 `DIRECT_ADMIN_COUNTY_LEVEL`，不得伪称为法定
地级城市。

### 中国台湾

- 资料集：[内政部国土测绘中心 `ListCounty`](https://data.gov.tw/dataset/101905)
- API 快照：[`ListCounty`](https://api.nlsc.gov.tw/other/ListCounty)
- 资料集更新时间：`2026-06-02`
- 本项目快照日：`2026-07-27`
- 许可证：[政府资料开放授权条款第 1 版](https://data.gov.tw/license)
- 显名：资料来源为內政部國土測繪中心
- SHA-256：
  `5e9dfa16d989e569179f02375775ac5f0036d866305a4e11456e989ff59504f1`

项目固定合成“中国台湾 / 台湾”两级，并将官方 22 个县市转换为 `CITY`。默认简体
显示名来自 `manifest.json` 中逐项审校映射，不使用机器翻译或自动繁简转换。
`sourceName` 保留官方繁体原文；`sourceCode` 以
`<countycode>/<countycode01>` 可逆保存。关键路径固定为
`中国台湾 → 台湾 → 高雄市`，高雄市代码为 `TW-64000`，来源代码为 `E/64000`。

### 马来西亚

- 来源：Department of Statistics Malaysia (DOSM)、OpenDOSM 和 data.gov.my
- 固定文件：commit
  `b057365ccbf26cbe3db1c043668f6a0efe811cb2` 的
  [`state_district.csv`](https://raw.githubusercontent.com/dosm-malaysia/data-open/b057365ccbf26cbe3db1c043668f6a0efe811cb2/datasets/geodata/state_district.csv)
- 数量复核：[data.gov.my 2025 数据目录](https://data.gov.my/data-catalogue/population_district)
- 许可证：[`DOSM Open Data License`](https://github.com/dosm-malaysia/data-open/blob/b057365ccbf26cbe3db1c043668f6a0efe811cb2/LICENSE.md)
- SHA-256：
  `6ed9f08a88e3bd93a3cfe697b2135352688c495ae4595c6a37ae0980fffe7995`

本项目使用上述公开数据，不暗示 DOSM、OpenDOSM 或马来西亚政府认可、担保或提供
官方背书。16 个州级默认中文名来自 `manifest.json` 中逐项审校映射；160 个行政区
保留官方拉丁文字名称，不进行机器翻译。Perlis 与三个联邦直辖区使用来源中已有的
同名行政区行补足固定三级路径。

## 固定数量

| Level | 中国大陆 | 中国台湾 | 马来西亚 | 合计 |
| --- | ---: | ---: | ---: | ---: |
| `COUNTRY_REGION` | 1 | 1 | 1 | 3 |
| `PROVINCE_STATE` | 31 | 1 | 16 | 48 |
| `CITY` | 369 | 22 | 160 | 551 |
| 总节点 | 401 | 24 | 177 | 602 |

## 生成与校验

在仓库根目录执行：

```bash
node server/scripts/region-data/generate-region-seed.mjs
node server/scripts/region-data/generate-region-seed.mjs --check
node --test server/scripts/region-data/generate-region-seed.test.mjs
```

地区 ID 使用固定 namespace
`9acbca9a-32e2-4d7c-b00f-26a2e0dc5c1e`，按 RFC 4122 UUIDv5 对规范化后的
`region:<code>` 生成。因此同一技术 code 的 UUID 跨环境和重复生成保持稳定。
