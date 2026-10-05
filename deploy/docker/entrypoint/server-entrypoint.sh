#!/bin/sh
# HTTP Server 启动入口：与宿主 systemd 单元的 ExecStartPre 等价，先执行媒体 preflight 再启动进程。
# 其他子命令（seed、管理 CLI、媒体清理）不经过 preflight，否则会被无关能力检查阻断。
set -eu

if [ "${1:-}" = "node" ] && [ "${2:-}" = "dist/main.js" ]; then
  media_root="${MEDIA_STORAGE_ROOT:-/var/lib/qianshu-dms/media}"
  # 幂等补齐子目录：preflight 与本地存储都要求 assets/trash/staging 存在且权限不含组写与其他访问。
  for directory in staging assets trash; do
    mkdir -p -m 0750 "$media_root/$directory"
  done
  node dist/commands/media-operations.js preflight
fi

exec "$@"
