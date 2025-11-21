# Renovate Bot Setup for Self-Hosted Gitea

## Option 1: Docker Run (Simplest)

```bash
docker run --rm \
  -e RENOVATE_PLATFORM=gitea \
  -e RENOVATE_ENDPOINT=https://git.highlanders.cloud/api/v1 \
  -e RENOVATE_TOKEN=<YOUR_GITEA_TOKEN> \
  -e RENOVATE_GIT_AUTHOR=renovate@posterrama.app \
  -v $(pwd)/.github/renovate.json:/usr/src/app/config.json \
  renovate/renovate:latest \
  --config /usr/src/app/config.json
```

**Setup:**

1. Create Gitea Personal Access Token with `repo` permissions
2. Run command above with your token
3. Schedule with cron: `0 2 * * * docker run...`

## Option 2: Docker Compose (Recommended)

Create `docker-compose.renovate.yml`:

```yaml
version: '3.8'

services:
    renovate:
        image: renovate/renovate:latest
        environment:
            - RENOVATE_PLATFORM=gitea
            - RENOVATE_ENDPOINT=https://git.highlanders.cloud/api/v1
            - RENOVATE_TOKEN=${GITEA_RENOVATE_TOKEN}
            - RENOVATE_GIT_AUTHOR=renovate@posterrama.app
            - LOG_LEVEL=info
            - RENOVATE_CONFIG_FILE=/usr/src/app/config.json
        volumes:
            - ./.github/renovate.json:/usr/src/app/config.json:ro
        restart: 'no' # Run on-demand or with cron
```

**Setup:**

1. Create `.env` with `GITEA_RENOVATE_TOKEN=<your_token>`
2. Run: `docker-compose -f docker-compose.renovate.yml up`
3. Schedule with systemd timer or cron

## Option 3: GitHub Actions-style Runner

**Coming Q1 2026:** Gitea Actions will support scheduled workflows.

## Configuration

The `.github/renovate.json` file controls:

- Auto-merge rules (patch updates for devDeps)
- Grouping (ESLint, Jest, @types packages together)
- Schedule (weeknights 10pm-5am to avoid disrupting work)
- Security alerts (always creates PR, never auto-merges)
- Lock file maintenance (Mondays at 5am)

## Manual Alternative (Current Workflow)

If Renovate setup is too complex, keep current workflow:

1. Weekly: `npm outdated`
2. Monthly: `npm run deps:security-audit`
3. Manual PR creation for updates

## Gitea Token Permissions

Create token at: `https://git.highlanders.cloud/user/settings/applications`

**Required permissions:**

- ✅ `repo` - Full repository access
- ✅ `write:repo_hook` - Create webhooks (optional)

## Testing

Test Renovate without creating PRs:

```bash
docker run --rm \
  -e RENOVATE_PLATFORM=gitea \
  -e RENOVATE_ENDPOINT=https://git.highlanders.cloud/api/v1 \
  -e RENOVATE_TOKEN=<token> \
  -e RENOVATE_DRY_RUN=true \
  renovate/renovate:latest
```

## Maintenance

- Renovate auto-updates itself (uses latest Docker tag)
- Check logs: `docker logs <container_id>`
- Debug: `LOG_LEVEL=debug`
