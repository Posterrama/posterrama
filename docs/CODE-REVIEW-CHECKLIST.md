# 🔍 Code Review: Waar op te Letten

Een praktische gids met concrete punten waar je tijdens code reviews op moet letten.

## 🎯 De Vier Pijlers van Code Review

### 1. 🐛 **Correctness** - Werkt de code?

### 2. 🏗️ **Design** - Is de architectuur goed?

### 3. 🎨 **Style** - Volgt het team standards?

### 4. 🚀 **Performance** - Is het efficiënt?

---

## 🔍 Concrete Review Punten

### 1. 🐛 **Functionaliteit & Correctness**

#### ✅ Basis Controles

- [ ] **Doet de code wat het belooft?**

    ```javascript
    // ❌ Functie naam klopt niet met implementatie
    function getUserById(users) {
        return users.filter(user => user.active); // Filtert actieve users!
    }

    // ✅ Juiste naam
    function getActiveUsers(users) {
        return users.filter(user => user.active);
    }
    ```

- [ ] **Edge cases afgehandeld?**

    ```javascript
    // ❌ Geen null check
    function getFullName(user) {
        return user.firstName + ' ' + user.lastName;
    }

    // ✅ Met validatie
    function getFullName(user) {
        if (!user || !user.firstName || !user.lastName) {
            return 'Unknown User';
        }
        return user.firstName + ' ' + user.lastName;
    }
    ```

- [ ] **Error handling aanwezig?**

    ```javascript
    // ❌ Geen error handling
    async function fetchUserData(id) {
        const response = await fetch(`/api/users/${id}`);
        return response.json();
    }

    // ✅ Met proper error handling
    async function fetchUserData(id) {
        try {
            const response = await fetch(`/api/users/${id}`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            return await response.json();
        } catch (error) {
            logger.error('Failed to fetch user data:', error);
            throw new Error('User data unavailable');
        }
    }
    ```

#### 🧪 Testing

- [ ] **Unit tests aanwezig voor nieuwe functionaliteit?**
- [ ] **Tests dekken happy path én edge cases?**
- [ ] **Test namen zijn beschrijvend?**

    ```javascript
    // ❌ Onduidelijke test naam
    test('user test', () => { ... });

    // ✅ Beschrijvende naam
    test('should return empty string when user has no firstName', () => { ... });
    ```

### 2. 🏗️ **Design & Architectuur**

#### 📐 Code Structuur

- [ ] **Single Responsibility Principle**

    ```javascript
    // ❌ Te veel verantwoordelijkheden
    function processUser(userData) {
      // Validatie
      if (!userData.email) throw new Error('Email required');
      // Database save
      database.save(userData);
      // Email versturen
      emailService.sendWelcome(userData.email);
      // Logging
      console.log('User processed');
    }

    // ✅ Gescheiden verantwoordelijkheden
    function validateUser(userData) { ... }
    function saveUser(userData) { ... }
    function sendWelcomeEmail(email) { ... }
    ```

- [ ] **DRY (Don't Repeat Yourself)**

    ```javascript
    // ❌ Code duplication
    function calculateTotalPrice(items) {
        let total = 0;
        for (let item of items) {
            total += item.price * item.quantity;
        }
        return total * 1.21; // BTW
    }

    function calculateNetPrice(items) {
        let total = 0;
        for (let item of items) {
            total += item.price * item.quantity;
        }
        return total;
    }

    // ✅ Herbruikbare functie
    function calculateItemsTotal(items) {
        return items.reduce((total, item) => total + item.price * item.quantity, 0);
    }

    function calculateNetPrice(items) {
        return calculateItemsTotal(items);
    }

    function calculateTotalPrice(items) {
        return calculateItemsTotal(items) * 1.21;
    }
    ```

#### 🔗 Dependencies

- [ ] **Nieuwe dependencies gerechtvaardigd?**
- [ ] **Import statements georganiseerd?**

    ```javascript
    // ✅ Georganiseerde imports
    // Third-party libraries eerst
    const express = require('express');
    const axios = require('axios');

    // Dan local modules
    const userService = require('./services/userService');
    const validation = require('./utils/validation');
    ```

### 3. 🎨 **Code Style & Leesbaarheid**

#### 📝 Naming Conventions

- [ ] **Variabelen zijn beschrijvend**

    ```javascript
    // ❌ Onduidelijke namen
    const d = new Date();
    const u = users.filter(x => x.a);

    // ✅ Beschrijvende namen
    const currentDate = new Date();
    const activeUsers = users.filter(user => user.isActive);
    ```

- [ ] **Functies beginnen met werkwoord**

    ```javascript
    // ❌ Onduidelijk wat functie doet
    function userEmail(user) { ... }

    // ✅ Duidelijke actie
    function getUserEmail(user) { ... }
    function validateUserEmail(email) { ... }
    function sendUserEmail(user, template) { ... }
    ```

#### 🎯 Function Design

- [ ] **Functies zijn klein (< 50 regels)**
- [ ] **Maximaal 3-4 parameters**

    ```javascript
    // ❌ Te veel parameters
    function createUser(firstName, lastName, email, phone, address, city, zipCode, country) {
        // ...
    }

    // ✅ Object parameter
    function createUser(userInfo) {
        const { firstName, lastName, email, phone, address } = userInfo;
        // ...
    }
    ```

#### 💬 Comments & Documentation

- [ ] **Comments verklaren WAAROM, niet WAT**

    ```javascript
    // ❌ Wat het doet (obvious)
    const users = []; // Array voor users

    // ❌ Wat het doet (nutteloos)
    users.push(newUser); // Voeg user toe aan array

    // ✅ Waarom we dit doen
    // Cache users locally to reduce API calls during bulk operations
    const userCache = [];

    // ✅ Complexe business logic uitleg
    // Apply 10% discount for orders > €100, but only for premium customers
    // as per business rule BR-2024-003
    if (order.total > 100 && customer.isPremium) {
        order.total *= 0.9;
    }
    ```

### 4. 🔒 **Security & Best Practices**

#### 🛡️ Security Checks

- [ ] **Input validatie aanwezig?**

    ```javascript
    // ❌ Geen validatie
    app.post('/api/users', (req, res) => {
        const user = new User(req.body);
        user.save();
    });

    // ✅ Input validatie
    app.post('/api/users', validate(userSchema), (req, res) => {
        const sanitizedData = sanitize(req.body);
        const user = new User(sanitizedData);
        user.save();
    });
    ```

- [ ] **Geen sensitive data in logs?**

    ```javascript
    // ❌ Wachtwoord in log
    console.log('User login attempt:', { username, password });

    // ✅ Geen sensitive data
    logger.info('User login attempt:', { username, timestamp: Date.now() });
    ```

- [ ] **SQL injection prevention?**

    ```javascript
    // ❌ SQL injection risico
    const query = `SELECT * FROM users WHERE id = ${userId}`;

    // ✅ Prepared statements
    const query = 'SELECT * FROM users WHERE id = ?';
    database.query(query, [userId]);
    ```

#### 🚀 Performance

- [ ] **Geen onnodige loops of calls?**

    ```javascript
    // ❌ N+1 probleem
    users.forEach(user => {
        const profile = getUserProfile(user.id); // Database call per user!
    });

    // ✅ Batch loading
    const userIds = users.map(user => user.id);
    const profiles = getUserProfiles(userIds); // Single database call
    ```

- [ ] **Memory leaks voorkomen?**

    ```javascript
    // ❌ Event listener niet opgeruimd
    element.addEventListener('click', handler);

    // ✅ Cleanup
    element.addEventListener('click', handler);
    // Later...
    element.removeEventListener('click', handler);
    ```

### 5. 📱 **Frontend Specifiek**

#### 🎨 React/Component Checks

- [ ] **Props validation (PropTypes/TypeScript)?**
- [ ] **Key props in lists?**
- [ ] **useEffect dependencies correct?**
- [ ] **Geen inline functions in render?**

#### 🌐 API Integration

- [ ] **Loading states getoond?**
- [ ] **Error states afgehandeld?**
- [ ] **Race conditions voorkomen?**

### 6. 🖥️ **Backend Specifiek**

#### 🔌 API Design

- [ ] **RESTful endpoints?**
- [ ] **Proper HTTP status codes?**
- [ ] **Rate limiting overwogen?**
- [ ] **API versioning consistent?**

#### 💾 Database

- [ ] **Indexes overwogen?**
- [ ] **Transactions waar nodig?**
- [ ] **Migration scripts aanwezig?**

---

## 🎯 Review Process Tips

### ⏰ **Timing & Scope**

- **Small PRs**: Max 400 regels code
- **Review binnen 24 uur**
- **Max 60 minuten per review sessie**

### 💬 **Communication**

- **Constructief feedback**: "Consider using..." ipv "This is wrong"
- **Explain the why**: Link naar documentatie/standards
- **Acknowledge good code**: Positive feedback motivates

### 🔄 **Review Rounds**

- **First pass**: High-level architecture
- **Second pass**: Implementation details
- **Final pass**: Nits and style

### 📝 **Review Comments Templates**

```markdown
## 🐛 Bug/Logic Issue

**Issue**: [Describe what's wrong]
**Impact**: [What could happen]
**Suggestion**: [How to fix]

## 🎨 Style/Convention

**Convention**: [Which rule/standard]
**Current**: [What it is now]
**Expected**: [What it should be]

## 🚀 Performance

**Concern**: [Performance issue]
**Impact**: [When this matters]
**Alternative**: [Better approach]

## ❓ Question/Clarification

**Question**: [What's unclear]
**Context**: [Why this matters]
```

---

## 🚦 Review Approval Criteria

### ✅ **Approve When:**

- All automated checks pass
- Code follows team standards
- No security concerns
- Good test coverage
- Clear and maintainable

### 🔄 **Request Changes When:**

- Bugs or logic errors
- Security vulnerabilities
- Missing tests for critical paths
- Violates team standards
- Unclear or confusing code

### 💬 **Comment Only When:**

- Suggestions for improvement
- Questions for understanding
- Style nitpicks (non-blocking)
- Learning opportunities

---

## 📚 Handige Tools

### 🔧 **Browser Extensions**

- **Refined GitHub** - Betere GitHub interface
- **Octotree** - Code tree in sidebar
- **GitHub File Icons** - File type icons

### 📊 **Code Quality Tools**

- **SonarQube** - Static analysis
- **CodeClimate** - Maintainability scores
- **DeepCode** - AI-powered code review

### 📝 **Templates & Checklists**

- Review checklist in PR template
- Automated checks status
- Security assessment checklist

---

**Remember**: Het doel van code review is het verbeteren van de code én het team. Focus op leermogelijkheden en bouw een cultuur van constructieve feedback! 🚀
