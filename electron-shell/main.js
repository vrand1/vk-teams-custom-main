const { app, BrowserWindow, shell, session } = require('electron');
const fs = require('fs');
const path = require('path');

const { prepare } = require('./prepare-extension');
const INJECT_FILE = path.join(__dirname, 'inject-reactions.js');
const START_URL = process.env.VK_WORKSPACE_URL || 'https://myteam.mail.ru/webim/';
const SHELL_UA_MARKER = 'VKTeamsCustomShell/1.0';

const IN_APP_HOST_SUFFIXES = [
    '.workspace.vk.ru',
    '.vk.ru',
    '.vk.com',
    '.vk.team',
    '.mail.ru',
    '.myteam.mail.ru',
    '.bizml.ru',
    '.teams.your-organization.com'
];

let mainWindow = null;
let injectSource = null;
let injectTimer = null;
let extensionDir = null;

function resolveExtensionDir() {
    if (app.isPackaged) {
        return path.join(process.resourcesPath, 'vk-teams-extension');
    }
    return prepare();
}

function getInjectSource() {
    if (!injectSource) {
        injectSource = fs.readFileSync(INJECT_FILE, 'utf8');
    }
    return injectSource;
}

function isAllowedInApp(url) {
    if (!url || !/^https?:/i.test(url)) {
        return false;
    }
    try {
        const { hostname, pathname } = new URL(url);
        const host = hostname.toLowerCase();
        const p = pathname.toLowerCase();
        if (/\/(login|oauth|auth|sso)(\/|$|\?)/i.test(p)) {
            return true;
        }
        return IN_APP_HOST_SUFFIXES.some((suffix) => host === suffix.slice(1) || host.endsWith(suffix));
    } catch (e) {
        return false;
    }
}

function isMessengerFrameUrl(url) {
    if (!url || !/^https?:/i.test(url)) {
        return false;
    }
    return /myteam\.mail\.ru|workspace\.vk\.ru|bizml\.ru|teams\./i.test(url);
}

async function ensureExtensionLoaded() {
    const ses = session.defaultSession;
    try {
        if (typeof ses.loadExtension === 'function') {
            const ext = await ses.loadExtension(extensionDir, { allowFileAccess: true });
            console.log('[shell] Extension loaded (optional):', ext.name);
            return ext;
        }
    } catch (err) {
        console.warn('[shell] loadExtension skipped:', err.message);
    }
    return null;
}

async function injectFrame(frame) {
    if (!frame || frame.isDestroyed()) {
        return;
    }
    const url = frame.url || '';
    if (!isMessengerFrameUrl(url)) {
        return;
    }
    const wrapped = `(function(){try{${getInjectSource()}}catch(e){console.error('[VK Teams Electron Inject]',e);}})();`;
    try {
        await frame.executeJavaScript(wrapped, true);
    } catch (e) {
        
    }
}

async function injectAllFrames(webContents) {
    if (!webContents || webContents.isDestroyed()) {
        return;
    }
    try {
        const frames = webContents.mainFrame.framesInSubtree || [];
        for (const frame of frames) {
            await injectFrame(frame);
        }
    } catch (e) {
        console.warn('[shell] inject frames:', e.message);
    }
}

function startInjectLoop(webContents) {
    if (injectTimer) {
        clearInterval(injectTimer);
    }
    const run = () => injectAllFrames(webContents);
    run();
    injectTimer = setInterval(run, 2500);
}

function openAuthPopup(url) {
    const popup = new BrowserWindow({
        parent: mainWindow,
        modal: false,
        width: 520,
        height: 720,
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false
        }
    });
    popup.loadURL(url);
    popup.on('closed', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.reload();
        }
    });
}

function attachWindow(webContents) {
    webContents.setUserAgent(`${webContents.getUserAgent()} ${SHELL_UA_MARKER}`);

    webContents.setWindowOpenHandler(({ url }) => {
        if (!/^https?:/i.test(url)) {
            return { action: 'deny' };
        }
        if (isAllowedInApp(url)) {
            openAuthPopup(url);
            return { action: 'deny' };
        }
        shell.openExternal(url);
        return { action: 'deny' };
    });

    webContents.on('did-finish-load', () => {
        startInjectLoop(webContents);
    });

    webContents.on('did-frame-finish-load', () => {
        injectAllFrames(webContents);
    });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 840,
        minWidth: 900,
        minHeight: 600,
        title: 'VK WorkSpace (Custom Reactions)',
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
            webviewTag: true
        }
    });

    attachWindow(mainWindow.webContents);
    mainWindow.loadURL(START_URL);
}

app.whenReady().then(async () => {
    extensionDir = resolveExtensionDir();
    if (!fs.existsSync(extensionDir)) {
        console.error('[shell] Extension folder missing:', extensionDir);
    }
    await ensureExtensionLoaded();
    createWindow();
});

app.on('window-all-closed', () => {
    if (injectTimer) {
        clearInterval(injectTimer);
    }
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
