# StartAppLK WhatsApp Bot (Baileys + Express)

Standalone Node.js Express server using [Baileys](https://github.com/WhiskeySockets/Baileys) for WhatsApp Web (multi-device). Designed for VPS deployment with PM2. Sessions persist in `./sessions`, auto-reconnects, and forwards every incoming message to your Lovable app webhook — the response is sent back to WhatsApp.

## Endpoints

All endpoints require `Authorization: Bearer <API_TOKEN>`.

| Method | Path        | Purpose                                |
| ------ | ----------- | -------------------------------------- |
| GET    | `/status`   | Connection state                       |
| GET    | `/qr`       | Current QR (PNG data URL)              |
| POST   | `/restart`  | Restart the WhatsApp socket            |
| POST   | `/send`     | `{ "to": "9477...", "message": "hi" }` |

Incoming WA messages → `LOVABLE_WEBHOOK_URL` with `workspace_id` + `secret`. If the response has `replied: true`, the bot waits `delay_seconds` then sends `reply`.

## VPS Deployment

### 1. Install Node.js 20 + PM2
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git
sudo npm install -g pm2
```

### 2. Clone & configure
```bash
git clone <your-repo> /opt/wa-bot
cd /opt/wa-bot/vps-bot
npm install --omit=dev
cp .env.example .env
nano .env   # set API_TOKEN, WORKSPACE_ID, WEBHOOK_SECRET
```
Get `WORKSPACE_ID` and `WEBHOOK_SECRET` from Lovable app → **VPS Bots** page.

### 3. Run with PM2
```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup            # follow the printed command to enable boot start
pm2 logs wa-bot
```

### 4. Connect from the Lovable app
On **VPS Bots** set:
- **VPS endpoint**: `http://<vps-ip>:3000` (or your HTTPS domain)
- **API token**: same as `API_TOKEN` in `.env`

Click **Test connection**, then scan the QR with WhatsApp → Linked devices.

### 5. (Optional) Nginx + HTTPS
```nginx
server {
  server_name bot.example.com;
  location / { proxy_pass http://127.0.0.1:3000; proxy_set_header Host $host; }
}
```
`sudo certbot --nginx -d bot.example.com`

### 6. Docker alternative
```bash
docker build -t wa-bot .
docker run -d --name wa-bot --restart unless-stopped \
  -p 3000:3000 --env-file .env -v $PWD/sessions:/app/sessions wa-bot
```

## Notes
- Session lives in `./sessions` — back it up to avoid re-scanning the QR.
- Group messages and `status@broadcast` are ignored.
- If WhatsApp logs out (`loggedOut`), delete `./sessions` and rescan.
