#!/bin/bash

# Posterrama Automated Installation Script
# Compatible with Ubuntu, Debian, CentOS, RHEL, and other Linux distributions

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
POSTERRAMA_USER="posterrama"
POSTERRAMA_DIR="/opt/posterrama"
SERVICE_NAME="posterrama"
DEFAULT_PORT="4000"

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to detect OS
detect_os() {
    if [[ -f /etc/os-release ]]; then
        . /etc/os-release
        OS=$NAME
        VER=$VERSION_ID
    elif type lsb_release >/dev/null 2>&1; then
        OS=$(lsb_release -si)
        VER=$(lsb_release -sr)
    elif [[ -f /etc/redhat-release ]]; then
        OS="CentOS"
        VER=$(rpm -q --qf "%{VERSION}" $(rpm -q --whatprovides redhat-release))
    else
        print_error "Cannot detect operating system"
        exit 1
    fi
    
    print_status "Detected OS: $OS $VER"
}

# Function to check if running as root and handle sudo
check_root() {
    if [[ $EUID -eq 0 ]]; then
        print_status "Running as root - OK"
        SUDO=""
    else
        print_status "Not running as root, checking for sudo..."
        if command -v sudo >/dev/null 2>&1; then
            print_status "sudo found, will use sudo for privileged operations"
            SUDO="sudo"
            # Test if sudo works without password or with cached credentials
            if sudo -n true 2>/dev/null; then
                print_status "sudo available without password prompt"
            else
                print_warning "sudo requires password authentication"
                print_status "You may be prompted for your password during installation"
            fi
        else
            print_error "This script requires root privileges, but sudo is not available"
            print_error "Please run this script as root or install sudo first"
            print_status "To run as root: su - root, then run this script"
            exit 1
        fi
    fi
}

# Function to install Node.js
install_nodejs() {
    print_status "Installing Node.js..."
    
    # Check if Node.js is already installed
    if command -v node >/dev/null 2>&1; then
        NODE_VERSION=$(node --version | sed 's/v//')
        MAJOR_VERSION=$(echo $NODE_VERSION | cut -d. -f1)
        
        if [[ $MAJOR_VERSION -ge 18 ]]; then
            print_success "Node.js $NODE_VERSION is already installed and compatible"
            # Ensure npm is also available
            if ! command -v npm >/dev/null 2>&1; then
                print_warning "npm not found in PATH, attempting to fix..."
                # Try to add common Node.js paths to PATH
                export PATH="/usr/bin:/usr/local/bin:$PATH"
                # Try alternative npm locations
                if [[ -x "/usr/bin/npm" ]]; then
                    export PATH="/usr/bin:$PATH"
                elif [[ -x "/usr/local/bin/npm" ]]; then
                    export PATH="/usr/local/bin:$PATH"
                fi
            fi
            
            if command -v npm >/dev/null 2>&1; then
                print_success "npm is available"
                return 0
            else
                print_warning "npm still not found, will attempt reinstall"
            fi
        else
            print_warning "Node.js $NODE_VERSION is installed but version 18+ is required"
        fi
    fi
    
    # Install Node.js based on OS
    case $OS in
        "Ubuntu"|"Debian"*)
            curl -fsSL https://deb.nodesource.com/setup_lts.x | $SUDO bash -
            $SUDO apt-get install -y nodejs
            ;;
        "CentOS"*|"Red Hat"*|"Rocky"*|"AlmaLinux"*)
            curl -fsSL https://rpm.nodesource.com/setup_lts.x | $SUDO bash -
            $SUDO yum install -y nodejs
            ;;
        "Fedora"*)
            curl -fsSL https://rpm.nodesource.com/setup_lts.x | $SUDO bash -
            $SUDO dnf install -y nodejs
            ;;
        *)
            print_error "Unsupported OS for automatic Node.js installation: $OS"
            print_status "Please install Node.js 18+ manually from https://nodejs.org/"
            exit 1
            ;;
    esac
    
    # Update PATH to include Node.js binaries
    export PATH="/usr/bin:/usr/local/bin:$PATH"
    
    # Verify installation
    if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
        NODE_VERSION=$(node --version)
        NPM_VERSION=$(npm --version)
        print_success "Node.js $NODE_VERSION and npm $NPM_VERSION installed successfully"
    else
        print_error "Failed to install Node.js or npm"
        exit 1
    fi
}

# Function to install Git
install_git() {
    print_status "Installing Git..."
    
    if command -v git >/dev/null 2>&1; then
        print_success "Git is already installed"
        return 0
    fi
    
    case $OS in
        "Ubuntu"|"Debian"*)
            $SUDO apt-get update
            $SUDO apt-get install -y git
            ;;
        "CentOS"*|"Red Hat"*|"Rocky"*|"AlmaLinux"*)
            $SUDO yum install -y git
            ;;
        "Fedora"*)
            $SUDO dnf install -y git
            ;;
        *)
            print_error "Unsupported OS for automatic Git installation: $OS"
            exit 1
            ;;
    esac
    
    print_success "Git installed successfully"
}

# Function to install PM2
install_pm2() {
    print_status "Installing PM2..."
    
    # Ensure npm is in PATH
    export PATH="/usr/bin:/usr/local/bin:$PATH"
    
    if command -v pm2 >/dev/null 2>&1; then
        print_success "PM2 is already installed"
        return 0
    fi
    
    # Verify npm is available before installing PM2
    if ! command -v npm >/dev/null 2>&1; then
        print_error "npm not found. Cannot install PM2."
        print_status "Please ensure Node.js and npm are properly installed."
        exit 1
    fi
    
    npm install -g pm2
    
    # Update PATH again after PM2 installation
    export PATH="/usr/bin:/usr/local/bin:$PATH"
    
    if command -v pm2 >/dev/null 2>&1; then
        print_success "PM2 installed successfully"
    else
        print_error "Failed to install PM2"
        exit 1
    fi
}

# Function to create system user
create_user() {
    print_status "Creating system user '$POSTERRAMA_USER'..."
    
    if id "$POSTERRAMA_USER" &>/dev/null; then
        print_success "User '$POSTERRAMA_USER' already exists"
        return 0
    fi
    
    $SUDO useradd --system --shell /bin/bash --home-dir $POSTERRAMA_DIR --create-home $POSTERRAMA_USER
    print_success "User '$POSTERRAMA_USER' created successfully"
}

# Function to download and install Posterrama
install_posterrama() {
    print_status "Downloading and installing Posterrama..."
    
    # Create directory if it doesn't exist and set proper ownership
    if [[ ! -d "$POSTERRAMA_DIR" ]]; then
        $SUDO mkdir -p $POSTERRAMA_DIR
        $SUDO chown $POSTERRAMA_USER:$POSTERRAMA_USER $POSTERRAMA_DIR
    else
        # Directory exists, ensure proper ownership
        $SUDO chown -R $POSTERRAMA_USER:$POSTERRAMA_USER $POSTERRAMA_DIR
    fi
    
    # Clone repository
    if [[ -d "$POSTERRAMA_DIR/.git" ]]; then
        print_status "Updating existing Posterrama installation..."
        if [[ -n "$SUDO" ]]; then
            $SUDO -u $POSTERRAMA_USER git -C $POSTERRAMA_DIR pull
        else
            su - $POSTERRAMA_USER -c "cd $POSTERRAMA_DIR && git pull"
        fi
    else
        print_status "Cloning Posterrama repository..."
        # Remove any existing files first
        if [[ "$(ls -A $POSTERRAMA_DIR 2>/dev/null)" ]]; then
            print_status "Cleaning existing directory..."
            $SUDO rm -rf $POSTERRAMA_DIR/*
            $SUDO rm -rf $POSTERRAMA_DIR/.*  2>/dev/null || true
        fi
        
        if [[ -n "$SUDO" ]]; then
            $SUDO -u $POSTERRAMA_USER git clone https://github.com/Posterrama/posterrama.git $POSTERRAMA_DIR
        else
            su - $POSTERRAMA_USER -c "git clone https://github.com/Posterrama/posterrama.git $POSTERRAMA_DIR"
        fi
    fi
    
    cd $POSTERRAMA_DIR
    
    # Install dependencies
    print_status "Installing Node.js dependencies..."
    
    # Find the actual npm location
    NPM_PATH=$(which npm 2>/dev/null || echo "")
    NODE_PATH=$(which node 2>/dev/null || echo "")
    
    if [[ -z "$NPM_PATH" ]]; then
        print_error "npm not found in current PATH"
        exit 1
    fi
    
    print_status "Using npm at: $NPM_PATH"
    print_status "Using node at: $NODE_PATH"
    
    # Create symlinks in /usr/local/bin so they're accessible to all users
    if [[ ! -L "/usr/local/bin/node" && ! -f "/usr/local/bin/node" ]]; then
        print_status "Creating symlink for node..."
        $SUDO ln -sf "$NODE_PATH" /usr/local/bin/node
    fi
    
    if [[ ! -L "/usr/local/bin/npm" && ! -f "/usr/local/bin/npm" ]]; then
        print_status "Creating symlink for npm..."
        $SUDO ln -sf "$NPM_PATH" /usr/local/bin/npm
    fi
    
    # Set up proper PATH in posterrama user's profile
    POSTERRAMA_BASHRC="$POSTERRAMA_DIR/.bashrc"
    if [[ ! -f "$POSTERRAMA_BASHRC" ]] || ! grep -q "/usr/local/bin" "$POSTERRAMA_BASHRC" 2>/dev/null; then
        print_status "Setting up PATH in posterrama user's .bashrc..."
        echo 'export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"' | $SUDO tee -a "$POSTERRAMA_BASHRC" > /dev/null
        $SUDO chown $POSTERRAMA_USER:$POSTERRAMA_USER "$POSTERRAMA_BASHRC"
    fi
    
    # Verify the posterrama user can access node and npm
    if [[ -n "$SUDO" ]]; then
        NODE_TEST=$($SUDO -u $POSTERRAMA_USER bash -l -c "which node 2>/dev/null || echo 'NOT_FOUND'")
        NPM_TEST=$($SUDO -u $POSTERRAMA_USER bash -l -c "which npm 2>/dev/null || echo 'NOT_FOUND'")
    else
        NODE_TEST=$(su - $POSTERRAMA_USER -c "which node 2>/dev/null || echo 'NOT_FOUND'")
        NPM_TEST=$(su - $POSTERRAMA_USER -c "which npm 2>/dev/null || echo 'NOT_FOUND'")
    fi
    
    print_status "Node accessible to posterrama user: $NODE_TEST"
    print_status "npm accessible to posterrama user: $NPM_TEST"
    
    # If still not found, try direct path access
    if [[ "$NPM_TEST" == "NOT_FOUND" ]]; then
        print_warning "npm not found via which, testing direct path access..."
        if [[ -n "$SUDO" ]]; then
            NPM_DIRECT_TEST=$($SUDO -u $POSTERRAMA_USER bash -c "/usr/local/bin/npm --version 2>/dev/null && echo 'DIRECT_ACCESS_OK' || echo 'DIRECT_ACCESS_FAILED'")
        else
            NPM_DIRECT_TEST=$(su - $POSTERRAMA_USER -c "/usr/local/bin/npm --version 2>/dev/null && echo 'DIRECT_ACCESS_OK' || echo 'DIRECT_ACCESS_FAILED'")
        fi
        
        if [[ "$NPM_DIRECT_TEST" == "DIRECT_ACCESS_OK" ]]; then
            print_status "npm accessible via direct path - continuing..."
        else
            print_error "npm still not accessible to posterrama user even via direct path"
            print_status "Attempting to fix permissions on Node.js binaries..."
            $SUDO chmod +x /usr/local/bin/node /usr/local/bin/npm 2>/dev/null || true
            # Try one more time
            if [[ -n "$SUDO" ]]; then
                NPM_FINAL_TEST=$($SUDO -u $POSTERRAMA_USER bash -c "/usr/local/bin/npm --version 2>/dev/null && echo 'OK' || echo 'FAILED'")
            else
                NPM_FINAL_TEST=$(su - $POSTERRAMA_USER -c "/usr/local/bin/npm --version 2>/dev/null && echo 'OK' || echo 'FAILED'")
            fi
            
            if [[ "$NPM_FINAL_TEST" == "FAILED" ]]; then
                print_error "Unable to fix npm access for posterrama user"
                exit 1
            fi
        fi
    fi
    
    # Run npm install with proper PATH
    print_status "Running npm install..."
    if [[ -n "$SUDO" ]]; then
        if $SUDO -u $POSTERRAMA_USER bash -l -c "which npm >/dev/null 2>&1"; then
            $SUDO -u $POSTERRAMA_USER bash -l -c "cd $POSTERRAMA_DIR && npm install"
        else
            # Fallback to direct path
            $SUDO -u $POSTERRAMA_USER bash -c "cd $POSTERRAMA_DIR && /usr/local/bin/npm install"
        fi
    else
        if su - $POSTERRAMA_USER -c "which npm >/dev/null 2>&1"; then
            su - $POSTERRAMA_USER -c "cd $POSTERRAMA_DIR && npm install"
        else
            # Fallback to direct path
            su - $POSTERRAMA_USER -c "cd $POSTERRAMA_DIR && /usr/local/bin/npm install"
        fi
    fi
    
    # Copy configuration file
    if [[ ! -f "$POSTERRAMA_DIR/config.json" ]]; then
        print_status "Creating initial configuration..."
        if [[ -n "$SUDO" ]]; then
            $SUDO -u $POSTERRAMA_USER cp config.example.json config.json
        else
            su - $POSTERRAMA_USER -c "cd $POSTERRAMA_DIR && cp config.example.json config.json"
        fi
    fi
    
    # Set proper permissions
    $SUDO chown -R $POSTERRAMA_USER:$POSTERRAMA_USER $POSTERRAMA_DIR
    $SUDO chmod +x $POSTERRAMA_DIR/server.js
    
    print_success "Posterrama installed successfully"
}

# Function to configure firewall
configure_firewall() {
    print_status "Configuring firewall..."
    
    # Check if UFW is available
    if command -v ufw >/dev/null 2>&1; then
        print_status "Configuring UFW firewall..."
        $SUDO ufw allow $DEFAULT_PORT/tcp
        print_success "UFW configured to allow port $DEFAULT_PORT"
    # Check if firewalld is available
    elif command -v firewall-cmd >/dev/null 2>&1; then
        print_status "Configuring firewalld..."
        $SUDO firewall-cmd --permanent --add-port=$DEFAULT_PORT/tcp
        $SUDO firewall-cmd --reload
        print_success "Firewalld configured to allow port $DEFAULT_PORT"
    else
        print_warning "No supported firewall found. Please manually allow port $DEFAULT_PORT"
    fi
}

# Function to setup PM2 service
setup_service() {
    print_status "Setting up PM2 service..."
    
    cd $POSTERRAMA_DIR
    
    # Find the actual paths for node, npm, and pm2
    NPM_PATH=$(which npm 2>/dev/null || echo "")
    NODE_PATH=$(which node 2>/dev/null || echo "")
    PM2_PATH=$(which pm2 2>/dev/null || echo "")
    
    if [[ -z "$PM2_PATH" ]]; then
        print_error "PM2 not found in current PATH"
        exit 1
    fi
    
    print_status "Using PM2 at: $PM2_PATH"
    
    # Create symlinks for PM2 if needed
    if [[ ! -L "/usr/local/bin/pm2" && ! -f "/usr/local/bin/pm2" ]]; then
        print_status "Creating symlink for pm2..."
        $SUDO ln -sf "$PM2_PATH" /usr/local/bin/pm2
    fi
    
    # Verify PM2 access for posterrama user
    if [[ -n "$SUDO" ]]; then
        PM2_TEST=$($SUDO -u $POSTERRAMA_USER bash -l -c "which pm2 2>/dev/null || echo 'NOT_FOUND'")
    else
        PM2_TEST=$(su - $POSTERRAMA_USER -c "which pm2 2>/dev/null || echo 'NOT_FOUND'")
    fi
    
    print_status "PM2 accessible to posterrama user: $PM2_TEST"
    
    # If PM2 not found in PATH, test direct access
    if [[ "$PM2_TEST" == "NOT_FOUND" ]]; then
        print_warning "PM2 not found via which, testing direct path access..."
        if [[ -n "$SUDO" ]]; then
            PM2_DIRECT_TEST=$($SUDO -u $POSTERRAMA_USER bash -c "/usr/local/bin/pm2 --version 2>/dev/null && echo 'DIRECT_ACCESS_OK' || echo 'DIRECT_ACCESS_FAILED'")
        else
            PM2_DIRECT_TEST=$(su - $POSTERRAMA_USER -c "/usr/local/bin/pm2 --version 2>/dev/null && echo 'DIRECT_ACCESS_OK' || echo 'DIRECT_ACCESS_FAILED'")
        fi
        
        if [[ "$PM2_DIRECT_TEST" != "DIRECT_ACCESS_OK" ]]; then
            print_error "PM2 not accessible to posterrama user"
            exit 1
        else
            print_status "PM2 accessible via direct path - continuing..."
        fi
    fi
    
    # Start application with PM2
    print_status "Starting application with PM2..."
    if [[ -n "$SUDO" ]]; then
        if $SUDO -u $POSTERRAMA_USER bash -l -c "which pm2 >/dev/null 2>&1"; then
            $SUDO -u $POSTERRAMA_USER bash -l -c "cd $POSTERRAMA_DIR && pm2 start ecosystem.config.js"
        else
            # Fallback to direct path
            $SUDO -u $POSTERRAMA_USER bash -c "cd $POSTERRAMA_DIR && /usr/local/bin/pm2 start ecosystem.config.js"
        fi
    else
        if su - $POSTERRAMA_USER -c "which pm2 >/dev/null 2>&1"; then
            su - $POSTERRAMA_USER -c "cd $POSTERRAMA_DIR && pm2 start ecosystem.config.js"
        else
            # Fallback to direct path
            su - $POSTERRAMA_USER -c "cd $POSTERRAMA_DIR && /usr/local/bin/pm2 start ecosystem.config.js"
        fi
    fi
    
    # Save PM2 configuration
    print_status "Saving PM2 configuration..."
    if [[ -n "$SUDO" ]]; then
        if $SUDO -u $POSTERRAMA_USER bash -l -c "which pm2 >/dev/null 2>&1"; then
            $SUDO -u $POSTERRAMA_USER bash -l -c "pm2 save"
        else
            # Fallback to direct path
            $SUDO -u $POSTERRAMA_USER bash -c "/usr/local/bin/pm2 save"
        fi
    else
        if su - $POSTERRAMA_USER -c "which pm2 >/dev/null 2>&1"; then
            su - $POSTERRAMA_USER -c "pm2 save"
        else
            # Fallback to direct path
            su - $POSTERRAMA_USER -c "/usr/local/bin/pm2 save"
        fi
    fi
    
    # Generate systemd service
    print_status "Generating systemd service..."
    if su - $POSTERRAMA_USER -c "which pm2 >/dev/null 2>&1"; then
        su - $POSTERRAMA_USER -c "cd $POSTERRAMA_DIR && pm2 startup systemd -u $POSTERRAMA_USER --hp $POSTERRAMA_DIR"
    else
        # Fallback to direct path
        su - $POSTERRAMA_USER -c "cd $POSTERRAMA_DIR && /usr/local/bin/pm2 startup systemd -u $POSTERRAMA_USER --hp $POSTERRAMA_DIR"
    fi
    
    # Enable and start the service
    $SUDO systemctl enable pm2-$POSTERRAMA_USER
    $SUDO systemctl start pm2-$POSTERRAMA_USER
    
    print_success "PM2 service configured and started"
}

# Function to display final information
show_completion_info() {
    local SERVER_IP=$(hostname -I | awk '{print $1}')
    
    echo ""
    echo "=================================================================="
    echo -e "${GREEN}🎉 Posterrama Installation Complete!${NC}"
    echo "=================================================================="
    echo ""
    echo -e "${BLUE}📍 Installation Directory:${NC} $POSTERRAMA_DIR"
    echo -e "${BLUE}👤 System User:${NC} $POSTERRAMA_USER"
    echo -e "${BLUE}🌐 Web Interface:${NC} http://$SERVER_IP:$DEFAULT_PORT"
    echo -e "${BLUE}⚙️  Admin Panel:${NC} http://$SERVER_IP:$DEFAULT_PORT/admin"
    echo ""
    echo -e "${YELLOW}📋 Next Steps:${NC}"
    echo "1. Open the admin panel in your browser"
    echo "2. Complete the initial setup wizard"
    echo "3. Connect your Plex server"
    echo "4. Configure your display settings"
    echo ""
    echo -e "${YELLOW}🔧 Management Commands:${NC}"
    if [[ -n "$SUDO" ]]; then
        echo "• View status:    ${SUDO} systemctl status pm2-$POSTERRAMA_USER"
        echo "• Stop service:   ${SUDO} systemctl stop pm2-$POSTERRAMA_USER"
        echo "• Start service:  ${SUDO} systemctl start pm2-$POSTERRAMA_USER"
        echo "• View logs:      ${SUDO} -u $POSTERRAMA_USER pm2 logs"
        echo "• Update:         cd $POSTERRAMA_DIR && ${SUDO} -u $POSTERRAMA_USER git pull && ${SUDO} -u $POSTERRAMA_USER npm install && ${SUDO} -u $POSTERRAMA_USER pm2 restart all"
    else
        echo "• View status:    systemctl status pm2-$POSTERRAMA_USER"
        echo "• Stop service:   systemctl stop pm2-$POSTERRAMA_USER"
        echo "• Start service:  systemctl start pm2-$POSTERRAMA_USER"
        echo "• View logs:      su - $POSTERRAMA_USER -c 'pm2 logs'"
        echo "• Update:         cd $POSTERRAMA_DIR && su - $POSTERRAMA_USER -c 'git pull && npm install && pm2 restart all'"
    fi
    echo ""
    echo -e "${GREEN}Enjoy your new digital movie poster display! 🎬${NC}"
    echo "=================================================================="
}

# Main installation function
main() {
    echo "=================================================================="
    echo "🎬 Posterrama Automated Installation"
    echo "=================================================================="
    echo ""
    
    print_status "Starting installation process..."
    
    # Perform installation steps
    check_root
    detect_os
    install_git
    install_nodejs
    install_pm2
    create_user
    install_posterrama
    configure_firewall
    setup_service
    
    # Show completion information
    show_completion_info
}

# Handle script interruption
trap 'print_error "Installation interrupted"; exit 1' INT TERM

# Run main function
main "$@"
