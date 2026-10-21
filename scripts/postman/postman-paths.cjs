const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function getPostmanPaths() {
  const platform = process.platform;
  let appPath = '';
  let resourcesDir = '';
  let execPath = '';

  if (platform === 'darwin') {
    appPath = '/Applications/Postman.app';
    resourcesDir = path.join(appPath, 'Contents', 'Resources');
    execPath = path.join(appPath, 'Contents', 'MacOS', 'Postman');
  } else if (platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local');
    const postmanBase = path.join(localAppData, 'Postman');
    if (fs.existsSync(postmanBase)) {
      const appDirs = fs.readdirSync(postmanBase)
        .filter(f => f.startsWith('app-') && fs.statSync(path.join(postmanBase, f)).isDirectory())
        .sort();
      if (appDirs.length > 0) {
        const latestApp = appDirs[appDirs.length - 1];
        appPath = path.join(postmanBase, latestApp);
        resourcesDir = path.join(appPath, 'resources');
        execPath = path.join(appPath, 'Postman.exe');
      }
    }
  } else {
    // Linux
    const candidates = [
      '/opt/Postman/app/resources',
      '/usr/lib/postman/app/resources',
      path.join(process.env.HOME || '', '.local/share/Postman/app/resources'),
      '/var/lib/flatpak/app/com.getpostman.Postman/current/active/files/extra/Postman/app/resources',
      '/snap/postman/current/usr/share/postman/resources'
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        resourcesDir = c;
        appPath = path.dirname(resourcesDir);
        execPath = path.join(appPath, 'Postman');
        break;
      }
    }

    if (!execPath) {
      try {
        const bin = execSync('which postman', { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
        if (bin && fs.existsSync(bin)) {
          execPath = bin;
        }
      } catch (e) {}
    }
  }

  // Fallback chung nếu execPath chưa tìm thấy
  if (!execPath) {
    try {
      const cmd = process.platform === 'win32' ? 'where Postman.exe' : 'which postman';
      const out = execSync(cmd, { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim().split('\n')[0].trim();
      if (out && fs.existsSync(out)) {
        execPath = out;
      }
    } catch (e) {}
  }

  return {
    appPath,
    resourcesDir,
    execPath,
    asarPath: resourcesDir ? path.join(resourcesDir, 'app.asar') : ''
  };
}

module.exports = { getPostmanPaths };
