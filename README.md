# 9flare
Small (IPv4-only) DDNS client for CloudFlare :D

This was made because I was too lazy to manually add all my domains to my DDNS config :p

## CloudFlare
The CF token should have permissions for:
- `Zone:Read`
- `DNS:Edit`

## Setup
```sh
pnpm install
cp .env.example .env
# Modify `.env`
pnpm build
pnpm start
```
