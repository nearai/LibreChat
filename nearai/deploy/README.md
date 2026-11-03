# NEAR AI internal deployment

Branch `deploy/nearai-internal` = `nearai-attestation` (the product) plus what is specific to
NEAR AI's own instance, "Private AI for NEAR AI". The general deploy steps and admin guide are in
[`../README.md`](../README.md); this file lists only the differences.

| What | Where | Kind |
|---|---|---|
| Near AI OS theme (light and dark), welcome title and subtitle, the brand-blue light leaking from behind the composer's top edge (`greetingGlow`), Google sign-in restricted to `near.ai` | `nearai/deploy/nearai-internal.yaml` | Config: restart to apply |
| Sidebar brand (N mark and "near ai" wordmark); NEAR's process mark beside a streaming thought and in place of the waiting dot (settled thoughts carry no glyph); replies without an author line; a chat bubble around the N, in the row's icon color, on chat rows | `interface.brand`, `interface.messageAuthor` and the endpoint's `iconURL` in the same file; marks in `client/public/assets/nearai-*.svg` | Config and assets |
| NEAR AI tile logo, favicons and app icons | `client/public/assets/` | Assets: rebuild |
| Tab title before load, install name "Private AI", scene-colored title bar | `client/index.html`, `client/vite.config.ts` | Build |
| App shell: icon rail, toolbar band, floating sidebar and chat cards, model picker in the composer | `client/src` (UnifiedSidebar, Chat) and `packages/client` | Code: rebuild |

The theme follows the [Near AI OS Design System](https://github.com/rdisandro/near-ai-os-design-system)
parent `light` and `dark` themes: cool neutrals (navy `scene` and `pane-opaque` in dark, cool greys in
light), NEAR AI blue as the one accent, capsule controls and concentric corners. The web has no
desktop behind the system's glass, so every surface takes the opaque fallback, with the glass alphas
pre-blended onto the pane. Type uses the platform's own faces (decision NDS-4), so the instance no
longer bundles brand webfonts.

The shell is code, not config, so it travels with every theme: a merge from the product branch can
conflict in the files listed above.

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
- `CUSTOM_FOOTER` (optional): the line under the composer. Unset, the welcome screen shows LibreChat's
  version line; for example `Private AI can make mistakes. Check important information.`

## Updating from the product

```bash
git switch deploy/nearai-internal
git merge nearai-attestation
```

This branch never edits `nearai/librechat.yaml`, so product config changes merge cleanly. Endpoint
or model changes made there must be copied into `nearai/deploy/nearai-internal.yaml` by hand.
