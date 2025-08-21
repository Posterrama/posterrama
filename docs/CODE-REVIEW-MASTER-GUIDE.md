# 🔍 Code Review - Complete Guide

## 📚 Documentatie Overzicht

Deze gids bevat alles wat je nodig hebt voor effectieve code reviews in het Posterrama project.

### 📋 **Hoofddocumenten**

1. **[CODE-REVIEW-CHECKLIST.md](./CODE-REVIEW-CHECKLIST.md)**
    - Uitgebreide gids met concrete review punten
    - De vier pijlers: Correctness, Design, Style, Performance
    - Voorbeelden van goede vs slechte code
    - Security & best practices

2. **[CODE-REVIEW-QUICK-REF.md](./CODE-REVIEW-QUICK-REF.md)**
    - 30-seconden snelle checklist
    - Comment templates
    - Time budget per PR grootte
    - Red flags om direct te rejecten

3. **[TECH-SPECIFIC-REVIEW.md](./TECH-SPECIFIC-REVIEW.md)**
    - Technologie-specifieke review punten
    - JavaScript/Node.js, React, Express, Database
    - Veelvoorkomende problemen per tech stack
    - Priority matrix voor reviews

4. **[CODE-REVIEW-PROCESS.md](./CODE-REVIEW-PROCESS.md)**
    - Volledige proces setup en workflows
    - GitHub branch protection
    - CI/CD integration
    - Team communicatie richtlijnen

---

## 🚀 **Praktische Tools**

### 📝 **Scripts**

```bash
# Pre-review check (voor submitter)
npm run review:pre-check

# Health check (algemene project status)
npm run health

# Self-check script (voor reviewers)
npm run review:self-check
```

### 🔍 **Quick Commands**

```bash
# Checkout PR voor lokale test
gh pr checkout [PR-number]

# Review status check
gh pr diff [PR-number]

# Approve/reject
gh pr review [PR-number] --approve
gh pr review [PR-number] --request-changes
```

---

## 🎯 **Waar op te Letten - Top 10**

### 1. 🐛 **Functionaliteit**

- [ ] Code doet wat PR beschrijft
- [ ] Edge cases afgehandeld
- [ ] Error handling aanwezig

### 2. 🔒 **Security**

- [ ] Input validatie
- [ ] Geen secrets in code
- [ ] SQL injection preventie
- [ ] XSS preventie

### 3. 🧪 **Testing**

- [ ] Tests voor nieuwe features
- [ ] Edge cases getest
- [ ] Test namen beschrijvend

### 4. 🎨 **Code Quality**

- [ ] Functies klein en gefocust
- [ ] Duidelijke namen
- [ ] Geen code duplicatie
- [ ] Comments verklaren WAAROM

### 5. 🏗️ **Architectuur**

- [ ] Single Responsibility Principle
- [ ] DRY (Don't Repeat Yourself)
- [ ] Proper error boundaries
- [ ] Logical code organization

### 6. 🚀 **Performance**

- [ ] Geen N+1 queries
- [ ] Efficiënte algoritmes
- [ ] Memory leaks voorkomen
- [ ] Proper caching strategy

### 7. 📱 **Frontend Specifiek**

- [ ] Loading states
- [ ] Error states
- [ ] Accessibility (ARIA)
- [ ] Key props in React lists

### 8. 🖥️ **Backend Specifiek**

- [ ] RESTful API design
- [ ] Proper HTTP status codes
- [ ] Rate limiting overwogen
- [ ] Database indexes

### 9. 📊 **Data Handling**

- [ ] Input sanitization
- [ ] Output validation
- [ ] Proper data types
- [ ] Schema validation

### 10. 📖 **Documentation**

- [ ] API changes documented
- [ ] Breaking changes noted
- [ ] Migration guides waar nodig
- [ ] Code comments up-to-date

---

## 💬 **Effectieve Review Comments**

### ✅ **Goede Comment Voorbeelden**

```markdown
**🐛 Potential Bug**: This could return undefined when user.profile is null
Suggestion: Add null check before accessing user.profile.name

**🚀 Performance**: Consider using Promise.all() here to parallelize API calls
Reference: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/all

**🎨 Style**: Consider extracting this logic into a separate function for reusability
This pattern is used in 3 other places in the codebase

**❓ Question**: Why are we using setTimeout here instead of proper async/await?
Context: This might cause race conditions in tests
```

### ❌ **Vermijd Deze Comments**

```markdown
// ❌ Te vaag
"This doesn't look right"

// ❌ Persoonlijke smaak zonder uitleg
"I don't like this approach"

// ❌ Niet constructief
"This is wrong"

// ❌ Geen context
"Fix this"
```

---

## ⏱️ **Review Process Timing**

| PR Size       | Review Time  | Focus Areas      |
| ------------- | ------------ | ---------------- |
| < 100 lines   | 15 min       | Logic + Security |
| 100-200 lines | 25 min       | + Architecture   |
| 200-400 lines | 40 min       | + Performance    |
| > 400 lines   | **Split PR** | Too large!       |

### 🔄 **Review Rounds**

1. **First Pass (60%)**: Architecture & Logic
2. **Second Pass (30%)**: Implementation Details
3. **Final Pass (10%)**: Style & Documentation

---

## 🚨 **Review Decision Matrix**

### ✅ **Approve When:**

- All automated checks pass
- No security vulnerabilities
- Good test coverage (>80%)
- Code follows team standards
- Clear and maintainable

### 🔄 **Request Changes When:**

- Logic errors or bugs
- Security issues
- Missing critical tests
- Architecture problems
- Breaking team conventions

### 💬 **Comment Only When:**

- Style suggestions
- Performance optimizations
- Alternative approaches
- Learning opportunities
- Non-critical improvements

---

## 📈 **Meetbare Review Success**

### 🎯 **Team Goals**

- **Bug Reduction**: 60% fewer production bugs
- **Knowledge Sharing**: Team learns from each review
- **Code Quality**: Consistent standards across codebase
- **Security**: Zero security vulnerabilities in production
- **Performance**: Maintainable and efficient code

### 📊 **Review Metrics**

- Average review time: < 24 hours
- Review thoroughness: Cover all checklist items
- Team participation: Everyone reviews and gets reviewed
- Learning outcomes: New patterns shared and adopted

---

## 🔧 **Tool Recommendations**

### 🌐 **Browser Extensions**

- **Refined GitHub**: Better PR interface
- **Octotree**: Code tree navigation
- **GitHub File Icons**: Visual file identification

### 📱 **Mobile Apps**

- **GitHub Mobile**: Review on the go
- **Working Copy**: iOS Git client for deep dives

### 🖥️ **Desktop Tools**

- **GitHub CLI**: Command line PR management
- **VS Code GitHub Extension**: IDE integration
- **GitKraken**: Visual Git client

---

## 🎓 **Training & Onboarding**

### 👥 **Voor Nieuwe Team Members**

1. Lees alle documentatie door
2. Doe een shadowed review met senior developer
3. Start met kleinere PRs
4. Vraag om feedback op je review style

### 📚 **Continuous Learning**

- Weekly review retrospectives
- Share interesting findings in standups
- Document new patterns and anti-patterns
- Regular updates van review guidelines

---

## 🚀 **Ready to Review?**

### 📋 **Checklist voor Reviewers**

- [ ] Documentatie gelezen
- [ ] Tools geïnstalleerd
- [ ] Scripts werken (`npm run review:pre-check`)
- [ ] GitHub toegang geconfigureerd
- [ ] Eerste review gepland met mentor

### 🎯 **Start je Eerste Review**

1. Kies een kleine PR (< 100 lines)
2. Gebruik de [Quick Reference](./CODE-REVIEW-QUICK-REF.md)
3. Focus op security en logic eerst
4. Geef constructieve feedback
5. Vraag om feedback op je review

---

**💡 Remember**: Het doel is het verbeteren van de code én het team. Wees constructief, behulpzaam, en focus op het leren! 🚀
