/* eslint-disable global-require */
import path from 'path';
import { app, BrowserWindow, ipcMain, shell, screen } from 'electron';
import { autoUpdater } from 'electron-updater';

import { version } from '../../package.json';
import MenuBuilder from './menu';
import { resolveHtmlPath } from './util';

let mainWindow: BrowserWindow | null = null;
let loadingScreen: BrowserWindow | null = null;
let isLoading = false;

if (process.env.NODE_ENV === 'production') {
  const sourceMapSupport = require('source-map-support');
  sourceMapSupport.install();
}

const isDebug =
  process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true';

if (isDebug) {
  require('electron-debug')();
}

const installExtensions = async () => {
  const installer = require('electron-devtools-installer');
  const forceDownload = !!process.env.UPGRADE_EXTENSIONS;
  const extensions = ['REACT_DEVELOPER_TOOLS'];

  return installer
    .default(
      extensions.map((name) => installer[name]),
      forceDownload,
    )
    .catch(console.log);
};

const checkForUpdates = async (): Promise<boolean | null> => {
  try {
    const result = await autoUpdater.checkForUpdates();
    const updateAvailable = result && result.updateInfo.version !== version;
    const updateDownloaded = result && result.downloadPromise !== undefined;
    return updateAvailable && !updateDownloaded;
  } catch (error) {
    console.error('Error checking for updates:', error);
    return false;
  }
};

const createWindow = async () => {
  if (isDebug) {
    await installExtensions();
  }

  const RESOURCES_PATH = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, '../../assets');

  const getAssetPath = (...paths: string[]): string => {
    return path.join(RESOURCES_PATH, ...paths);
  };

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    show: false,
    width,
    height,
    icon: getAssetPath('icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: app.isPackaged
        ? path.join(__dirname, 'preload.js')
        : path.join(__dirname, '../../.erb/dll/preload.js'),
    },
  });

  loadingScreen = new BrowserWindow({
    width: 400,
    height: 400,
    show: false,
    frame: false,
    transparent: true,
    titleBarOverlay: false,
    titleBarStyle: 'hidden',
    alwaysOnTop: true,
  });

  loadingScreen.loadURL(resolveHtmlPath('index.html'));

  loadingScreen.on('closed', () => {
    loadingScreen = null;
  });

  loadingScreen.webContents.on('did-finish-load', async () => {
    const updateAvailable = await checkForUpdates();
    if (updateAvailable) {
      console.log('Update available, downloading now...');
      autoUpdater.downloadUpdate();

      autoUpdater.on('update-downloaded', () => {
        console.log('Update downloaded, will quit and install now.');
        autoUpdater.quitAndInstall();
      });

      autoUpdater.on('error', (error) => {
        console.error('Error downloading update:', error);
      });

      autoUpdater.on('download-progress', (progress) => {
        ipcMain.emit('download-progress', progress.percent);
      });
    } else {
      console.log('No update available or already downloaded.');
    }
  });

  mainWindow.webContents.on('did-start-loading', () => {
    if (!isLoading) {
      loadingScreen?.show();
      isLoading = true;
    }
  });

  mainWindow.webContents.on('did-finish-load', () => {
    /*setTimeout(() => {
      if (loadingScreen) {
        loadingScreen.close();
      }
      mainWindow?.show();
      mainWindow?.focus();
    }, 4000);*/
  });

  mainWindow.loadURL('http://localhost:3000');

  mainWindow.setMenu(null);

  mainWindow.on('ready-to-show', () => {
    if (!mainWindow) {
      throw new Error('"mainWindow" is not defined');
    }
    if (process.env.START_MINIMIZED) {
      mainWindow.minimize();
    } else {
      // mainWindow.show();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const menuBuilder = new MenuBuilder(mainWindow);
  menuBuilder.buildMenu();

  mainWindow.webContents.setWindowOpenHandler((edata) => {
    shell.openExternal(edata.url);
    return { action: 'deny' };
  });
};

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app
  .whenReady()
  // eslint-disable-next-line promise/always-return
  .then(() => {
    createWindow();
    app.on('activate', () => {
      if (mainWindow === null) createWindow();
    });
  })
  .catch(console.log);
