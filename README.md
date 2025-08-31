# Raycast2API

Convert Raycast AI API to OpenAI-compatible API. Built with HonoJS, supports Raycast V2 authentication, deployable to **Cloudflare Workers / Docker / Local Binary**.

## About This Project

This project is based on **[raycast-relay](https://github.com/szcharlesji/raycast-relay)**, which has been archived and is no longer maintained. The original project does not support the new Raycast V2 authentication system that is now required. This version utilizes **Hono** and provides support for **Raycast V2 authentication**.

## Deployment

> ⚠️ Be aware that not setting the API_KEY environment variable leaves your API open to anyone.

### Cloudflare Workers Deployment

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/xxxbrian/raycast2api)

### Docker Deployment

```bash
docker run -d \
  --name raycast2api \
  -p 3000:3000 \
  -e RAYCAST_BEARER_TOKEN=your-raycast-bearer-token \
  -e RAYCAST_DEVICE_ID=your-raycast-device-id \
  ghcr.io/xxxbrian/raycast2api:latest
```

<details>
<summary><b>Kubernetes Deployment</b></summary>
<pre><code>apiVersion: apps/v1
kind: Deployment
metadata:
  name: raycast2api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: raycast2api
  template:
    metadata:
      labels:
        app: raycast2api
    spec:
      containers:
      - name: raycast2api
        image: ghcr.io/xxxbrian/raycast2api:latest
        ports:
        - containerPort: 3000
        env:
        - name: RAYCAST_BEARER_TOKEN
          valueFrom:
            secretKeyRef:
              name: raycast-secret
              key: bearer-token
        - name: RAYCAST_DEVICE_ID
          valueFrom:
            secretKeyRef:
              name: raycast-secret
              key: device-id
        - name: API_KEY
          valueFrom:
            secretKeyRef:
              name: raycast-secret
              key: api-key
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 30
        readinessProbe:
          httpGet:
            path: /ready
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 30
</code></pre>
</details>

### Local Binary Deployment

Download the latest release from [Releases](https://github.com/xxxbrian/raycast2api/releases) and run it.

## Configuration

| Environment Variable | Required | Description | Default |
|---------------------|----------|-------------|---------|
| `RAYCAST_BEARER_TOKEN` | Yes | Raycast API Token | None |
| `RAYCAST_DEVICE_ID` | Yes | Raycast Device ID | None |
| `RAYCAST_SIGNATURE_SECRET` | No | V2 Signature Secret | Has default |
| `API_KEY` | No | Client authentication key | None (public access) |
| `ADVANCED` | No | Include advanced models | `true` |
| `INCLUDE_DEPRECATED` | No | Include deprecated models | `false` |

## Getting Raycast Credentials

Use proxy tools (like Proxyman, Charles) to capture Raycast app network requests:

1. Set up proxy and trust certificate
2. Add `backend.raycast.com` to SSL proxy list
3. Send AI request in Raycast
4. Extract from request headers:
   - `Authorization: Bearer <token>` → `RAYCAST_BEARER_TOKEN`
   - `X-Raycast-DeviceId` → `RAYCAST_DEVICE_ID`

## API Endpoints

Deployed API URL: `https://your-worker.your-account.workers.dev/`

### Available Endpoints

- `GET /health` - Health check (liveness probe, no auth required)
- `GET /ready` - Readiness check (readiness probe, no auth required)
- `GET /v1/models` - Get model list (requires auth if API_KEY is set)
- `POST /v1/chat/completions` - Chat completion (OpenAI compatible, requires auth if API_KEY is set)

## V2 Authentication

Implements Raycast V2 signature authentication:
- ROT13+ROT5 encoding
- HMAC-SHA256 signing
- Timestamp validation
- Device ID binding

## Project Structure

```
src/
├── index.ts           # Main entry
├── config.ts          # Configuration
├── types.ts           # Type definitions
├── utils.ts           # Utils and auth
└── handlers/
    ├── chat.ts        # Chat handler
    └── models.ts      # Models handler
server.ts              # Bun server entry for local binary
```

## Development

```bash
bun run dev        # Cloudflare Workers dev mode
bun run dev:local  # Local dev mode
```

## Credits

- [raycast-relay](https://github.com/szcharlesji/raycast-relay)
- [raycast2api](https://github.com/missuo/raycast2api)
