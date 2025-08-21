# 🎯 Code Review - Antwoord op "Waar moet ik op letten?"

## 📋 **TL;DR - De Essentie**

Bij code reviews let je op **4 hoofdzaken**:

### 1. 🐛 **Werkt het?** (Correctness)

- Doet de code wat het belooft?
- Zijn edge cases afgehandeld?
- Is er proper error handling?

### 2. 🏗️ **Is het goed ontworpen?** (Architecture)

- Single Responsibility Principle
- Geen code duplicatie (DRY)
- Logische code organisatie

### 3. 🎨 **Volgt het de standards?** (Style)

- Team coding standards
- Duidelijke namen
- Goede comments (waarom, niet wat)

### 4. 🚀 **Is het efficiënt?** (Performance)

- Geen onnodige database calls
- Memory leaks voorkomen
- Efficiënte algoritmes

---

## 🔍 **Concrete Checklist - Per Review**

### ⚡ **Snelle Check (5 min)**

- [ ] PR titel en beschrijving duidelijk?
- [ ] Automated checks (tests/linting) slagen?
- [ ] Redelijke PR grootte (<400 regels)?
- [ ] Geen merge conflicts?

### 🔒 **Security Check (5 min)**

- [ ] Input validatie aanwezig?
- [ ] Geen hardcoded secrets?
- [ ] SQL injection safe?
- [ ] XSS preventie?

### 🧪 **Functionality Check (10 min)**

- [ ] Tests voor nieuwe features?
- [ ] Edge cases getest?
- [ ] Error handling correct?
- [ ] Code doet wat PR beschrijft?

### 🎨 **Quality Check (10 min)**

- [ ] Functies klein en gefocust (<50 regels)?
- [ ] Duidelijke variabele namen?
- [ ] Geen code duplicatie?
- [ ] Comments verklaren WAAROM?

---

## 🚨 **Red Flags - Direct Rejecten**

### ❌ **Kritieke Issues**

- Hardcoded passwords/secrets
- SQL injection kwetsbaarheden
- Ontbrekende tests voor nieuwe features
- Security audit failures
- Breaking changes zonder documentatie

### ⚠️ **Request Changes**

- Functies langer dan 50 regels
- Ontbrekende input validatie
- Onduidelijke variabele namen
- Geen error handling in kritieke paden

---

## 💬 **Effectieve Review Comments**

### ✅ **Goede Voorbeelden**

```markdown
🐛 **Bug**: Dit kan undefined returnen als user.profile null is
Suggestie: Voeg null check toe voor user.profile.name

🚀 **Performance**: Overweeg Promise.all() voor parallelle API calls
Link: https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Promise/all

🎨 **Style**: Extraheer deze logic naar aparte functie voor herbruikbaarheid
Context: Dit patroon wordt op 3 andere plekken gebruikt
```

### ❌ **Vermijd**

- "Dit ziet er niet goed uit" (te vaag)
- "Ik vind dit niet mooi" (persoonlijke smaak)
- "Dit is fout" (niet constructief)

---

## 🛠️ **Praktische Tools**

### 📝 **Scripts voor Dagelijks Gebruik**

```bash
# Voor submitter: check voor review
npm run review:pre-check

# Voor reviewer: project health
npm run health

# Lokaal testen van PR
gh pr checkout [PR-number]
npm test
```

### 🔍 **Browser Tools**

- **Refined GitHub**: Betere PR interface
- **Octotree**: Code navigation
- **GitHub File Icons**: Visuele file identificatie

---

## ⏱️ **Time Management**

| PR Grootte     | Review Tijd   | Focus            |
| -------------- | ------------- | ---------------- |
| <100 regels    | 15 min        | Security + Logic |
| 100-200 regels | 25 min        | + Architecture   |
| 200-400 regels | 40 min        | + Performance    |
| >400 regels    | **Split PR!** | Te groot         |

---

## 📚 **Volledige Documentatie**

Voor diepere details, zie de volledige gidsen:

1. **[CODE-REVIEW-MASTER-GUIDE.md](./CODE-REVIEW-MASTER-GUIDE.md)** - Complete overzicht
2. **[CODE-REVIEW-CHECKLIST.md](./CODE-REVIEW-CHECKLIST.md)** - Uitgebreide checklist
3. **[CODE-REVIEW-QUICK-REF.md](./CODE-REVIEW-QUICK-REF.md)** - 30-seconden referentie
4. **[TECH-SPECIFIC-REVIEW.md](./TECH-SPECIFIC-REVIEW.md)** - JavaScript/Node.js specifiek

---

## 🎯 **Prioriteiten Matrix**

Focus je aandacht zo:

| Priority | Check                     | Time |
| -------- | ------------------------- | ---- |
| **P0**   | Security vulnerabilities  | 40%  |
| **P1**   | Logic bugs & architecture | 30%  |
| **P2**   | Code quality & standards  | 20%  |
| **P3**   | Style & documentation     | 10%  |

---

## 🚀 **Start Direct**

1. **Pak een kleine PR** (<100 regels)
2. **Gebruik de snelle checklist** hierboven
3. **Focus op security en logic** eerst
4. **Geef constructieve feedback**
5. **Vraag om feedback** op je review style

---

**💡 Onthoud**: Het doel is het team beter maken, niet alleen de code. Wees behulpzaam en constructief! 🤝
