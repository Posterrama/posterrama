#!/usr/bin/env bash
# 🚀 Posterrama LXC Installer for Proxmox
# License: MIT
# Author: Mark Frelink

set -e

APP="Posterrama"

# ===== Functies =====
msg() { echo -e "\e[1;34m$1\e[0m"; }
error() { echo -e "\e[1;31m$1\e[0m"; exit 1; }
prompt() { read -rp "$1" input; echo "${input}"; }

# ===== Detect next available CTID =====
next_ctid=$(pct list | awk 'NR>1 {print $1}' | sort -n | tail -n1)
next_ctid=$((next_ctid + 1))

msg "=== 🚀 $APP LXC Installer ==="
msg "Using next available CTID: $next_ctid"

# ===== User input =====
# Wachtwoord check
while true; do
    read -rsp "Root Password (min 5 characters): " rootpw1; echo
    read -rsp "Repeat Root Password: " rootpw2; echo
    if [[ ${#rootpw1} -lt 5 ]]; then
        echo "⚠️ Password must be at least 5 characters."
        continue
    fi
    [[ "$rootpw1" == "$rootpw2" ]] && break || echo "⚠️ Passwords do not match, try again."
done

hostname=$(prompt "Hostname [posterrama]: ")
hostname=${hostname:-posterrama}

# Disk size check
while true; do
    disk_size=$(prompt "Disk Size (GB, 4-50) [10]: ")
    disk_size=${disk_size:-10}
    if ! [[ "$disk_size" =~ ^[0-9]+$ ]]; then
        echo "⚠️ Please enter a numeric value."
        continue
    fi
    if (( disk_size < 4 || disk_size > 50 )); then
        echo "⚠️ Disk size must be between 4 and 50 GB."
        continue
    fi
    break
done

# CPU cores check
while true; do
    cpu_cores=$(prompt "CPU Cores (1-4) [2]: ")
    cpu_cores=${cpu_cores:-2}
    if ! [[ "$cpu_cores" =~ ^[0-9]+$ ]] || (( cpu_cores < 1 || cpu_cores > 4 )); then
        echo "⚠️ CPU cores must be a number between 1 and 4."
        continue
    fi
    break
done

# RAM size check
while true; do
    ram_size=$(prompt "RAM Size (MB, 1024-8192) [2048]: ")
    ram_size=${ram_size:-2048}
    if ! [[ "$ram_size" =~ ^[0-9]+$ ]] || (( ram_size < 1024 || ram_size > 8192 )); then
        echo "⚠️ RAM must be a number between 1024 and 8192 MB."
        continue
    fi
    break
done

bridge=$(prompt "Bridge [vmbr0]: ")
bridge=${bridge:-vmbr0}

ipv4=$(prompt "IPv4 [dhcp]: ")
ipv4=${ipv4:-dhcp}

ssh_access="yes"
msg "🔑 Root SSH access will be enabled automatically."

# ===== List available storages =====
msg "\n📦 Available storages:"
mapfile -t storages < <(pvesm status | awk 'NR>1 {print $1}')
mapfile -t types < <(pvesm status | awk 'NR>1 {print $2}')
mapfile -t frees < <(pvesm status | awk 'NR>1 {print $6}')

for i in "${!storages[@]}"; do
    printf "%d.) %s (%s) Free: %sMB\n" "$((i+1))" "${storages[$i]}" "${types[$i]}" "${frees[$i]}"
done

# Storage selecties (fooproof)
while true; do
    read -rp "Select storage for template (number): " tmpl_storage_num
    if ! [[ "$tmpl_storage_num" =~ ^[0-9]+$ ]] || (( tmpl_storage_num < 1 || tmpl_storage_num > ${#storages[@]} )); then
        echo "⚠️ Invalid selection. Try again."
        continue
    fi
    tmpl_storage="${storages[$((tmpl_storage_num-1))]}"
    break
done

while true; do
    read -rp "Select storage for container rootfs (number): " rootfs_storage_num
    if ! [[ "$rootfs_storage_num" =~ ^[0-9]+$ ]] || (( rootfs_storage_num < 1 || rootfs_storage_num > ${#storages[@]} )); then
        echo "⚠️ Invalid selection. Try again."
        continue
    fi
    rootfs_storage="${storages[$((rootfs_storage_num-1))]}"
    break
done

# ===== Select latest Debian 13 template =====
msg "\n🔍 Selecting latest Debian 13 template from $tmpl_storage..."
tmpl_list=($(pveam list $tmpl_storage | awk 'NR>1 && /debian-13-standard/ {print $1}'))
tmpl="${tmpl_list[-1]}"

# Download template if not present
if [[ -z "$tmpl" ]]; then
    msg "⬇️ Template not found locally. Updating template list and downloading..."
    pveam update
    tmpl_list=($(pveam list $tmpl_storage | awk 'NR>1 && /debian-13-standard/ {print $1}'))
    tmpl="${tmpl_list[-1]}"
    if [[ -z "$tmpl" ]]; then
        error "No Debian 13 templates found in storage $tmpl_storage."
    fi
    pveam download "$tmpl_storage" "$tmpl"
fi
msg "Using template: $tmpl"

# ===== Create container =====
msg "\n🧱 Creating container $next_ctid ..."
pct create "$next_ctid" "$tmpl" \
    --hostname "$hostname" \
    --cores "$cpu_cores" \
    --memory "$ram_size" \
    --net0 name=eth0,bridge="$bridge",ip="$ipv4" \
    --rootfs "$rootfs_storage":"$disk_size" \
    --password "$rootpw1" \
    --features nesting=1

# ===== Start container =====
pct start "$next_ctid"

# ===== Wait until container is ready =====
msg "🔍 Waiting for container $next_ctid to become ready..."
spinner="/-\|"
max_attempts=30
attempt=0
while ! pct exec "$next_ctid" -- true >/dev/null 2>&1; do
    printf "\r⏳ Booting container... %s" "${spinner:attempt%4:1}"
    sleep 2
    ((attempt++))
    if [ $attempt -gt $max_attempts ]; then
        echo
        error "Container $next_ctid did not become ready in time."
    fi
done
echo
msg "✅ Container $next_ctid is up and running."

# ===== Enable SSH access =====
pct exec "$next_ctid" -- bash -c "mkdir -p /root/.ssh && chmod 700 /root/.ssh"
if [[ -f "$HOME/.ssh/id_rsa.pub" ]]; then
    pct push "$next_ctid" "$HOME/.ssh/id_rsa.pub" /root/.ssh/authorized_keys
    pct exec "$next_ctid" -- chmod 600 /root/.ssh/authorized_keys
    msg "🔑 SSH key added to container root"
fi

# ===== Basic system prep (update, upgrade, install curl) =====
msg "📦 Updating and installing curl inside container..."
pct exec "$next_ctid" -- bash -c "apt update && apt upgrade -y && apt install -y curl"

# ===== Install Posterrama =====
msg "📦 Installing $APP inside container..."
pct exec "$next_ctid" -- bash -c "curl -fsSL https://raw.githubusercontent.com/Posterrama/posterrama/main/install.sh | bash"

# ===== Show Posterrama access =====
msg() { echo -e "\e[1;34m$1\e[0m"; }
ct_ip=$(pct exec "$next_ctid" -- hostname -I | awk '{print $1}')
msg "🌐 You can access Posterrama at: http://$ct_ip:4000"