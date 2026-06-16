import 'dotenv/config';
import express from 'express';
import path from 'path';
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

const AUTH_FOLDER_PATH = path.resolve(process.cwd(), AUTH_DIR);
const AUTH_PATHS = {
  auth_dir_config: AUTH_DIR,
  cwd: process.cwd(),
  auth_folder_path: AUTH_FOLDER_PATH,
  session_path: AUTH_FOLDER_PATH,
  session_files_pattern: path.join(AUTH_FOLDER_PATH, 'session-*.json'),
  credentials_file_path: path.join(AUTH_FOLDER_PATH, 'creds.json'),
};

let sock = null;
let currentQR = null;
let connState = 'disconnected'; // disconnected | connecting | connected
let lastError = null;

async function startSock() {
  connState = 'connecting';
  log.info(AUTH_PATHS, 'Baileys auth storage paths');
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER_PATH);
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
        const rawJid = m.key.remoteJid;
        if (!rawJid || rawJid.endsWith('@g.us') || rawJid === 'status@broadcast') continue;

        // Resolve the real WhatsApp phone JID. For LID messages, Baileys
        // exposes the phone-number variant via key.senderPn / key.remoteJidAlt.
        const altCandidates = [
          m.key.senderPn,
          m.key.remoteJidAlt,
          m.key.participantPn,
          rawJid,
        ].filter(Boolean);
        const phoneJid =
          altCandidates.find((j) => typeof j === 'string' && j.endsWith('@s.whatsapp.net')) ?? null;

        if (!phoneJid) {
          log.warn({ rawJid, altCandidates }, 'skip: no phone JID resolvable (LID only)');
          continue;
        }

        const remoteJid = phoneJid;           // canonical @s.whatsapp.net JID
        const from = remoteJid.split('@')[0]; // real phone number, e.g. 94740123466

        const body =
          m.message.conversation ??
          m.message.extendedTextMessage?.text ??
          m.message.imageMessage?.caption ??
          m.message.videoMessage?.caption ??
          '';
        const name = m.pushName ?? from;

        const res = await fetch(LOVABLE_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-bot-secret': WEBHOOK_SECRET },
          body: JSON.stringify({
            workspace_id: WORKSPACE_ID,
            secret: WEBHOOK_SECRET,
            from,
            remote_jid: remoteJid,
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
  res.json({ status: connState, has_qr: !!currentQR, error: lastError, auth_paths: AUTH_PATHS });
});

// alias for spec
app.get('/status', (_req, res) =>
  res.json({ status: connState, has_qr: !!currentQR, error: lastError, auth_paths: AUTH_PATHS }),
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

    // Normalize to bare digits (E.164 without '+').
    let digits = String(to).trim().split('@')[0].replace(/\D/g, '');
    if (digits.startsWith('0')) digits = `94${digits.slice(1)}`;
    if (!/^[0-9]{10,15}$/.test(digits)) {
      log.error({ to, digits }, 'SEND_INVALID_NUMBER');
      return res.status(400).json({ error: 'invalid whatsapp number', to, digits });
    }

    log.info({ to, digits }, 'SEND_LOOKUP_START');

    // CRITICAL: Baileys' sendMessage returns a "sent" key even when the JID
    // is not actually registered on WhatsApp (or when the account uses the
    // new LID identity and @s.whatsapp.net silently fails). onWhatsApp()
    // returns the authoritative JID we should send to.
    let onWa;
    try {
      const results = await sock.onWhatsApp(digits);
      onWa = Array.isArray(results) ? results[0] : null;
    } catch (e) {
      log.error({ digits, err: e?.message }, 'SEND_LOOKUP_ERROR');
      return res.status(502).json({ error: 'whatsapp lookup failed', detail: e?.message });
    }

    if (!onWa?.exists) {
      log.error({ digits, onWa }, 'SEND_NUMBER_NOT_ON_WHATSAPP');
      return res.status(404).json({ error: 'number not on whatsapp', digits, onWa });
    }

    const jid = onWa.jid || onWa.lid || `${digits}@s.whatsapp.net`;
    log.info({ digits, jid, lid: onWa.lid ?? null, exists: onWa.exists }, 'SEND_LOOKUP_OK');

    log.info({ to, jid, digits }, 'SEND_DISPATCH');
    const sent = await sock.sendMessage(jid, { text: String(message) });
    log.info({ id: sent?.key?.id, jid, digits }, 'SEND_DISPATCH_OK');
    res.json({ ok: true, id: sent?.key?.id, jid, digits, lid: onWa.lid ?? null });
  } catch (e) {
    log.error({ err: e?.message, stack: e?.stack }, 'SEND_FAILED');
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => log.info(`Bot HTTP on :${PORT}`));
startSock().catch((e) => log.error(e, 'startSock failed'));
