#!/usr/bin/env bash
source <(curl -fsSL https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main/misc/build.func)
# Copyright (c) 2021-2025 community-scripts ORG
# Author: Posterrama Team
# License: MIT
# Source: https://github.com/Posterrama/posterrama

APP="Posterrama"
var_tags="${var_tags:-media;plex;jellyfin;screensaver}"
var_cpu="${var_cpu:-2}"
var_ram="${var_ram:-2048}"
var_disk="${var_disk:-8}"
var_os="${var_os:-debian}"
var_version="${var_version:-12}"
var_unprivileged="${var_unprivileged:-1}"

header_info "$APP"
variables
color
catch_errors

function update_script() {
  header_info
  check_container_storage
  check_container_resources
  if [[ ! -d /opt/posterrama ]]; then
    msg_error "No ${APP} Installation Found!"
    exit
  fi

  if check_for_gh_release "posterrama" "Posterrama/posterrama"; then
    msg_info "Stopping Service"
    systemctl stop posterrama
    msg_ok "Stopped Service"

    msg_info "Creating Backup"
    cp -r /opt/posterrama/config.json /opt/posterrama/config.json.bak
    cp -r /opt/posterrama/.env /opt/posterrama/.env.bak
    cp -r /opt/posterrama/devices.json /opt/posterrama/devices.json.bak 2>/dev/null || true
    msg_ok "Backup Created"

    msg_info "Updating Posterrama"
    cd /opt/posterrama
    git fetch origin
    LATEST_TAG=$(git describe --tags `git rev-list --tags --max-count=1`)
    git checkout $LATEST_TAG
    $STD npm ci --omit=dev
    msg_ok "Updated Posterrama to $LATEST_TAG"

    msg_info "Restoring Configuration"
    mv /opt/posterrama/config.json.bak /opt/posterrama/config.json
    mv /opt/posterrama/.env.bak /opt/posterrama/.env
    [[ -f /opt/posterrama/devices.json.bak ]] && mv /opt/posterrama/devices.json.bak /opt/posterrama/devices.json
    msg_ok "Configuration Restored"

    msg_info "Starting Service"
    systemctl start posterrama
    msg_ok "Started Service"

    msg_ok "Update Successfully!"
  fi
  exit
}

start
build_container
description

msg_info "Setting Up Container OS"
$STD apt-get update
$STD apt-get install -y \
  curl \
  git \
  sudo \
  mc
msg_ok "Set Up Container OS"

msg_info "Installing Node.js"
NODE_VERSION="22" NODE_MODULE="npm" setup_nodejs
msg_ok "Installed Node.js"

msg_info "Installing Posterrama"
cd /opt
RELEASE=$(curl -s https://api.github.com/repos/Posterrama/posterrama/releases/latest | grep "tag_name" | awk '{print substr($2, 2, length($2)-3) }')
$STD git clone --depth 1 --branch ${RELEASE} https://github.com/Posterrama/posterrama.git
cd /opt/posterrama
$STD npm ci --omit=dev
msg_ok "Installed Posterrama ${RELEASE}"

msg_info "Creating Service"
cat <<EOF >/etc/systemd/system/posterrama.service
[Unit]
Description=Posterrama Digital Movie Poster App
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/posterrama
ExecStart=/usr/bin/node /opt/posterrama/server.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
Environment=NODE_ENV=production
Environment=PORT=4000

[Install]
WantedBy=multi-user.target
EOF

systemctl enable --now posterrama.service
msg_ok "Created Service"

msg_info "Creating Initial Configuration"
cat <<EOF >/opt/posterrama/.env
NODE_ENV=production
PORT=4000
SESSION_SECRET=$(openssl rand -base64 32)
EOF

cat <<EOF >/opt/posterrama/config.json
{
  "sources": {
    "plex": {
      "enabled": false,
      "serverUrl": "",
      "token": ""
    },
    "jellyfin": {
      "enabled": false,
      "serverUrl": "",
      "apiKey": "",
      "userId": ""
    },
    "tmdb": {
      "enabled": false,
      "apiKey": ""
    }
  },
  "display": {
    "transitionIntervalSeconds": 10,
    "transitionEffect": "fade"
  }
}
EOF
msg_ok "Created Initial Configuration"

msg_info "Cleaning Up"
$STD apt-get autoremove -y
$STD apt-get autoclean -y
msg_ok "Cleaned Up"

msg_ok "Completed Successfully!\n"
echo -e "${CREATING}${GN}${APP} setup has been successfully initialized!${CL}"
echo -e "${INFO}${YW} Access it using the following URL:${CL}"
echo -e "${TAB}${GATEWAY}${BGN}http://${IP}:4000${CL}"
echo -e "${INFO}${YW} Complete setup in the admin panel:${CL}"
echo -e "${TAB}${GATEWAY}${BGN}http://${IP}:4000/admin.html${CL}"
