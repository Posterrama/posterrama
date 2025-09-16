#!/bin/bash

# Setup Git hooks for Posterrama development
# This script installs Git hooks that automatically update badges and coverage before pushing

echo "🔧 Setting up Posterrama development Git hooks..."

# Create hooks directory if it doesn't exist
mkdir -p .git/hooks

# Install pre-push hook
cat > .git/hooks/pre-push << 'EOF'
#!/bin/bash

# Pre-push hook: Update badges and coverage docs before pushing to remote
# This runs automatically when you `git push` and ensures badges are current

set -e

echo "🔄 Pre-push: Updating badges and coverage documentation..."

# Check if we're pushing to main branch
remote="$1"
url="$2"

# Read from stdin to get branch info
while read local_ref local_sha remote_ref remote_sha; do
    if [[ "$remote_ref" == "refs/heads/main" ]]; then
        echo "📊 Pushing to main branch - updating badges and coverage..."
        
        # Generate coverage report
        echo "🧪 Generating test coverage..."
        npm run test:coverage --silent
        
        # Update badges
        echo "🏷️  Updating badges..."
        npm run badges:update
        
        # Generate coverage documentation
        echo "📖 Updating coverage documentation..."
        if [ -f "scripts/generate-coverage-table.js" ]; then
            node scripts/generate-coverage-table.js
        fi
        
        # Check if there are changes to commit
        if ! git diff --quiet --exit-code -- README.md docs/COVERAGE.md 2>/dev/null; then
            echo "📝 Found badge/coverage updates - staging changes..."
            
            # Stage the changes
            git add README.md 2>/dev/null || true
            git add docs/COVERAGE.md 2>/dev/null || true
            git add coverage/coverage-final.json 2>/dev/null || true
            git add coverage/lcov.info 2>/dev/null || true
            git add coverage/lcov-report 2>/dev/null || true
            
            # Commit the changes
            git commit -m "chore: update badges and coverage docs [pre-push]"
            
            echo "✅ Badge and coverage updates committed locally"
        else
            echo "✅ No badge or coverage changes needed"
        fi
        
        echo "🚀 Pre-push checks complete!"
        break
    fi
done

exit 0
EOF

# Make hooks executable
chmod +x .git/hooks/pre-push

echo "✅ Git hooks installed successfully!"
echo ""
echo "📋 What's configured:"
echo "   • Pre-push hook: Updates badges and coverage before pushing to main"
echo "   • Replaces CI automation with local automation"
echo ""
echo "🎯 Next time you push to main branch:"
echo "   git push"
echo "   → Automatically runs tests, updates badges, commits changes"
echo ""
echo "🔧 To disable temporarily:"
echo "   git push --no-verify"