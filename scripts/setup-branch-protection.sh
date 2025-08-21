#!/bin/bash

# Script om GitHub branch protection in te stellen
# Dit voorkomt dat code met falende tests wordt gepusht naar main

echo "🛡️ Setting up GitHub branch protection..."

# Check if GitHub CLI is available
if ! command -v gh &> /dev/null; then
    echo "❌ GitHub CLI (gh) not found. Please install it first:"
    echo "   Visit: https://cli.github.com/"
    echo ""
    echo "📋 Manual setup instructions:"
    echo "1. Go to your GitHub repository"
    echo "2. Navigate to Settings > Branches"
    echo "3. Click 'Add rule'"
    echo "4. Set Branch name pattern: main"
    echo "5. Enable these options:"
    echo "   ✅ Require a pull request before merging"
    echo "   ✅ Require approvals: 1"
    echo "   ✅ Dismiss stale PR approvals when new commits are pushed"
    echo "   ✅ Require status checks to pass before merging"
    echo "   ✅ Require branches to be up to date before merging"
    echo "   ✅ Require linear history"
    echo "   ✅ Include administrators"
    echo ""
    echo "6. Under 'Status checks', add:"
    echo "   - test (Node.js 18.x)"
    echo "   - code-quality"
    exit 1
fi

# Check if we're in a git repository
if [ ! -d .git ]; then
    echo "❌ Not in a git repository"
    exit 1
fi

# Get repository info
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
if [ -z "$REPO" ]; then
    echo "❌ Could not determine repository name"
    exit 1
fi

echo "📦 Repository: $REPO"

# Set up branch protection for main branch
echo "🔒 Setting up branch protection for 'main' branch..."

gh api repos/$REPO/branches/main/protection \
  --method PUT \
  --field required_status_checks[strict]=true \
  --field required_status_checks[contexts][]="test (Node.js 18.x)" \
  --field required_status_checks[contexts][]="code-quality" \
  --field enforce_admins=true \
  --field required_pull_request_reviews[required_approving_review_count]=1 \
  --field required_pull_request_reviews[dismiss_stale_reviews]=true \
  --field required_pull_request_reviews[require_code_owner_reviews]=true \
  --field restrictions=null \
  --field required_linear_history=true \
  --field allow_force_pushes=false \
  --field allow_deletions=false

if [ $? -eq 0 ]; then
    echo "✅ Branch protection successfully configured!"
    echo ""
    echo "🛡️ Protection rules active:"
    echo "  - Require PR with 1 approval"
    echo "  - All status checks must pass"
    echo "  - No direct pushes to main"
    echo "  - Linear history required"
    echo "  - Applies to administrators too"
else
    echo "❌ Failed to set up branch protection"
    echo "Please set it up manually via GitHub web interface"
    exit 1
fi

echo ""
echo "🎉 Setup complete! Your main branch is now protected."
echo "💡 From now on, all changes must go through Pull Requests"
echo "🧪 Tests must pass before any code can be merged"
