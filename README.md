# VibeMeter — Persistent Version

This version uses PostgreSQL instead of local SQLite so quizzes and responses survive Render restarts/redeploys.

## Render setup
1. Create a PostgreSQL database in Render (or use another PostgreSQL provider).
2. Add the database's connection string as the web service environment variable `DATABASE_URL`.
3. Keep Start Command as `npm start`.
4. Redeploy.

Important: Render's free web-service filesystem is ephemeral, so local SQLite data disappears on restart/spin-down/redeploy. This version avoids that by storing data in PostgreSQL.
