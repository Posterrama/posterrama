# Pre-commit Hook Setup

Dit project gebruikt een pre-commit hook voor automatische code formatting om consistente code kwaliteit te garanderen.

## Wat doet de pre-commit hook?

De hook wordt automatisch uitgevoerd vóór elke commit en:

1. **Formatteert code** met Prettier op alle staged bestanden (.js, .jsx, .ts, .tsx, .json, .css, .html, .md)
2. **Auto-fix ESLint issues** op JavaScript/TypeScript bestanden waar mogelijk
3. **Voegt geformatteerde bestanden** automatisch terug toe aan staging
4. **Waarschuwt** voor resterende lint issues (maar blokkeert commit niet)

## Installatie

De hook is al geïnstalleerd, maar om zeker te zijn dat deze executable is:

```bash
npm run hooks:install
```

## Testen

Je kunt de pre-commit hook handmatig testen:

```bash
npm run hooks:test
```

## Hoe het werkt

Wanneer je `git commit` uitvoert:

1. 🚀 Hook start en controleert staged bestanden
2. 📝 Prettier formatteert alle ondersteunde bestanden
3. 🔧 ESLint probeert JavaScript issues automatisch te fixen
4. 📥 Geformatteerde bestanden worden toegevoegd aan staging
5. 🔍 Finale lint check (waarschuwing alleen)
6. ✅ Commit gaat door

## Voorbeeld output

```
🚀 Running pre-commit formatting...
📝 Formatting staged files with Prettier...
server.js 45ms
🔧 Running ESLint auto-fix...
📥 Adding formatted files back to staging...
🔍 Checking for remaining lint issues...
✅ Pre-commit formatting completed!
```

## Hook uitschakelen (tijdelijk)

Als je de hook tijdelijk wilt overslaan:

```bash
git commit --no-verify -m "Emergency commit without formatting"
```

## Hook locatie

De hook staat in: `.git/hooks/pre-commit`

## Ondersteunde bestanden

- JavaScript: `.js`, `.jsx`, `.ts`, `.tsx`
- Styling: `.css`
- Markup: `.html`
- Data: `.json`
- Documentation: `.md`

## Troubleshooting

### Hook werkt niet

```bash
chmod +x .git/hooks/pre-commit
```

### Npm niet gevonden

Zorg dat Node.js en npm geïnstalleerd zijn.

### Formatting fails

Controleer of Prettier en ESLint dependencies geïnstalleerd zijn:

```bash
npm install
```
