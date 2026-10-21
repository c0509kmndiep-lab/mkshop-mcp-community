// The Postman daemon's runtime files, in the main server's data dir (scripts/userdata.js USER_DIR): one definition for the daemon, the panel-side reader, the usage reader and the pid file, which all meet across a process boundary.
// CommonJS because the daemon cannot import ESM; the env var is what userdata.js exports to child processes.
const os = require('os');
const path = require('path');

const AKI_DATA_DIR = process.env.AKI_DATA_DIR || path.join(os.homedir(), '.aki', 'mcpsv');

module.exports = {
  AKI_DATA_DIR,
  DATA_JSON_PATH: path.join(AKI_DATA_DIR, 'data.json'),
  OWNERSHIP_STATUS_PATH: path.join(AKI_DATA_DIR, 'ownership-status.json'),
  NEW_WINDOW_FLAG_PATH: path.join(AKI_DATA_DIR, 'new-window.flag'),
  PID_PATH: path.join(AKI_DATA_DIR, 'daemon.pid'),
};
