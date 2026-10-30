# NEAR AI LibreChat

This fork of [LibreChat](https://github.com/LibreChat-AI/LibreChat) runs on NEAR AI Cloud, using [`@nearai/inference-sdk`](https://www.npmjs.com/package/@nearai/inference-sdk) to verify the hardware and response signatures available for each model.

Custom endpoints on `cloud-api.near.ai` or `cloud-stg-api.near.ai` follow the Cloud UI example's model capabilities:

- **Private (`vllm`) models:** Gateway and model TEE verification, E2EE, and Ed25519 signatures.
- **External and Chutes models:** Gateway verification and ECDSA signatures, without model E2EE or a claim that LibreChat attested model execution.
- **Every reply:** the SDK checks the signature over the exact request and response bytes and saves its result on the message; a check that cannot finish is saved as unverified rather than dropped. Failed hardware verification blocks the request with an explanatory error. Sessions are cached per model for an hour.

Both shields open the NEAR AI Verification Center in an iframe. The header shield shows the current model's hardware report; **Verify again** fetches fresh evidence and resets that model's Chat deployment cache. The reply shield combines its saved signature result with current hardware checks, matching the Cloud UI example. Hardware is merged only when the signer and deployment measurements match; the original signature, verdict and verification time remain unchanged. **Verify hardware again** refreshes hardware without resetting Chat's SDK session; **Reload viewer** only reloads the iframe. A failed hardware refresh shows unavailable hardware reports alongside the saved signature. Current hardware reports are not saved back to historical messages. Older messages without a report link to the standalone verification page using their saved receipt.

`NEAR_AI_VERIFY_URL` defaults to `https://cloud-stg.near.ai/verify` and comes from authenticated startup config. The dialog follows the current light/dark mode and allows selecting one completion at a time. Report fields are filtered before storage and before sending. Fresh hardware reports include approved quote, nonce, event-log and GPU evidence fields; API keys, chat content and deployment configuration are excluded. Gateway-signed replies request Gateway evidence only and remain partial.

Use a trusted viewer supporting the v1 iframe protocol. LibreChat validates the sender origin, iframe window and request ID, and cleans up on close or reload. The viewer enforces report consistency; LibreChat retains field selection and the protocol's 1 MiB limit. The viewer's `frame-ancestors` and LibreChat's `frame-src` must permit embedding. HTTPS parents and HTTP localhost/127.0.0.1 development parents are supported.

Hardware checks default to the example's 45-second deadline. Set `nearai.verificationTimeoutMs` in `librechat.yaml` to override it (1–120 seconds). A timeout leaves the saved reply signature intact and permits retry.

The NEAR AI changes live on the `nearai-attestation` branch. This folder holds the deployment config:

| File | What it is |
|---|---|
| `nearai/librechat.yaml` | NEAR AI endpoint (Qwen3.6, GLM 5.3 Flash, OpenAI and Chutes examples), with agents, MCP, web search, file search and code execution turned off. Loaded with `CONFIG_PATH`. |
| `nearai/railway.env.example` | Environment variables for the `librechat` service. Real values, including secrets and `NEAR_API_KEY`, are set only in Railway. |
| `railway.json` (repo root) | Builds the root `Dockerfile` and health-checks `/health`. |

## Deploying on Railway

The current deployment:

- **App:** https://librechat-production-d970.up.railway.app
- **Railway:** https://railway.com/project/e5b17c56-e8c3-4e72-ade0-d9549b267af5 (NEAR AI workspace, environment `production`, region EU West)

| Service | What it is |
|---|---|
| `librechat` | Built from this repo, branch `nearai-attestation`. Railway builds LibreChat from source (about 10–20 minutes). |
| `MongoDB` | `mongo:8.0` on a volume, reached only over the private network. |

### Source

Railway → `librechat` → Settings → Source: repo `nearai/LibreChat`, branch `nearai-attestation`. Every push to that branch deploys. The Railway GitHub app on the `nearai` org needs access to `nearai/LibreChat`; until it has it, deploy from a checkout of the branch:

```bash
railway link    # choose NEAR AI → the project → production → librechat
railway up --service librechat --detach
```

If the frontend build runs out of memory, add the service variable `NODE_MAX_OLD_SPACE_SIZE` (Railway passes it to the Dockerfile build argument of the same name; the default is 6144 MB).

**After every deploy,** check the logs for `Custom config file loaded`. If that line is missing, `CONFIG_PATH` is wrong and LibreChat is running with default settings, without the lock-down.

```bash
railway logs --service librechat | grep -E "Custom config file loaded|Connected to MongoDB"
```

### Secrets

Set secrets without echoing them:

```bash
read -rs K && printf %s "$K" | railway variables --service librechat --set-from-stdin NEAR_API_KEY && unset K
```

## Admin guide

Registration is closed, and there's no "create user" button in the app. Accounts are created from inside the container. **The first account ever created gets the `ADMIN` role**, so create the super admin before anyone else.

First, run `railway ssh --service librechat` once in an interactive terminal and accept Railway's host key. Then:

```bash
railway ssh --service librechat
# inside the container (/app):
npm run create-user <email> "<Full Name>" <username> --email-verified=true   # prompts for the password, so it stays out of shell history
npm run list-users
npm run reset-password                  # prompts for email + new password
npm run ban-user <email> <minutes>
npm run delete-user <email>
```

### What the ADMIN role can do

| Where | Can do | Can't do |
|---|---|---|
| In the chat app | Toggle what regular users may do with Prompts, Agents, Memories, MCP, Skills, Marketplace and the People picker; edit or delete any agent | Create, ban or delete users; see usage; read other users' chats |
| Command line (`railway ssh`) | Create, list, ban and delete users; reset passwords; manage token balances (`add-balance`, `set-balance`, `list-balances`) | — |
| Admin REST API (`/api/admin/*`) | List and search users; manage roles and their permissions; groups; permission grants; audit log; per-user/group/role config overrides | Create users |

Anyone with access to the Railway project can create users and effectively holds admin rights.

### Giving someone admin access later

- **API:** an existing admin calls `POST /api/admin/roles/ADMIN/members` with `{ "userId": "<mongo _id>" }`.
- **Database:** edit the `role` field to `ADMIN` in the `users` collection, from Railway → MongoDB → Data.
- **Partial access:** `POST /api/admin/grants` with `{ principalType: "user", principalId, capability }`. The user also needs the `access:admin` permission, and won't see the in-app admin toggles.

## Changing config

Edit `nearai/librechat.yaml`, push to `nearai-attestation`, and Railway redeploys. The server reads the config once at startup.

## Running locally

```bash
docker run -d --name librechat-mongo -p 127.0.0.1:27017:27017 mongo:8.0
cp .env.example .env    # set NEAR_API_KEY, CREDS_*, JWT_*; optionally NEAR_AI_VERIFY_URL
npm ci && npm run build:packages && (cd client && npm run build)
CONFIG_PATH="$PWD/nearai/librechat.yaml" npm run backend:dev    # Node 24+
```
