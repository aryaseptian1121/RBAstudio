// ============================================================
// RBA STUDIO PRO — auth.js (Authentication Module)
// ============================================================
const bcrypt = require('bcryptjs');
const axios = require('axios');
const fs     = require('fs');
const path   = require('path');

// Railway server URL
const RAILWAY_LOGIN_URL = 'https://rba-studio-app.up.railway.app/login';

// Use app.getPath from main process - will be set when required
let userDataPath = null;

function getUsersFile() {
    if (!userDataPath) {
        // Fallback - should be set by main process
        const { app } = require('electron');
        userDataPath = app.getPath('userData');
    }
    return path.join(userDataPath, 'users.json');
}

const SALT_ROUNDS = 12;

// Default admin user (password: admin123)
const DEFAULT_USER = {
    username: 'admin',
    passwordHash: '$2a$12$placeholderhashfordemo12345678901234567890123456789012', // admin123
    role: 'admin',
    createdAt: new Date().toISOString(),
    lastLogin: null,
    loginAttempts: 0,
    lockedUntil: null
};

function initUsers() {
    const usersFile = getUsersFile();
    const dir = path.dirname(usersFile);
    
    // Ensure directory exists
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    
    if (!fs.existsSync(usersFile)) {
        // Create default user with real hash
        const defaultUser = {
            ...DEFAULT_USER,
            passwordHash: bcrypt.hashSync('admin123', SALT_ROUNDS)
        };
        fs.writeFileSync(usersFile, JSON.stringify([defaultUser], null, 2));
    }
}

function getUsers() {
    initUsers();
    try {
        return JSON.parse(fs.readFileSync(getUsersFile(), 'utf8'));
    } catch (e) {
        return [];
    }
}

function saveUsers(users) {
    fs.writeFileSync(getUsersFile(), JSON.stringify(users, null, 2));
}

async function login(username, password) {
    // Step 1: Try local auth first (always works offline)
    const users = getUsers();
    const user = users.find(u => u.username === username);
    
    if (user && bcrypt.compareSync(password, user.passwordHash)) {
        user.lastLogin = new Date().toISOString();
        saveUsers(users);
        return { success: true, user: { username: user.username, role: user.role } };
    }

    // Step 2: If local fails, try Railway (for cloud-registered accounts)
    try {
        const response = await axios.post(RAILWAY_LOGIN_URL, 
            { username, password },
            { timeout: 8000, headers: { 'Content-Type': 'application/json' } }
        );
        if (response.data?.success) {
            return { success: true, user: response.data.user || { username, role: 'user' } };
        }
        return { success: false, reason: response.data?.reason || 'Login gagal' };
    } catch (error) {
        if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT' || !error.response) {
            return { success: false, reason: 'Username/password salah. Jika akun cloud, pastikan ada koneksi internet.' };
        }
        const status = error.response?.status;
        if (status === 401) return { success: false, reason: 'Username atau password salah' };
        return { success: false, reason: 'Server error: ' + (status || error.message) };
    }
}

function changePassword(username, oldPassword, newPassword) {
    if (newPassword.length < 8) {
        return { success: false, reason: 'Password minimal 8 karakter' };
    }
    
    const users = getUsers();
    const user  = users.find(u => u.username === username);
    
    if (!user) {
        return { success: false, reason: 'User tidak ditemukan' };
    }
    
    if (!bcrypt.compareSync(oldPassword, user.passwordHash)) {
        return { success: false, reason: 'Password lama salah' };
    }
    
    user.passwordHash = bcrypt.hashSync(newPassword, SALT_ROUNDS);
    saveUsers(users);
    
    return { success: true };
}

function registerUser(username, password, role = 'user') {
    const users = getUsers();
    
    // Check if username exists
    if (users.find(u => u.username === username)) {
        return { success: false, reason: 'Username sudah ada' };
    }
    
    const newUser = {
        username: username,
        passwordHash: bcrypt.hashSync(password, SALT_ROUNDS),
        role: role,
        createdAt: new Date().toISOString(),
        lastLogin: null,
        loginAttempts: 0,
        lockedUntil: null
    };
    
    users.push(newUser);
    saveUsers(users);
    
    return { success: true, user: { username: newUser.username, role: newUser.role } };
}

function setUserDataPath(basePath) {
    userDataPath = basePath;
}

module.exports = { 
    login, 
    changePassword, 
    initUsers,
    registerUser,
    setUserDataPath
};