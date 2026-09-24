# VibeMeter — real working BuddyMeter-style website

## What this version does
- Creates quizzes with unique public IDs.
- Public quiz links work on other phones/devices.
- Stores quizzes and responses in SQLite.
- Records respondent name, every answer, score and timestamp.
- Private dashboard shows who answered and their answers.
- Responsive aesthetic mobile UI.
- No browser-local-only response storage.

## Run locally
1. Install Node.js 18+.
2. In this folder run:
   npm install
   npm start
3. Open http://localhost:3000

## Deploy
Deploy the whole folder to a Node-compatible host such as Render, Railway, Fly.io, or your own VPS.
Set `PORT` if your host requires it.

### Important for production
SQLite needs persistent disk/storage. On a host where the filesystem is ephemeral, attach a persistent volume and set:
DB_FILE=/data/vibemeter.db

## Security note
The dashboard URL is the private access credential in this simple version. Do not publish it. For a larger production service, add accounts/authentication and rate limiting.
