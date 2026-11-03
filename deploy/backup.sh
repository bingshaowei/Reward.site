#!/bin/sh
# 从项目根目录运行：sh deploy/backup.sh
# 暂停写入，生成数据库、附件和证书备份；不自动删除任何历史备份。
set -eu
umask 077
mkdir -p backups
backup_dir="backups/$(date +%Y%m%d-%H%M%S)"
mkdir "$backup_dir"
restart_services() {
  docker compose start app cleanup >/dev/null
}
docker compose stop app cleanup
trap restart_services EXIT
docker compose exec -T db pg_dump -U bounty -d bounty -Fc > "$backup_dir/database.dump"
docker compose run --rm --no-deps --entrypoint tar app -C /app/data -czf - uploads > "$backup_dir/uploads.tar.gz"
docker compose exec -T caddy tar -C /data -czf - . > "$backup_dir/caddy-data.tar.gz"
printf '备份完成：%s\n请另行安全保存服务器的 .env 配置，并将备份复制到其他设备。\n' "$backup_dir"
