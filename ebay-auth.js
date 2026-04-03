/**
 * eBay 3-Legged OAuth — User authorization for Sell API
 * Flow: Generate auth URL → User visits → Callback captures code → Exchange for tokens
 */

'use strict';

const http = require('http');
const axios = require('axios');
const config = require('./config');
const Database = require('better-sqlite3');

const DB_PATH = './data/sonic_tracker.db';

const EBAY_APP_ID = process.env.EBAY_APP_ID || '';
const EBAY_CERT_ID = process.env.EBAY_CERT_ID || '';
const EBAY_AUTH_BASE = 'https://auth.ebay.com/oauth2';
const EBAY_TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';

// ── Authorization URL ────────────────────────────────────────────────────

function getAuthorizationUrl() {
  const scopes = config.ebaySell.scopes.join(' ');
  const redirectUri = config.ebaySell.redirectUri;

  const params = new URLSearchParams({
    client_id: EBAY_APP_ID,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: scopes
  });

  return `${EBAY_AUTH_BASE}/authorize?${params.toString()}`;
}

// ── Capture auth code via temporary HTTP server ──────────────────────────

function captureAuthCode() {
  return new Promise((resolve, reject) => {
    const port = config.ebaySell.callbackPort || 3000;
    const timeout = config.ebaySell.callbackTimeout || 300000;

    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${port}`);

      if (url.pathname === '/callback') {
        const code = url.searchParams.get('code');

        if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<html><body><h1>eBay Authorization Successful!</h1><p>You can close this window and return to Telegram.</p></body></html>');
          server.close();
          resolve(code);
        } else {
          const error = url.searchParams.get('error_description') || 'No authorization code received';
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`<html><body><h1>Authorization Failed</h1><p>${error}</p></body></html>`);
          server.close();
          reject(new Error(error));
        }
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    server.listen(port, () => {
      console.log(`OAuth callback server listening on port ${port}`);
    });

    // Timeout after 5 minutes
    const timer = setTimeout(() => {
      server.close();
      reject(new Error('Authorization timed out (5 minutes). Try /ebayauth again.'));
    }, timeout);

    server.on('close', () => clearTimeout(timer));
  });
}

// ── Exchange auth code for tokens ────────────────────────────────────────

async function exchangeCodeForTokens(code) {
  const basicAuth = Buffer.from(`${EBAY_APP_ID}:${EBAY_CERT_ID}`).toString('base64');

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code: code,
    redirect_uri: config.ebaySell.redirectUri
  });

  const resp = await axios.post(EBAY_TOKEN_URL, params.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${basicAuth}`
    },
    timeout: 15000
  });

  return {
    accessToken: resp.data.access_token,
    refreshToken: resp.data.refresh_token,
    expiresIn: resp.data.expires_in
  };
}

// ── Refresh expired token ────────────────────────────────────────────────

async function refreshAccessToken(refreshToken) {
  const basicAuth = Buffer.from(`${EBAY_APP_ID}:${EBAY_CERT_ID}`).toString('base64');
  const scopes = config.ebaySell.scopes.join(' ');

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: scopes
  });

  const resp = await axios.post(EBAY_TOKEN_URL, params.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${basicAuth}`
    },
    timeout: 15000
  });

  return {
    accessToken: resp.data.access_token,
    expiresIn: resp.data.expires_in
  };
}

// ── Store tokens in DB ───────────────────────────────────────────────────

function storeTokens(db, accessToken, refreshToken, expiresIn) {
  const expiresAt = Math.floor(Date.now() / 1000) + expiresIn - 60; // 60s buffer

  db.prepare(`
    INSERT OR REPLACE INTO auth_tokens (id, access_token, refresh_token, expires_at)
    VALUES (1, ?, ?, ?)
  `).run(accessToken, refreshToken, expiresAt);
}

// ── Get valid user token (auto-refresh if expired) ───────────────────────

async function getUserToken(db) {
  const row = db.prepare("SELECT * FROM auth_tokens WHERE id = 1").get();

  if (!row) {
    return null; // No tokens stored — user needs to run /ebayauth
  }

  const now = Math.floor(Date.now() / 1000);

  if (now < row.expires_at) {
    return row.access_token;
  }

  // Token expired — try refresh
  try {
    const refreshed = await refreshAccessToken(row.refresh_token);
    storeTokens(db, refreshed.accessToken, row.refresh_token, refreshed.expiresIn);
    return refreshed.accessToken;
  } catch (err) {
    console.error('Token refresh failed:', err.response?.data || err.message);
    return null; // Refresh token may be expired — user needs to re-auth
  }
}

// ── Full auth flow (called from bot command) ─────────────────────────────

async function runAuthFlow(db) {
  const authUrl = getAuthorizationUrl();

  // Start callback server and wait for code
  const codePromise = captureAuthCode();

  // Return the URL so the bot can send it to the user
  // The bot should send the URL, then await codePromise
  return {
    authUrl,
    waitForCode: async () => {
      const code = await codePromise;
      const tokens = await exchangeCodeForTokens(code);
      storeTokens(db, tokens.accessToken, tokens.refreshToken, tokens.expiresIn);
      return true;
    }
  };
}

module.exports = {
  getAuthorizationUrl,
  captureAuthCode,
  exchangeCodeForTokens,
  refreshAccessToken,
  storeTokens,
  getUserToken,
  runAuthFlow
};
