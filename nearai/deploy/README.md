# NEAR AI internal deployment

Branch `deploy/nearai-internal` = `nearai-attestation` (the product) plus what is specific to
NEAR AI's own instance, "Private AI for NEAR AI". The general deploy steps and admin guide are in
[`../README.md`](../README.md); this file lists only the differences.

| What | Where | Kind |
|---|---|---|
| Brand theme (light and dark), welcome text, Google sign-in restricted to `near.ai` | `nearai/deploy/nearai-internal.yaml` | Config: restart to apply |
| NEAR AI tile logo, favicons and app icons | `client/public/assets/` | Assets: rebuild |
| Brand fonts: Mona Sans, Schibsted Grotesk, JetBrains Mono (SIL OFL 1.1) | `client/public/assets/fonts/nearai/`, linked from `client/index.html` | Assets: rebuild |
| Tab title before load, install name "Private AI", brand blue title bar | `client/index.html`, `client/vite.config.ts` | Build |

Colors follow [near.ai/brand](https://near.ai/brand): Blue `#0091FD`, Black, Off-White `#EEEEEB`,
Dark Grey `#272727`, Grey `#A7A7A7`, Sky `#83DCFF`. Where text sits on blue or is blue, the theme
uses a darker brand blue `#0066B3` (light) or Sky (dark) to keep WCAG AA contrast.

## Railway

- Source: `nearai/LibreChat`, branch `deploy/nearai-internal`.
- `CONFIG_PATH=/app/nearai/deploy/nearai-internal.yaml`
- `APP_TITLE=Private AI`
- Google sign-in: `ALLOW_SOCIAL_LOGIN=true`, `ALLOW_SOCIAL_REGISTRATION=true`, `GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL=/oauth/google/callback`. The OAuth client lives in
  the near.ai Google Workspace with an "Internal" consent screen; its redirect URI is
  `https://librechat-nearai.up.railway.app/oauth/google/callback`.
- `DOMAIN_CLIENT` and `DOMAIN_SERVER` = `https://librechat-nearai.up.railway.app`.
- `NEAR_AI_VERIFY_URL=https://cloud.near.ai/verify` (the shields' "View details on NEAR AI" link).

## Updating from the product

```bash
git switch deploy/nearai-internal
git merge nearai-attestation
```

This branch never edits `nearai/librechat.yaml`, so product config changes merge cleanly. Endpoint
or model changes made there must be copied into `nearai/deploy/nearai-internal.yaml` by hand.
