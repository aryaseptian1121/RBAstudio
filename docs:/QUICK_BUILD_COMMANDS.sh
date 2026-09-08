#!/bin/bash
# RBA Studio Pro — Quick Build Commands
# Copy-paste these commands into terminal

# ========================================
# STEP 1: One-time Setup (First Time Only)
# ========================================

# cd to project
cd "~/dev/rba-studio-pro"

# Verify Node.js installed
node --version    # Should be v16+
npm --version     # Should be v7+

# Install all dependencies
npm install

# ========================================
# STEP 2: Prepare Assets
# ========================================

# Create assets folder if doesn't exist
mkdir -p assets

# IMPORTANT: Add icon files to assets/
# - Windows: assets/icon.ico (256x256 pixels)
# - macOS: assets/icon.icns (512x512 pixels, optional)
# 
# If you don't have icons, you can:
# 1. Generate using online tools
# 2. Use existing icons from your design files
# 3. Temporarily disable icons: edit package.json, set icon: null

# ========================================
# STEP 3: Build for Distribution
# ========================================

# Option A: Build Windows NSIS Installer
npm run build

# Option B: Build macOS DMG
npm run build:mac

# Option C: Build Both
npm run build:all

# ========================================
# STEP 4: Find Built Installers
# ========================================

# Check dist folder
ls -lh dist/

# You should see:
# - dist/RBA Studio Pro-Setup-1.0.0.exe       (Windows installer)
# - dist/RBA Studio Pro-1.0.0-portable.exe    (Windows portable)
# - dist/RBA Studio Pro-1.0.0.dmg             (macOS installer)
# - dist/RBA Studio Pro-1.0.0.zip             (macOS archive)

# ========================================
# STEP 5: Test Installers
# ========================================

# Windows: Run installer
"dist/RBA Studio Pro-Setup-1.0.0.exe"

# macOS: Open DMG
open "dist/RBA Studio Pro-1.0.0.dmg"

# ========================================
# STEP 6: Distribute
# ========================================

# Copy .exe or .dmg files to distribution location
# - Upload to website
# - Create GitHub Release
# - Share with users

# ========================================
# ADDITIONAL HELPFUL COMMANDS
# ========================================

# Run app in development
npm start

# Run app with debugger
npm run dev

# Check for errors before build
npm run build -- --dry-run

# Remove dist folder (clean build)
rm -rf dist/

# Check Node modules size
du -sh node_modules/

# List all npm scripts
npm run

# ========================================
# TROUBLESHOOTING COMMANDS
# ========================================

# If get "icon not found" error:
# Edit package.json and set "icon": null temporarily

# If get "scrcpy not found" warning:
# Make sure scrcpy/ folder exists with all files

# If installer is too large:
npm ls --all    # Check what's installed
npm prune       # Remove dev dependencies

# Clear npm cache
npm cache clean --force

# Reinstall everything fresh
rm -rf node_modules package-lock.json
npm install

# ========================================
# FOR NEXT BUILDS
# ========================================

# Just run:
npm run build      # Windows
npm run build:mac  # macOS
npm run build:all  # Both

# Built files will be in dist/ folder

# ========================================
# DOCUMENTATION
# ========================================

# For detailed info, see:
cat BUILD_GUIDE.md                    # Full build guide
cat BUILD_SETUP_CHECKLIST.md          # Setup verification checklist

# ========================================
# SUPPORT
# ========================================

# If issues occur:
# 1. Check BUILD_GUIDE.md troubleshooting section
# 2. Verify all files are in project root
# 3. Try clean build: npm install && npm run build
# 4. Check electron-builder docs: https://www.electron.build/

# Created: May 5, 2026
# Project: RBA Studio Pro
