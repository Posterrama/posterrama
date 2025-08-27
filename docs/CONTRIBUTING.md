# Contributing to Posterrama

Thank you for your interest in contributing to Posterrama! This guide covers development setup, code review guidelines, and best practices.

## 🚀 Development Setup

### Prerequisites

- Node.js ≥18.0.0
- npm ≥9.0.0
- Git

### Setup

```bash
git clone https://github.com/Posterrama/posterrama.git
cd posterrama
npm install
npm test
```

### Development Scripts

```bash
npm start          # Start development server
npm test           # Run all tests
npm run lint       # Check code style
npm run format     # Format code
```

## 🔍 Code Review Guidelines

### What to Review

1. **Functionality** - Does the code work as intended?
    - Test edge cases and error handling
    - Verify requirements are met
    - Check for regressions

2. **Architecture** - Is the code well-designed?
    - Single Responsibility Principle
    - No code duplication (DRY)
    - Logical organization

3. **Code Style** - Follows project standards?
    - Consistent naming conventions
    - Clear comments (explain why, not what)
    - Proper error handling

4. **Performance** - Is it efficient?
    - No unnecessary database calls
    - Memory leak prevention
    - Efficient algorithms

### Review Process

1. **Small PRs** - Keep changes focused and reviewable
2. **Clear descriptions** - Explain what and why
3. **Tests** - Include tests for new functionality
4. **Documentation** - Update docs for user-facing changes

### Code Standards

- Use ESLint configuration
- Follow existing patterns
- Write descriptive commit messages
- Add JSDoc for public APIs

## 🧪 Testing

### Running Tests

```bash
npm test                    # All tests
npm test -- --watch        # Watch mode
npm test sources           # Specific test suite
```

### Test Structure

- Unit tests: `__tests__/unit/`
- Integration tests: `__tests__/api/`
- Source tests: `__tests__/sources/`

### Coverage Requirements

- Maintain >80% code coverage
- Test both success and error paths
- Mock external dependencies

## 📦 Dependencies

### Adding Dependencies

1. Check if functionality already exists
2. Evaluate package health (maintenance, security)
3. Consider bundle size impact
4. Add to appropriate category in `package.json`

### Dependency Categories

- **Production**: Runtime requirements
- **Development**: Build tools, testing, linting
- **Peer**: Optional integrations

### Security

- Run `npm audit` before commits
- Keep dependencies updated
- Review security advisories

## 🚢 Release Process

1. Update version in `package.json`
2. Update `CHANGELOG.md`
3. Create release notes
4. Tag release
5. Update documentation

## 💡 Best Practices

### Git Workflow

- Use descriptive branch names
- Write clear commit messages
- Squash related commits
- Keep history clean

### Documentation

- Update README for user-facing changes
- Add JSDoc for new APIs
- Include examples in documentation
- Keep documentation concise

### Performance

- Optimize for common use cases
- Cache expensive operations
- Use async/await for I/O
- Monitor memory usage

## 🐛 Bug Reports

Include:

- Steps to reproduce
- Expected vs actual behavior
- Environment details
- Relevant logs

## 💬 Questions?

- Open a GitHub Discussion
- Check existing issues
- Review documentation

Thank you for contributing to Posterrama! 🎬
