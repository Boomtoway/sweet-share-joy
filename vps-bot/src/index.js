import 'dotenv/config';
import express from 'express';
import pino from 'pino';
import QRCode from 'qrcode';
import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  Browsers,
} from '@whiskeysockets/baileys';

const log = pino({ level: 'info' });

const {
  PORT = 3000,
  API_TOKEN,
  LOVABLE_WEBHOOK_URL,
  WORKSPACE_ID,
  WEBHOOK_SECRET,
  AUTH_DIR = './sessions',
} = process.env;

if (!API_TOKEN) throw new Error('API_TOKEN required');
if (!LOVABLE_WEBHOOK_URL) throw new Error('LOVABLE_WEBHOOK_URL required');
if (!WORKSPACE_ID || !WEBHOOK_SECRET) throw new Error('WORKSPACE_ID and WEBHOOK_SECRET required');

let sock = null;
let currentQR = null;
let connState = 'disconnected'; // disconnected | connecting | connected
let lastError = null;

async function startSock() {
  connState = 'connecting';
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: Browsers.ubuntu('StartAppLK Bot'),
    logger: pino({ level: 'warn' }),
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect, qr } = u;
    if (qr) {
      currentQR = await QRCode.toDataURL(qr);
      log.info('QR refreshed');
    }
    if (connection === 'open') {
      connState = 'connected';
      currentQR = null;
      lastError = null;
      log.info('WhatsApp connected');
    }
    if (connection === 'close') {
      connState = 'disconnected';
      const code = lastDisconnect?.error?.output?.statusCode;
      lastError = lastDisconnect?.error?.message ?? null;
      const loggedOut = code === DisconnectReason.loggedOut;
      log.warn({ code, loggedOut }, 'connection closed');
      if (!loggedOut) setTimeout(() => startSock().catch((e) => log.error(e)), 2000);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const m of messages) {
      try {
        if (!m.message || m.key.fromMe) continue;
        const remoteJid = m.key.remoteJid;
        if (!remoteJid || remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast') continue;

        const body =
          m.message.conversation ??
          m.message.extendedTextMessage?.text ??
          m.message.imageMessage?.caption ??
          m.message.videoMessage?.caption ??
          '';

        const from = remoteJid.split('@')[0];
        const name = m.pushName ?? from;

        const res = await fetch(LOVABLE_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workspace_id: WORKSPACE_ID,
            secret: WEBHOOK_SECRET,
            from,
            contact_name: name,
            body,
            external_id: m.key.id,
          }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          log.error({ status: res.status, data }, 'webhook failed');
          continue;
        }

        if (data.replied && data.reply) {
          const delayMs = Math.max(1, Number(data.delay_seconds ?? 3)) * 1000;
          await sock.sendPresenceUpdate('composing', remoteJid);
          await new Promise((r) => setTimeout(r, delayMs));
          await sock.sendPresenceUpdate('paused', remoteJid);
          await sock.sendMessage(remoteJid, { text: data.reply });
        }
      } catch (e) {
        log.error(e, 'message handler error');
      }
    }
  });
}

// ---------- HTTP API ----------
const app = express();
app.use(express.json({ limit: '1mb' }));

// CORS — allow browser calls from the Lovable app
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

app.options('*', (_req, res) => res.status(204).end());

app.use((req, res, next) => {
  const auth = req.headers.authorization ?? '';
  if (auth !== `Bearer ${API_TOKEN}`) return res.status(401).json({ error: 'unauthorized' });
  next();
});

app.get('/api/bot/session-status', (_req, res) => {
  res.json({ status: connState, has_qr: !!currentQR, error: lastError });
});

// alias for spec
app.get('/status', (_req, res) =>
  res.json({ status: connState, has_qr: !!currentQR, error: lastError }),
);

app.get('/api/bot/qr', (_req, res) => {
  if (!currentQR) return res.status(404).json({ error: 'no qr available', status: connState });
  res.json({ qr: currentQR, status: connState });
});
app.get('/qr', (req, res, next) => {
  req.url = '/api/bot/qr';
  app._router.handle(req, res, next);
});

app.post('/api/bot/restart', async (_req, res) => {
  try {
    try { sock?.end(new Error('manual restart')); } catch {}
    await startSock();
    res.json({ ok: true, status: connState });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.post('/restart', (req, res, next) => {
  req.url = '/api/bot/restart';
  app._router.handle(req, res, next);
});

app.post('/api/bot/disconnect', async (_req, res) => {
  try {
    await sock?.logout();
    connState = 'disconnected';
    currentQR = null;
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/send', async (req, res) => {
  try {
    const { to, message } = req.body ?? {};
    if (!to || !message) return res.status(400).json({ error: 'to and message required' });
    if (connState !== 'connected') return res.status(409).json({ error: 'not connected' });
    const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;
    const sent = await sock.sendMessage(jid, { text: String(message) });
    res.json({ ok: true, id: sent?.key?.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => log.info(`Bot HTTP on :${PORT}`));
startSock().catch((e) => log.error(e, 'startSock failed'));
