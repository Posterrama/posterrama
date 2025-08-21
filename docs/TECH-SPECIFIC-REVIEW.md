# 🔍 Technology-Specific Review Points

## 🟨 JavaScript/Node.js

### 🔧 **Common Issues**

```javascript
// ❌ Problematic patterns to catch
var globalVar; // Use const/let
callback(err, data); // Use Promises/async-await
if (user == null)
    // Use ===
    setTimeout(() => {}, 0); // Code smell
eval(userInput); // Security risk
```

### ✅ **Good Patterns to Look For**

```javascript
// ✅ Modern JavaScript patterns
const config = Object.freeze({}); // Immutable config
const result = await apiCall(); // Async/await
if (user === null) return; // Strict equality
const users = [...oldUsers, newUser]; // Spread operator
```

### 🔍 **Review Checklist**

- [ ] No `var` declarations (use `const`/`let`)
- [ ] Async functions use `async/await` not callbacks
- [ ] Strict equality (`===`) used
- [ ] No `eval()` or `Function()` constructor
- [ ] No global variables
- [ ] Promises have error handling
- [ ] No blocking operations in main thread

---

## ⚛️ React/Frontend

### 🔧 **Common React Issues**

```jsx
// ❌ Problems to catch
function Component() {
    const [data, setData] = useState();
    useEffect(() => {
        fetchData().then(setData); // Missing dependency array
    });

    return data.map(
        (
            item // Missing key prop
        ) => (
            <div onClick={() => handle(item.id)}>
                {' '}
                // Inline function
                {item.name}
            </div>
        )
    );
}
```

### ✅ **Good React Patterns**

```jsx
// ✅ Better implementation
function Component() {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchData()
            .then(setData)
            .catch(console.error)
            .finally(() => setLoading(false));
    }, []); // Proper dependency array

    const handleClick = useCallback(id => {
        // Handler outside render
    }, []);

    if (loading) return <Spinner />;

    return data.map(item => (
        <div key={item.id} onClick={() => handleClick(item.id)}>
            {item.name}
        </div>
    ));
}
```

### 🔍 **React Review Checklist**

- [ ] `key` props in lists
- [ ] `useEffect` dependencies correct
- [ ] No inline functions in render
- [ ] PropTypes or TypeScript types
- [ ] Loading/error states handled
- [ ] No memory leaks (cleanup in useEffect)
- [ ] Accessible markup (ARIA, semantic HTML)

---

## 🚀 Express.js/Backend

### 🔧 **Common Backend Issues**

```javascript
// ❌ Security and performance issues
app.get('/users/:id', (req, res) => {
    const query = `SELECT * FROM users WHERE id = ${req.params.id}`; // SQL injection
    const user = db.query(query); // No error handling
    res.json(user); // No validation
});
```

### ✅ **Secure Backend Patterns**

```javascript
// ✅ Secure implementation
app.get(
    '/users/:id',
    validate(userIdSchema), // Input validation
    async (req, res, next) => {
        try {
            const userId = parseInt(req.params.id);
            if (isNaN(userId)) {
                return res.status(400).json({ error: 'Invalid user ID' });
            }

            const user = await db.query(
                // Parameterized query
                'SELECT id, name, email FROM users WHERE id = ?',
                [userId]
            );

            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            res.json(sanitizeUser(user)); // Sanitize output
        } catch (error) {
            next(error); // Proper error handling
        }
    }
);
```

### 🔍 **Backend Review Checklist**

- [ ] Input validation middleware
- [ ] Parameterized SQL queries
- [ ] Proper HTTP status codes
- [ ] Error handling middleware
- [ ] Rate limiting for public endpoints
- [ ] Authentication/authorization checks
- [ ] No sensitive data in responses
- [ ] Logging without sensitive data

---

## 🗃️ Database

### 🔧 **Database Issues**

```sql
-- ❌ Performance and security issues
SELECT * FROM users;                    -- Select all columns
SELECT * FROM orders WHERE user_id = 1; -- No index on user_id
UPDATE users SET status = 'active';     -- No WHERE clause!
```

### ✅ **Good Database Patterns**

```sql
-- ✅ Optimized queries
SELECT id, name, email FROM users WHERE active = 1 LIMIT 100;
SELECT o.* FROM orders o WHERE o.user_id = ? AND o.created_at > ?;
CREATE INDEX idx_orders_user_id ON orders(user_id);
```

### 🔍 **Database Review Checklist**

- [ ] SELECT specific columns, not `*`
- [ ] Proper indexes for query performance
- [ ] WHERE clauses prevent full table scans
- [ ] Parameterized queries prevent SQL injection
- [ ] Transactions for related operations
- [ ] Migration scripts for schema changes

---

## 🧪 Testing

### 🔧 **Test Issues**

```javascript
// ❌ Poor testing practices
test('user test', () => {
    // Vague test name
    const result = getUserName();
    expect(result).toBeTruthy(); // Weak assertion
});

test('api test', async () => {
    const user = await createUser(); // No cleanup
    // Test logic...
});
```

### ✅ **Good Testing Patterns**

```javascript
// ✅ Clear, maintainable tests
describe('User Service', () => {
    afterEach(() => {
        cleanup(); // Proper cleanup
    });

    test('should return full name when user has firstName and lastName', () => {
        const user = { firstName: 'John', lastName: 'Doe' };
        const result = getUserName(user);
        expect(result).toBe('John Doe'); // Specific assertion
    });

    test('should throw error when user is null', () => {
        expect(() => getUserName(null)).toThrow('User is required');
    });
});
```

### 🔍 **Testing Review Checklist**

- [ ] Descriptive test names
- [ ] Tests cover happy path and edge cases
- [ ] Proper setup/teardown
- [ ] Specific assertions (not just truthy/falsy)
- [ ] Mocks for external dependencies
- [ ] No test interdependencies
- [ ] Performance tests for critical paths

---

## 🔒 Security Focused Review

### 🚨 **Critical Security Checks**

- [ ] **Input Validation**: All user inputs validated/sanitized
- [ ] **Authentication**: Protected endpoints have auth checks
- [ ] **Authorization**: Users can only access their own data
- [ ] **SQL Injection**: Parameterized queries used
- [ ] **XSS Prevention**: Output encoding/escaping
- [ ] **CSRF Protection**: CSRF tokens for state-changing operations
- [ ] **Secrets Management**: No hardcoded secrets/passwords
- [ ] **Error Handling**: No sensitive data in error messages

### 🔍 **Security Code Patterns**

```javascript
// ✅ Security best practices
const user = await User.findById(req.user.id); // Use authenticated user ID
const sanitized = validator.escape(req.body.comment);
const hashedPassword = await bcrypt.hash(password, 12);
if (!user || user.id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
}
```

---

## 🎯 **Review Priority Matrix**

| Priority          | What to Check                        | Time Focus |
| ----------------- | ------------------------------------ | ---------- |
| **P0 - Critical** | Security vulnerabilities, Logic bugs | 40%        |
| **P1 - High**     | Architecture issues, Performance     | 30%        |
| **P2 - Medium**   | Code quality, Standards              | 20%        |
| **P3 - Low**      | Style, Documentation                 | 10%        |

---

**💡 Pro Tip**: Start with security and logic, then work your way down to style issues!
