# 🚀 Code Review - Quick Reference

## ⚡ 30-Second Checklist

### 🔍 **First Look** (2 min)

- [ ] PR size reasonable? (<400 lines)
- [ ] Clear title & description?
- [ ] All automated checks pass?
- [ ] No merge conflicts?

### 🧠 **Logic Review** (10 min)

- [ ] Code does what PR says?
- [ ] Edge cases handled?
- [ ] Error handling present?
- [ ] No obvious bugs?

### 🎨 **Quality Check** (5 min)

- [ ] Functions small & focused?
- [ ] Clear naming?
- [ ] No code duplication?
- [ ] Comments explain WHY?

### 🔒 **Security Scan** (3 min)

- [ ] Input validation?
- [ ] No secrets in code?
- [ ] SQL injection safe?
- [ ] XSS prevention?

### 🧪 **Testing** (5 min)

- [ ] Tests for new features?
- [ ] Tests cover edge cases?
- [ ] Test names descriptive?

### 🚀 **Performance** (3 min)

- [ ] No N+1 queries?
- [ ] Efficient algorithms?
- [ ] Memory leaks avoided?

### ✨ **Final Check** (2 min)

- [ ] Documentation updated?
- [ ] Breaking changes noted?
- [ ] Migration needed?

---

## 🚨 Red Flags

### 🛑 **Immediate Reject**

- Hardcoded passwords/secrets
- SQL injection vulnerabilities
- Missing error handling in critical paths
- Tests failing
- Security audit failures

### ⚠️ **Request Changes**

- Functions >50 lines
- No input validation
- Missing tests for new features
- Code duplication
- Unclear variable names

### 💭 **Comment Only**

- Style preferences
- Performance optimizations
- Alternative approaches
- Learning suggestions

---

## 💬 Comment Templates

```markdown
**🐛 Bug**: This could cause [issue] when [scenario]
Suggestion: [solution]

**🎨 Style**: Consider using [approach] for better readability
Reference: [link to style guide]

**🚀 Performance**: This might be slow with large datasets
Alternative: [better approach]

**❓ Question**: Could you clarify why [specific choice]?
Context: [why it matters]

**✨ Nitpick**: Minor style preference (non-blocking)
Suggestion: [small improvement]

**👍 Good**: Nice use of [pattern/technique]!
This improves [specific benefit]
```

---

## ⏱️ Time Budget

| Review Size   | Time Limit | Focus            |
| ------------- | ---------- | ---------------- |
| <100 lines    | 15 min     | Logic + Security |
| 100-200 lines | 25 min     | + Architecture   |
| 200-400 lines | 40 min     | + Performance    |
| >400 lines    | Split PR   | Too large!       |

---

## 🎯 Reviewer Goals

1. **Find bugs** before production
2. **Ensure security** standards
3. **Maintain quality** standards
4. **Share knowledge** with team
5. **Improve codebase** incrementally

---

## 📱 Quick Commands

```bash
# Checkout PR locally for testing
gh pr checkout [PR-number]

# Run tests on PR
npm test

# Check PR diff
gh pr diff [PR-number]

# Add review comment
gh pr review [PR-number] --comment

# Approve PR
gh pr review [PR-number] --approve

# Request changes
gh pr review [PR-number] --request-changes
```

---

**💡 Pro Tip**: Focus on high-impact issues first. Style nitpicks can wait!
