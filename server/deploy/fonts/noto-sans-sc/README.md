# 采购单图片中文字体

服务端采购单图片使用完整的 Noto Sans SC 字体，通过 sharp/Pango 的 `fontfile` 加载；不引用 Web 源码、不依赖操作系统安装中文字体，也不会在运行时访问网络。

- 上游：Google Fonts 官方仓库 `google/fonts`。
- 固定 commit：`809e4d8b8d7e9364a914909bb777679606c178b8`。
- 字体原始路径：`ofl/notosanssc/NotoSansSC[wght].ttf`。
- 字体 SHA-256：`a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da`。
- OFL 原始路径：`ofl/notosanssc/OFL.txt`。
- OFL SHA-256：`1c05c68c34f9708415aada51f17e1b0092d2cea709bf4a94cd38114f9e73d7d9`。
- 随包 OFL 仅移除了行末空格，文字内容不变；随包 SHA-256：`babcfe66c8a098b2fa279bc724a3a342f8124f77ce18941fbcc1bbb39823cded`。
- 许可证：SIL Open Font License 1.1，随包保留 `OFL.txt`。

`fonts.conf` 是最小 Fontconfig 配置。单据渲染首次使用时，如进程未提供 `FONTCONFIG_FILE`，会选用此配置，避免无配置宿主扫描所有系统字体。每段文字仍显式指定此目录的字体文件。若运维明确指定自己的 Fontconfig 配置，应保证该配置可读。

`package.json` 的 `files` 包含 `deploy/`，因此字体、许可和配置随 `pnpm deploy --prod` 进入正式服务端归档。字体版本是单据模板的一部分；替换字体或排版时必须递增模板版本并使未审核草稿重新生成。
