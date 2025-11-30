# Posterrama Issue Workflow

**Effective Date:** November 15, 2025  
**Status:** Active

Posterrama uses **Gitea Issues** as the single source of truth.

## Gitea Setup

- **Repo:** https://git.highlanders.cloud/Posterrama.app/posterrama
- **Issues:** https://git.highlanders.cloud/Posterrama.app/posterrama/issues

### Key Labels

- **Type:** `feature`, `bug`, `enhancement`, `documentation`, `performance`, `security`
- **Priority:** `priority:critical` 🔴, `priority:high` 🟠, `priority:medium` 🟡, `priority:low` 🟢
- **Status:** `blocked`, `needs-discussion`, `good-first-issue`

### Milestones

1. **Sprint 3 - Code Quality** (Nov 30, 2025) - Refactoring, JSDoc
2. **v2.9.5 - Quick Wins** (Nov 25, 2025) - Easy fixes
3. **v2.9.6 - Display Polish** (Dec 5, 2025) - Display modes
4. **v2.9.7 - Content Features** (Dec 15, 2025) - Playlists
5. **v3.0.0 - Major Features** (Jan 31, 2026) - Platform apps

## AI Agent Workflow

### 1. Start Session

- **Query Issues:** `curl -H "Authorization: token $GITEA_TOKEN" "https://git.highlanders.cloud/api/v1/repos/Posterrama.app/posterrama/issues?state=open"`
- **Select Issue:** Check current sprint/milestone & priority. Ask user to confirm.
- **Comment:** `curl -X POST .../issues/$NUM/comments -d '{"body":"🤖 AI Agent started work"}'`

### 2. Work & Commit

- **Implement:** Follow requirements, write tests.
- **Commit:** `type(scope): Description ... Resolves: #ISSUE_NUM`
- **Update:** Add progress comments to issue.

### 3. Complete

- **Close:** `curl -X PATCH .../issues/$NUM -d '{"state":"closed"}'` (only if all criteria met)

### Creating Issues

Use template:

```markdown
## Priority: [CRITICAL|HIGH|MEDIUM|LOW]

## Milestone: [Sprint X | vX.X]

### Description

...

### Requirements

...

### Acceptance Criteria

- [ ] ...
```

## Developer Workflow

1. **Pick Issue:** From current sprint/priority.
2. **Implement:** Code + Tests.
3. **Commit:** Reference issue (`Resolves: #123`).
4. **Close:** Verify criteria met.

## API Quick Ref

- **List:** `GET /repos/{owner}/{repo}/issues?state=open`
- **Get:** `GET /repos/{owner}/{repo}/issues/{index}`
- **Create:** `POST /repos/{owner}/{repo}/issues` (`{"title":"...","body":"..."}`)
- **Comment:** `POST /repos/{owner}/{repo}/issues/{index}/comments`
- **Close:** `PATCH /repos/{owner}/{repo}/issues/{index}` (`{"state":"closed"}`)

**Note:** `private/TODO.md` is archived. Use Gitea Issues.
