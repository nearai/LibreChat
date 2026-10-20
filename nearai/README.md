# NEAR AI LibreChat

This fork of [LibreChat](https://github.com/LibreChat-AI/LibreChat) lets a company run LibreChat for its employees on NEAR AI confidential inference. The company trusts its own LibreChat deployment; it does not have to trust NEAR AI, because LibreChat verifies everything itself with [`@nearai/inference-sdk`](https://www.npmjs.com/package/@nearai/inference-sdk).

Any custom endpoint whose `baseURL` is `cloud-api.near.ai` gets three things:

- **Attestation before every request.** The NEAR AI Gateway and the model's TEE (Intel TDX + NVIDIA GPU) are verified; the result is cached for an hour. If verification fails, the message is not sent.
- **End-to-end encryption.** Prompts are encrypted to the attested model key, so the NEAR AI Gateway never sees them.
- **A verified signature on every reply.** The model TEE signs the exact request and response; LibreChat checks the signature and saves it on the message.

Users see this as shields: one in the header for the model, one on each reply. Both link to the NEAR AI Verification Center (`NEAR_AI_VERIFY_URL`), which re-checks everything independently in the browser.

The NEAR AI changes live on the `nearai-attestation` branch. This folder holds the deployment config:

| File | What it is |
|---|---|
| `nearai/librechat.yaml` | NEAR AI endpoint (Qwen3.6, GLM 5.3 Flash), with agents, MCP, web search, file search and code execution turned off. Loaded with `CONFIG_PATH`. |
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
