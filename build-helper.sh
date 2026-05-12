#!/bin/bash
# RBA Studio Pro — Build Helper Script
# Usage: bash build-helper.sh [windows|mac|all]

set -e

echo "🚀 RBA Studio Pro — Build Helper"
echo "=================================="
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js tidak ditemukan. Install Node.js 16+ dari https://nodejs.org"
    exit 1
fi

echo "✓ Node.js: $(node --version)"
echo "✓ npm: $(npm --version)"
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
    echo "✓ Dependencies installed"
    echo ""
fi

# Check required files
echo "📋 Checking required files..."
if [ ! -f "main.js" ]; then
    echo "❌ main.js not found"
    exit 1
fi

if [ ! -d "scrcpy" ]; then
    echo "⚠️  Warning: scrcpy folder not found. Build will continue but scrcpy won't be available."
fi

echo "✓ All required files present"
echo ""

# Build target
TARGET=${1:-all}

case $TARGET in
    windows|win)
        echo "🔨 Building Windows NSIS Installer..."
        npm run dist:win
        ;;
    mac|macos)
        echo "🔨 Building macOS DMG..."
        npm run dist:mac
        ;;
    all)
        echo "🔨 Building Windows..."
        npm run dist:win
        echo ""
        echo "🔨 Building macOS..."
        npm run dist:mac
        ;;
    *)
        echo "❌ Unknown target: $TARGET"
        echo "Usage: bash build-helper.sh [windows|mac|all]"
        exit 1
        ;;
esac

echo ""
echo "✅ Build complete!"
echo ""
echo "📦 Installers available in dist/ folder:"
ls -lh dist/*.exe dist/*.dmg 2>/dev/null || echo "   (Check dist/ folder for output)"
echo ""
echo "💡 Next steps:"
echo "   1. Test the installer"
echo "   2. Verify application launches"
echo "   3. Test scrcpy functionality"
echo ""
