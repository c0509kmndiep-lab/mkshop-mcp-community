/**
 * Postman AI Credits Usage Module (100% Native Postman Gateway)
 * Sử dụng trực tiếp Native Desktop Gateway: bifrost-premium-https-v4.gw.postman.com/ws/proxy
 * Xác thực bằng x-access-token lấy tự động từ Postman Desktop (localStorage.access_token).
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const { DATA_JSON_PATH: AKI_DATA_JSON } = require('./postman-data-paths.cjs');

function getStoredAccessToken() {
  if (fs.existsSync(AKI_DATA_JSON)) {
    try {
      const data = JSON.parse(fs.readFileSync(AKI_DATA_JSON, 'utf8'));
      if (data && data['access_token']) return data['access_token'];
    } catch (e) {}
  }
  if (process.env.POSTMAN_ACCESS_TOKEN) {
    return process.env.POSTMAN_ACCESS_TOKEN.trim();
  }
  return null;
}

function bifrostProxyRequest(token, service, method, reqPath, teamId = '') {
  return new Promise((resolve) => {
    const postData = JSON.stringify({ service, method, path: reqPath });
    const headers = {
      'content-type': 'application/json',
      'x-access-token': token,
      'x-app-version': '12.25.7',
      'user-agent': 'Postman/12.25.7'
    };
    if (teamId) {
      headers['x-entity-team-id'] = String(teamId);
    }

    const req = https.request({
      hostname: 'bifrost-premium-https-v4.gw.postman.com',
      port: 443,
      path: '/ws/proxy',
      method: 'POST',
      headers: headers,
      timeout: 8000
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({ ok: true, data: JSON.parse(data) });
        } catch (e) {
          resolve({ ok: false, error: 'bad response body' });
        }
      });
    });

    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.write(postData);
    req.end();
  });
}

function extractCredits(body) {
  const op = body && body.operation;
  if (!op || typeof op.limit === 'undefined') return null;
  return {
    used: Math.ceil((op.usage || 0) / 1000),
    limit: Math.floor((op.limit || 0) / 1000),
    percent: op.limit > 0 ? Math.round(((op.usage || 0) / op.limit) * 100) : 0,
    resetAt: (op.usageCycle && op.usageCycle.end) || null
  };
}

async function fetchAllUsage(customToken = null) {
  const token = customToken || getStoredAccessToken();
  if (!token) return { error: 'NO_TOKEN', message: 'No access token available in Postman Desktop' };

  try {
    const teamsRes = await bifrostProxyRequest(token, 'iapub', 'GET', '/api/users/teams');
    if (!teamsRes.ok) return { error: 'FETCH_ERROR', message: teamsRes.error };

    const rawTeams = teamsRes.data && teamsRes.data.teams;
    if (!Array.isArray(rawTeams) || rawTeams.length === 0) {
      return { error: 'AUTH_EXPIRED', message: 'Access token is invalid or expired' };
    }

    const teams = rawTeams.map(t => ({
      slug: String(t.domain || t.name),
      team_id: String(t.id),
      name: t.name || t.domain
    }));

    const results = await Promise.all(teams.map(async (t) => {
      const path = `/usage/operation/ai_millicredits/team/${t.team_id}`;
      const quotaRes = await bifrostProxyRequest(token, 'usage', 'get', path, t.team_id);
      return {
        ...t,
        quota: quotaRes.ok ? extractCredits(quotaRes.data) : null
      };
    }));

    return {
      success: true,
      updatedAt: new Date().toLocaleTimeString(),
      teams: results
    };
  } catch (err) {
    return { error: 'FETCH_ERROR', message: err.message };
  }
}

module.exports = {
  fetchAllUsage,
};
