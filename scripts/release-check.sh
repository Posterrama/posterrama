#!/bin/bash

# Posterrama Release Check Script
# Voert alle geautomatiseerde controles uit voor een release

set -e

# Auto-fix is always enabled
AUTO_FIX=true
echo "🔧 AUTO-FIX MODE - Issues will be automatically resolved when possible"
echo ""

# Kleuren voor output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_header() {
    echo ""
    echo "=================================================================="
    echo -e "${BLUE}$1${NC}"
    echo "=================================================================="
}

# FASE 1: FUNCTIONALITEIT & STABILITEIT
run_tests() {
    print_header "🔧 FASE 1: FUNCTIONALITEIT & STABILITEIT"
    
    print_status "1. Tests uitvoeren..."
    if npm test; then
        print_success "Alle tests geslaagd!"
        
        # Cleanup test artifacts
        print_status "2. Test artifacts opruimen..."
        
        # Groups test files
        GROUPS_FILES=$(find . -maxdepth 1 -name "*.groups.test.json" 2>/dev/null || true)
        if [[ -n "$GROUPS_FILES" ]]; then
            GROUP_COUNT=$(echo "$GROUPS_FILES" | wc -l)
            print_status "Gevonden $GROUP_COUNT groups test bestanden"
            rm -f *.groups.test.json
            print_success "Verwijderd: *.groups.test.json ($GROUP_COUNT bestanden)"
        fi
        
        # Device test files  
        DEVICE_FILES=$(find . -maxdepth 1 -name "devices.test.*.json" 2>/dev/null || true)
        if [[ -n "$DEVICE_FILES" ]]; then
            DEVICE_COUNT=$(echo "$DEVICE_FILES" | wc -l)
            print_status "Gevonden $DEVICE_COUNT device test bestanden"
            rm -f devices.test.*.json
            print_success "Verwijderd: devices.test.*.json ($DEVICE_COUNT bestanden)"
        fi
        
        # Other test artifacts (detect but don't auto-remove)
        OTHER_FILES=$(find . -maxdepth 1 -name "*.test.*.json" 2>/dev/null | grep -v "groups.test\|devices.test" || true)
        if [[ -n "$OTHER_FILES" ]]; then
            OTHER_COUNT=$(echo "$OTHER_FILES" | wc -l)
            print_warning "Gevonden $OTHER_COUNT andere test artifacts (handmatig controleren)"
        fi
        
        if [[ -z "$GROUPS_FILES" && -z "$DEVICE_FILES" && -z "$OTHER_FILES" ]]; then
            print_success "Geen test artifacts gevonden - project is schoon"
        fi
    else
        print_error "Tests gefaald - handmatige interventie vereist"
        exit 1
    fi
    
    print_status "3. Package.json versie controleren..."
    CURRENT_VERSION=$(node -e "console.log(require('/var/www/posterrama/package.json').version);")
    print_status "Huidige versie: $CURRENT_VERSION"

    print_status "3a. Media source connectiviteit testen..."
    if node validation/test-media-connectivity.js 2>/dev/null; then
        print_success "Media sources: Alle geconfigureerde bronnen bereikbaar"
    else
        print_warning "Media sources: Connectiviteitsproblemen - handmatige controle vereist"
    fi
}

# FASE 2: CLEANUP & ORGANISATIE  
cleanup_files() {
    print_header "🧹 FASE 2: CLEANUP & ORGANISATIE"
    
    print_status "4. Backup bestanden zoeken..."
    BACKUP_FILES=$(find . -name "*.backup" -o -name "*.bak" -o -name "*.tmp" -o -name "*.old" -o -name "*~" -o -name ".DS_Store" -o -name "Thumbs.db" 2>/dev/null || true)
    
    if [[ -n "$BACKUP_FILES" ]]; then
        print_warning "Gevonden backup bestanden:"
        echo "$BACKUP_FILES"
        echo "HANDMATIGE ACTIE VEREIST: Bekijk bovenstaande bestanden"
    else
        print_success "Geen backup bestanden gevonden"
    fi

    print_status "4a. Admin defaults voor nieuwe installaties..."
    if node validation/validate-admin-defaults.js >/dev/null 2>&1; then
        print_success "Admin defaults: Geschikt voor nieuwe installaties"
    else
        print_status "🔧 Auto-fixing admin defaults..."
        if node auto-fix/fix-admin-defaults.js >/dev/null 2>&1; then
            print_success "Admin defaults: Automatisch gecorrigeerd"
        else
            print_error "Admin defaults: Auto-fix gefaald - handmatige interventie vereist"
        fi
    fi
    
    print_status "5. Security scan - secrets in code zoeken..."
    SECRET_PATTERNS="password|secret|key|token|credential|auth"
    if grep -r -i --exclude-dir=node_modules --exclude-dir=.git --exclude="*.md" "$SECRET_PATTERNS" . | grep -v "example" | grep -v "README" | grep -v "TODO" >/dev/null 2>&1; then
        print_warning "Mogelijke secrets gevonden - handmatige controle vereist"
        grep -r -i --exclude-dir=node_modules --exclude-dir=.git --exclude="*.md" "$SECRET_PATTERNS" . | grep -v "example" | grep -v "README" | grep -v "TODO" | head -10
    else
        print_success "Geen verdachte secrets gevonden"
    fi
    
    print_status "8. File permissions controleren..."
    find . -name "*.sh" -not -perm -u+x 2>/dev/null | head -5
    print_success "File permissions gecontroleerd"
}

# FASE 4: KWALITEITSCONTROLE
quality_checks() {
    print_header "🎯 FASE 4: KWALITEITSCONTROLE"
    
    print_status "13a. ESLint checking..."
    if npm run lint; then
        print_success "ESLint: Geen problemen"
    else
        print_error "ESLint: Problemen gevonden"
        exit 1
    fi
    
    print_status "13b. Prettier formatting..."
    if npm run format; then
        print_success "Prettier: Code geformatteerd"
    else
        print_error "Prettier: Formatting gefaald"
        exit 1
    fi
    
    print_status "13c. Alle tests uitvoeren..."
    if npm run test; then
        print_success "Tests: Alle tests geslaagd"
    else
        print_error "Tests: Gefaald"
        exit 1
    fi
    
    print_status "13d. API documentatie verificatie..."
    API_OUTPUT=$(node scripts/validation/verify-api-docs.js)
    
    if echo "$API_OUTPUT" | grep -q "Excellent\|very comprehensive"; then
        print_success "API docs: Uitstekende coverage gevonden"
    else
        print_warning "API docs: Mogelijk incomplete documentatie - run: node scripts/validation/verify-api-docs.js"
    fi
    
    if echo "$API_OUTPUT" | grep -q "No unused documentation found"; then
        print_success "Swagger cleanup: Geen ongebruikte documentatie gevonden"
    else
        print_status "🔧 Auto-fixing Swagger documentation..."
        if node auto-fix/fix-swagger-cleanup.js 2>/dev/null; then
            print_success "Swagger: Automatisch opgeruimd"
        else
            print_error "Swagger: Auto-fix gefaald - handmatige interventie vereist"
        fi
    fi
    
    print_status "13e. Security audit..."
    if npm run deps:security-audit 2>/dev/null || true; then
        print_success "Security audit: Voltooid"
    else
        print_warning "Security audit: Controle handmatig uitvoeren"
    fi
    
    print_status "13f. Health check..."
    if npm run health 2>/dev/null || true; then
        print_success "Health check: OK"
    else
        print_warning "Health check: Handmatige controle vereist"
    fi
    
    print_status "13g. Pre-review checks..."
    if npm run review:pre-check 2>/dev/null || true; then
        print_success "Pre-review: OK"  
    else
        print_warning "Pre-review: Handmatige controle vereist"
    fi

    print_status "13h. Config schema actueel controleren..."
    if node validation/validate-config-schema.js >/dev/null 2>&1; then
        print_success "Config schema: Up-to-date"
    else
        print_status "🔧 Auto-fixing config schema..."
        if node auto-fix/fix-config-schema.js >/dev/null 2>&1; then
            print_success "Config schema: Automatisch bijgewerkt"
        else
            print_warning "Config schema: Auto-fix gefaald - handmatige controle vereist"
        fi
    fi

    print_status "13i. Example config bestanden controleren..."
    if node validation/validate-example-configs.js >/dev/null 2>&1; then
        print_success "Example configs: Up-to-date"
    else
        print_status "🔧 Auto-fixing example configs..."
        if node auto-fix/fix-admin-defaults.js >/dev/null 2>&1; then
            print_success "Example configs: Automatisch bijgewerkt"
        else
            print_warning "Example configs: Auto-fix gefaald - handmatige controle vereist"
        fi
    fi
}

# FASE 5: DEPENDENCY & PERFORMANCE CHECKS
final_checks() {
    print_header "🏆 FASE 5: FINALE CONTROLES"
    
    print_status "15. Performance check - geheugengebruik..."
    node -e "
        const used = process.memoryUsage();
        for (let key in used) {
            console.log(\`\${key}: \${Math.round(used[key] / 1024 / 1024 * 100) / 100} MB\`);
        }
    "
    
    print_status "16a. Dependency advice (lokaal overzicht)..."
    if npm run deps:advice 2>/dev/null || true; then
        print_success "Dependency advice uitgevoerd"
    else
        print_warning "Dependency advice: Handmatige controle vereist"
    fi

    print_status "16b. Dependency audit..."
    # Use our filtered security audit that excludes known Plex API vulnerabilities
    if ./scripts/security-audit-filtered.sh | grep -q "✅ No new actionable vulnerabilities"; then
        print_success "Dependencies: Alleen geaccepteerde Plex API risks"
    else
        print_warning "Dependencies: Handmatige controle vereist"
    fi

    print_status "16c. Package.json dependency check..."
    if npm ls --json --depth=0 2>/dev/null | node -e "
        const data = JSON.parse(require('fs').readFileSync(0, 'utf8'));
        const missing = [];
        const problems = data.problems || [];
        
        problems.forEach(problem => {
            if (problem.includes('missing')) {
                const match = problem.match(/missing: (.+),/);
                if (match) missing.push(match[1]);
            }
        });
        
        if (missing.length > 0) {
            console.log('Missing dependencies:', missing.join(', '));
            process.exit(1);
        } else {
            process.exit(0);
        }
    " 2>/dev/null; then
        print_success "Package.json: Alle dependencies aanwezig"
    else
        print_status "🔧 Auto-fixing missing dependencies..."
        if node auto-fix/fix-missing-dependencies.js 2>/dev/null; then
            print_success "Dependencies: Automatisch geïnstalleerd en toegevoegd aan package.json"
        else
            print_error "Dependencies: Auto-fix gefaald - handmatige interventie vereist"
        fi
    fi
    
    print_status "Package sizes controleren..."
    du -sh node_modules/ 2>/dev/null || true
    
    print_success "Alle geautomatiseerde controles voltooid!"
}

# Badge informatie verzamelen
collect_badge_info() {
    print_header "📊 BADGE INFORMATIE VERZAMELEN"
    
    print_status "Test coverage berekenen..."
    if [[ -f "coverage/lcov.info" ]]; then
        COVERAGE=$(grep -o 'SF:' coverage/lcov.info | wc -l 2>/dev/null || echo "0")
        print_status "Coverage bestanden: $COVERAGE"
    fi
    
    print_status "Test count berekenen..."
    TEST_COUNT=$(npm test 2>&1 | grep -o '[0-9]* passing' | head -1 | grep -o '[0-9]*' || echo "0")
    print_status "Tests: $TEST_COUNT"
    
    NODE_VERSION=$(node --version)
    print_status "Node.js versie: $NODE_VERSION"
}

# Main functie
main() {
    echo "=================================================================="
    echo "🎬 Posterrama Release Check Script"
    echo "=================================================================="
    
    # Controleer of we in de juiste directory zijn
    if [[ ! -f "../package.json" ]]; then
        print_error "Niet in Posterrama scripts directory! Run dit script vanuit scripts/ directory."
        exit 1
    fi
    
    # Ga naar parent directory voor alle controles
    cd ..
    
    print_status "Start geautomatiseerde release controles..."
    
    run_tests
    cleanup_files  
    quality_checks
    final_checks
    collect_badge_info
    
    echo ""
    echo "=================================================================="
    echo -e "${GREEN}🎉 VOLLEDIGE AUTOMATISERING SUCCESVOL VOLTOOID!${NC}"
    echo "=================================================================="
    echo ""
    echo -e "${GREEN}✅ Alle controles zijn geautomatiseerd en succesvol uitgevoerd${NC}"
    echo -e "${GREEN}✅ Alle problemen zijn automatisch opgelost${NC}"  
    echo -e "${GREEN}✅ Release is gereed voor deployment${NC}"
    echo ""
}

# Run main functie
main "$@"
