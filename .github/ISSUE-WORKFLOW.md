# Posterrama Issue-Based Workflow

**Effective Date:** November 15, 2025  
**Status:** Active

---

## Overview

Posterrama now uses **Gitea Issues** as the single source of truth for all tasks, features, bugs, and enhancements. This document describes the workflow for AI agents and developers.

## Gitea Setup

### Repository

- **URL:** https://git.highlanders.cloud/Posterrama.app/posterrama
- **Issues:** https://git.highlanders.cloud/Posterrama.app/posterrama/issues
- **Labels:** https://git.highlanders.cloud/Posterrama.app/posterrama/labels

### Labels

#### Type Labels

- `feature` 🟢 - New feature or request
- `bug` 🔴 - Something is not working
- `enhancement` 🔵 - Improvement to existing feature
- `documentation` 📘 - Documentation improvements
- `performance` 🟡 - Performance optimization
- `security` 🔒 - Security related

#### Priority Labels

- `priority:critical` 🔴 - Fix ASAP
- `priority:high` 🟠 - High priority
- `priority:medium` 🟡 - Medium priority
- `priority:low` 🟢 - Low priority

#### Category Labels

- `ui/ux` - User interface and experience
- `api` - API related
- `backend` - Backend/server related
- `frontend` - Frontend/client related
- `display-mode` - Cinema/Wallart/Screensaver

#### Status Labels

- `blocked` - Blocked by dependencies
- `needs-discussion` - Needs team discussion
- `good-first-issue` - Good for newcomers

### Milestones

1. **Sprint 3 - Code Quality** (Due: Nov 30, 2025)
    - Current sprint: Refactoring, JSDoc, technical debt cleanup
    - Note: Backend sprint from BACKEND-ANALYSIS docs

2. **v2.9.5 - Quick Wins** (Due: Nov 25, 2025)
    - Easy improvements and fixes (1-2h each)
    - Context-aware settings, faster transitions, etc.

3. **v2.9.6 - Display Polish** (Due: Dec 5, 2025)
    - Display mode improvements (2-4h each)
    - Wallart, Cinema, Screensaver enhancements

4. **v2.9.7 - Content Features** (Due: Dec 15, 2025)
    - Content and media enhancements (4-8h each)
    - Playlists, per-device sources

5. **v3.0.0 - Major Features** (Due: Jan 31, 2026)
    - Platform apps, plugins, user management
    - Major architecture changes (8h+ each)

6. **Future - Nice to Have** (No deadline)
    - Experimental features and research
    - Long-term wishlist items---

## AI Agent Workflow

### Starting a New Session

1. **Query Open Issues**

    ```bash
    curl -H "Authorization: token $GITEA_TOKEN" \
      "https://git.highlanders.cloud/api/v1/repos/Posterrama.app/posterrama/issues?state=open"
    ```

2. **Review Current Sprint**
    - Check milestone issues
    - Review priority labels
    - Identify blockers

3. **Select Issue to Work On**
    - User may specify issue number
    - Or: Suggest highest priority unassigned issue
    - Ask for confirmation before starting

### Working on an Issue

1. **Add Comment: Start Working**

    ```bash
    curl -X POST "https://git.highlanders.cloud/api/v1/repos/Posterrama.app/posterrama/issues/$ISSUE_NUM/comments" \
      -H "Authorization: token $GITEA_TOKEN" \
      -d '{"body":"🤖 AI Agent started work on this issue"}'
    ```

2. **Implement Changes**
    - Follow issue requirements
    - Write tests
    - Run quality checks
    - Commit with issue reference

3. **Commit Message Format**

    ```
    type(scope): Brief description

    Detailed explanation of changes.

    Resolves: #ISSUE_NUM
    ```

4. **Add Progress Comments**
    - Comment on issue with progress updates
    - Note any blockers or questions
    - Request clarification if needed

5. **Close Issue When Complete**
    ```bash
    curl -X PATCH "https://git.highlanders.cloud/api/v1/repos/Posterrama.app/posterrama/issues/$ISSUE_NUM" \
      -H "Authorization: token $GITEA_TOKEN" \
      -d '{"state":"closed"}'
    ```

### Creating New Issues

**When to Create Issues:**

- User requests new feature
- Bug discovered during development
- Technical debt identified
- Improvement opportunity found

**Issue Creation Template:**

```markdown
## Priority: [CRITICAL|HIGH|MEDIUM|LOW]

## Milestone: [Sprint X | vX.X | Future]

### Description

[Clear description of issue/feature]

### Requirements

- Requirement 1
- Requirement 2

### Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2

### Related Issues

- Depends on: #XXX
- Blocks: #YYY
```

**Python Script Example:**

```python
import requests

def create_issue(token, title, body, labels=None, milestone=None):
    url = "https://git.highlanders.cloud/api/v1/repos/Posterrama.app/posterrama/issues"
    data = {"title": title, "body": body}
    if labels:
        data["labels"] = labels
    if milestone:
        data["milestone"] = milestone

    headers = {
        "Authorization": f"token {token}",
        "Content-Type": "application/json"
    }

    response = requests.post(url, json=data, headers=headers)
    return response.json()
```

---

## Developer Workflow

### Daily Workflow

1. **Check Assigned Issues**
    - Review issues assigned to you
    - Comment on progress

2. **Pick Next Issue**
    - Choose from current sprint
    - Follow priority labels
    - Update issue status

3. **Implement & Test**
    - Write code
    - Add tests
    - Run quality checks

4. **Commit & Reference**
    - Commit with issue number
    - Push to repository
    - Update issue with commit link

5. **Close When Done**
    - Verify acceptance criteria met
    - Close issue
    - Move to next task

### Issue States

- **Open** - Not yet started
- **Closed** - Completed and verified
- **Blocked** - Waiting on dependency (add `blocked` label)

### Best Practices

1. **One Issue Per Branch** (optional)
    - Branch naming: `issue-42-feature-name`
    - Clean history per issue

2. **Keep Issues Updated**
    - Comment on progress
    - Note blockers immediately
    - Ask questions as comments

3. **Link Related Issues**
    - Use "Depends on: #XXX"
    - Use "Blocks: #YYY"
    - Cross-reference related work

4. **Close Only When Complete**
    - All acceptance criteria met
    - Tests passing
    - Documentation updated
    - Deployed/merged

---

## Gitea API Quick Reference

### Common Operations

**List Open Issues:**

```bash
curl -H "Authorization: token $TOKEN" \
  "https://git.highlanders.cloud/api/v1/repos/Posterrama.app/posterrama/issues?state=open"
```

**Get Issue Details:**

```bash
curl -H "Authorization: token $TOKEN" \
  "https://git.highlanders.cloud/api/v1/repos/Posterrama.app/posterrama/issues/$NUM"
```

**Create Issue:**

```bash
curl -X POST \
  -H "Authorization: token $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Issue title","body":"Description","labels":[1,2],"milestone":1}' \
  "https://git.highlanders.cloud/api/v1/repos/Posterrama.app/posterrama/issues"
```

**Add Comment:**

```bash
curl -X POST \
  -H "Authorization: token $TOKEN" \
  -d '{"body":"Comment text"}' \
  "https://git.highlanders.cloud/api/v1/repos/Posterrama.app/posterrama/issues/$NUM/comments"
```

**Close Issue:**

```bash
curl -X PATCH \
  -H "Authorization: token $TOKEN" \
  -d '{"state":"closed"}' \
  "https://git.highlanders.cloud/api/v1/repos/Posterrama.app/posterrama/issues/$NUM"
```

**Update Labels:**

```bash
curl -X PUT \
  -H "Authorization: token $TOKEN" \
  -d '{"labels":[1,2,3]}' \
  "https://git.highlanders.cloud/api/v1/repos/Posterrama.app/posterrama/issues/$NUM/labels"
```

---

## Migration Notes

### Previous TODO System

- **OLD:** `private/TODO.md` - Manual markdown checklist
- **NEW:** Gitea Issues - API-driven, trackable, integrated

### What Changed

✅ **Migrated:** All 55+ TODO items → Gitea Issues (#8-#55)  
✅ **Created:** Labels, Milestones, Categories  
✅ **Archived:** `private/TODO.md` → `private/archive/TODO-2025-11-15.md`

### Benefits

- ✅ API-accessible from any session
- ✅ Comment threads for discussion
- ✅ Automatic linking to commits
- ✅ Progress tracking with milestones
- ✅ Labels for filtering/organization
- ✅ Persistent across sessions
- ✅ Web UI for manual management

---

## For AI Agents: Session Continuity

### At Session Start

1. Read this document: `/var/www/posterrama/.github/ISSUE-WORKFLOW.md`
2. Query Gitea for open issues in current sprint
3. Ask user which issue to work on
4. Comment on issue: "🤖 Starting work"

### During Work

1. Update issue with progress comments
2. Reference issue number in commits
3. Ask questions via issue comments

### At Session End

1. Comment final status on issue
2. Close if complete, or note remaining work
3. Update milestone if needed

### Next Session

1. Previous AI agent's work visible in issue history
2. Comments show progress and decisions
3. Commits linked automatically
4. Next agent continues seamlessly

---

## Support

**Questions?** Comment on Gitea issue or contact admin.

**Scripts:** See `/var/www/posterrama/scripts/`

- `setup-gitea-labels.sh` - Recreate labels/milestones
- `convert-todo-part*.py` - Create issues from markdown

**API Docs:** https://docs.gitea.com/api/1.22/
