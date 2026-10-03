import { app, BrowserWindow, Menu, shell, dialog } from 'electron';
import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createRadarServer } from '../src/appServer.js';

let window;
let server;
let origin;
const token = randomBytes(32).toString('hex');
const locked = app.requestSingleInstanceLock();
if (!locked) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
  app.whenReady().then(async () => {
    const workspaceRoot = process.env.OPENJOB_RADAR_HOME || app.getPath('userData');
    await mkdir(join(workspaceRoot, 'data'), { recursive: true });
    server = createRadarServer({ workspaceRoot, authToken: token });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    origin = `http://127.0.0.1:${server.address().port}`;
    window = new BrowserWindow({ width: 1240, height: 900, minWidth: 760, minHeight: 600,
      title: 'OpenJob Radar', backgroundColor: '#101321', show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
    const session = window.webContents.session;
    session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.setPermissionCheckHandler(() => false);
    session.webRequest.onBeforeSendHeaders({ urls: [origin + '/*'] }, (details, callback) => {
      callback({ requestHeaders: { ...details.requestHeaders, 'X-Radar-Token': token } });
    });
    const external = (value) => {
      try { const url = new URL(value); if (url.protocol === 'https:' && !url.username && !url.password) shell.openExternal(url.href); } catch {}
    };
    window.webContents.setWindowOpenHandler(({ url }) => { external(url); return { action: 'deny' }; });
    window.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== origin) { event.preventDefault(); external(url); } });
    window.webContents.on('will-attach-webview', (event) => event.preventDefault());
    window.on('close', (event) => {
      if (server.radarBusy?.()) { event.preventDefault(); dialog.showMessageBox(window, { type: 'info', message: '공고 작업이 진행 중입니다.', detail: '안전하게 저장한 뒤 프로그램을 닫아 주세요.' }); }
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: '파일', submenu: [
        { label: '데이터 폴더 열기', click: () => shell.openPath(join(workspaceRoot, 'data')) },
        { type: 'separator' }, { role: 'quit', label: '종료' } ] },
      { label: '편집', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      { label: '보기', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
      { label: '도움말', submenu: [{ label: 'OpenJob Radar 정보', click: () => dialog.showMessageBox(window, { message: `OpenJob Radar ${app.getVersion()}`, detail: '내 컴퓨터에서 수집하고 검토하는 채용 공고 도구\n데이터는 설치 폴더와 별도로 보관됩니다.' }) }] },
    ]));
    await window.loadURL(origin);
    window.show();
  }).catch((error) => { dialog.showErrorBox('실행하지 못했습니다', error.message); app.quit(); });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => server?.close());
}
