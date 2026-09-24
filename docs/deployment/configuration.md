# Configuration & Environment Reference

GarrisonOS is configured through standard environment variables loaded from `.env` in the project root.

---

## 1. Environment Variables

| Variable | Default Value | Description |
| :--- | :--- | :--- |
| `NODE_ENV` | `development` | Environment mode (`development`, `production`, `test`). |
| `PORT` | `3000` | Port for the Node.js REST API server (loopback). |
| `HOST` | `127.0.0.1` | Binding interface for Node.js engine. (Use `127.0.0.1` for loopback). |
| `WEB_PORT` | `8080` | Port for the TypeScript web presentation server in local/standalone mode. |
| `WEB_HOST` | `localhost` | Binding interface for the TypeScript web presentation server in local mode. |
| `PUBLIC_ORIGIN` | `http://localhost:<WEB_PORT>` | Canonical HTTP(S) origin exposed to browsers (for example, `https://app.example.com`). Set this for deployed instances so social preview image URLs use the public hostname rather than localhost. Do not include credentials. |
| `SQLITE_PATH` | `./garrison.sqlite` | File system path for the primary SQLite database. |
| `STORAGE_PATH` | `./storage/uploads` | File system path for uploaded tenant attachments and receipts. |
| `APP_SECRET` | *(Required in production)* | 32+ byte hex string (64 hex characters) used for HMAC-SHA256 session signatures and authentication tokens. |
| `CORS_ALLOWED_ORIGINS` | *(Development web host; empty otherwise)* | Comma-separated browser origins permitted by the API, such as `https://app.example.com,https://admin.example.com`. |
| `SESSION_COOKIE_NAME` | `garrison_session` | Cookie name for the signed HMAC-SHA256 session identifier. |

---

## 2. Generating & Validating Cryptographic Secrets

In production, `APP_SECRET` must be a high-entropy cryptographically secure secret (minimum 32 bytes / 256 bits):

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

### Security Considerations

* **HMAC-SHA256 Token Validation**: The Node.js engine signs and validates auth tokens using `APP_SECRET`.
* **Session & CSRF Protection**: The TypeScript presentation layer signs cookie sessions with HMAC-SHA256 using `APP_SECRET`, generates cryptographic CSRF tokens, and validates incoming POST/PUT/DELETE requests before proxying commands to the backend engine over loopback.
* **Secret Protection**: Ensure `.env` is never committed to source control and is readable only by the web service user (`chmod 600 .env`).
