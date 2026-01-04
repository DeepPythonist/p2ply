#!/bin/bash
cd "$(dirname "$0")"

echo "=========================================================="
echo "    P2Ply Universal Installer (MacOS)"
echo "=========================================================="
echo ""
echo "[!] IMPORTANT: PLEASE TURN ON YOUR VPN NOW! [!]"
echo ""
echo "Press ENTER to continue..."
read

# Helper function
exists() {
  command -v "$1" >/dev/null 2>&1
}

# 1. Check & Install Git
if ! exists git; then
    echo "[!] Git not found. Triggering Xcode command line tools install..."
    xcode-select --install
    echo "Please run this script again after installation completes."
    exit 1
fi

# 2. Check Homebrew (Required for easy automation)
if ! exists brew; then
    if ! exists python3 || ! exists node; then
        echo "[!] Homebrew is missing. Installing Homebrew..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        
        # Add brew to path for this session if needed
        eval "$(/opt/homebrew/bin/brew shellenv)" 2>/dev/null
        eval "$(/usr/local/bin/brew shellenv)" 2>/dev/null
    fi
fi

# 3. Check & Install Python
if ! exists python3; then
    echo "[!] Python 3 not found. Installing via Homebrew..."
    brew install python
fi

# 4. Check & Install Node.js
if ! exists node; then
    echo "[!] Node.js not found. Installing via Homebrew..."
    brew install node
fi

echo ""
echo "[+] All tools are ready."

# 5. Clone or Update Repo
if [ -d "p2ply" ]; then
    echo "[*] Updating p2ply..."
    cd p2ply
    git pull
else
    echo "[*] Cloning p2ply repository..."
    git clone https://github.com/DeepPythonist/p2ply.git
    cd p2ply
fi

# 6. Install Dependencies & Run
echo ""
echo "[*] Installing project dependencies..."
npm install

echo ""
echo "[*] Launching P2Ply..."
# Ensure browser open works
python3 launcher.py
