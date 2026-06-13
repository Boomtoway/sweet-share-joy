# StartAppLK WhatsApp Bot (Baileys)

Node.js WhatsApp bot using [Baileys](https://github.com/WhiskeySockets/Baileys). Runs on any VPS, connects via QR (multi-device), persists session in `./auth`, auto-reconnects, and forwards every incoming message to your Lovable app webhook. The Lovable app returns the AI reply, and the bot sends it back to WhatsApp.

## Endpoints

All endpoints require `Authorization: Bearer <API_TOKEN>`.

| Method | Path                        | Purpose                          |
| ------ | --------------------------- | -------------------------------- |
| GET    | `/status` or `/api/bot/session-status` | Connection state          |
| GET    | `/qr` or `/api/bot/qr`      | Current QR (data URL PNG)        |
| POST   | `/restart` or `/api/bot/restart` | Restart socket              |
| POST   | `/api/bot/disconnect`       | Logout (clears session)          |
| POST   | `/send`                     | `{ "to": "9477...", "message": "hi" }` |

Incoming messages → forwarded to `LOVABLE_WEBHOOK_URL` with `workspace_id` + `secret`. If the response has `replied: true`, the bot waits `delay_seconds` then sends `reply`.

## VPS Deployment Guide

### 1. Provision a VPS
Any Ubuntu 22.04+ VPS (1 vCPU / 1 GB RAM is enough). Open port `3000` (or front with Nginx + HTTPS).

### 2. Install Node.js 20
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git
```

### 3. Clone & install
```bash
git clone <your-repo> /opt/wa-bot
cd /opt/wa-bot/vps-bot
npm install --omit=dev
cp .env.example .env
nano .env   # fill API_TOKEN, WORKSPACE_ID, WEBHOOK_SECRET
```

Get `WORKSPACE_ID` and `WEBHOOK_SECRET` from the Lovable app → **VPS Bots** page (rotate the secret there if needed).

### 4. Run with systemd
Create `/etc/systemd/system/wa-bot.service`:
```ini
[Unit]
Description=StartAppLK WhatsApp Bot
After=network.target

[Service]
WorkingDirectory=/opt/wa-bot/vps-bot
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=3
EnvironmentFile=/opt/wa-bot/vps-bot/.env
User=root

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now wa-bot
sudo journalctl -u wa-bot -f
```

### 5. (Optional) Nginx + HTTPS
```nginx
server {
  server_name bot.example.com;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
  }
}
```
Then `sudo certbot --nginx -d bot.example.com`.

### 6. Configure in the Lovable app
On the **VPS Bots** page set:
- **VPS endpoint**: `https://bot.example.com` (no trailing slash)
- **API token**: same value as `API_TOKEN` in `.env`

Click **Test connection**, then **Show QR** and scan with WhatsApp → Linked devices.

### 7. Docker alternative
```bash
docker build -t wa-bot .
docker run -d --name wa-bot --restart unless-stopped \
  -p 3000:3000 --env-file .env -v $PWD/auth:/app/auth wa-bot
```

## Notes
- Session lives in `./auth` — back it up to avoid re-scanning the QR.
- Group messages and `status@broadcast` are ignored by design.
- If WhatsApp logs the device out (`DisconnectReason.loggedOut`), delete `./auth` and rescan.
