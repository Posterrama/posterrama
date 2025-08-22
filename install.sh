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
            return 0
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
    
    # Verify installation
    if command -v node >/dev/null 2>&1; then
        NODE_VERSION=$(node --version)
        print_success "Node.js $NODE_VERSION installed successfully"
    else
        print_error "Failed to install Node.js"
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
    
    if command -v pm2 >/dev/null 2>&1; then
        print_success "PM2 is already installed"
        return 0
    fi
    
    npm install -g pm2
    
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
    
    # Create directory if it doesn't exist
    mkdir -p $POSTERRAMA_DIR
    
    # Clone repository
    if [[ -d "$POSTERRAMA_DIR/.git" ]]; then
        print_status "Updating existing Posterrama installation..."
        cd $POSTERRAMA_DIR
        sudo -u $POSTERRAMA_USER git pull
    else
        print_status "Cloning Posterrama repository..."
        sudo -u $POSTERRAMA_USER git clone https://github.com/Posterrama/posterrama.git $POSTERRAMA_DIR
        cd $POSTERRAMA_DIR
    fi
    
    # Install dependencies
    print_status "Installing Node.js dependencies..."
    sudo -u $POSTERRAMA_USER npm install
    
    # Copy configuration file
    if [[ ! -f "$POSTERRAMA_DIR/config.json" ]]; then
        print_status "Creating initial configuration..."
        sudo -u $POSTERRAMA_USER cp config.example.json config.json
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
    
    # Start application with PM2
    sudo -u $POSTERRAMA_USER pm2 start ecosystem.config.js
    
    # Save PM2 configuration
    sudo -u $POSTERRAMA_USER pm2 save
    
    # Generate systemd service
    su - $POSTERRAMA_USER -c "cd $POSTERRAMA_DIR && pm2 startup systemd -u $POSTERRAMA_USER --hp $POSTERRAMA_DIR"
    
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
