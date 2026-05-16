#!/bin/bash
set -e

echo ""
echo "============================================"
echo "   EnglishMaster Pro 一键安装脚本"
echo "   域名: qing-jie-520.cfd"
echo "   端口: 6667"
echo "============================================"
echo ""

# 颜色
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info() { echo -e "${GREEN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; exit 1; }

# 1. 系统更新
info "1/8 更新系统..."
apt update -y && apt upgrade -y

# 2. 安装 Node.js 20
info "2/8 安装 Node.js 20..."
if ! command -v node &>/dev/null || [[ $(node -v | cut -d. -f1 | tr -d v) -lt 18 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt install -y nodejs
fi
node -v
npm -v

# 3. 安装 PM2
info "3/8 安装 PM2..."
npm install -g pm2

# 4. 安装 Nginx + Certbot
info "4/8 安装 Nginx 和 Certbot..."
apt install -y nginx certbot python3-certbot-nginx

# 5. 克隆项目
info "5/8 部署项目..."
PROJECT_DIR="/opt/english-master-pro"
if [ -d "$PROJECT_DIR" ]; then
  warn "目录已存在，更新代码..."
  cd "$PROJECT_DIR"
  git pull origin main || true
else
  # 替换成你的 GitHub 仓库地址
  git clone https://github.com/YOUR_USERNAME/english-master-pro.git "$PROJECT_DIR"
  cd "$PROJECT_DIR"
fi
npm install --production

# 6. 配置 Nginx
info "6/8 配置 Nginx..."
DOMAIN="qing-jie-520.cfd"

cat > /etc/nginx/sites-available/english-master <<NGINX
server {
    listen 80;
    server_name ${DOMAIN};

    location / {
        proxy_pass http://127.0.0.1:6667;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 86400;
        client_max_body_size 50m;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/english-master /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# 7. SSL 证书
info "7/8 申请 SSL 证书..."
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email || {
  warn "SSL 自动申请失败，请手动运行:"
  warn "  certbot --nginx -d $DOMAIN"
}

# 设置自动续期
(crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet --post-hook 'systemctl reload nginx'") | sort -u | crontab -

# 8. PM2 启动 + 开机自启
info "8/8 启动应用..."
cd "$PROJECT_DIR"
pm2 delete english-master-pro 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null || pm2 startup

# 防火墙
if command -v ufw &>/dev/null; then
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw allow 22/tcp
  ufw --force enable
fi

echo ""
echo "============================================"
echo -e "${GREEN}  ✅ 安装完成！${NC}"
echo ""
echo "  访问: https://${DOMAIN}"
echo "  端口: 6667"
echo ""
echo "  常用命令:"
echo "    pm2 status          # 查看状态"
echo "    pm2 logs            # 查看日志"
echo "    pm2 restart all     # 重启"
echo "    pm2 monit           # 监控"
echo ""
echo "  数据目录: ${PROJECT_DIR}/data/"
echo "============================================"
echo ""
