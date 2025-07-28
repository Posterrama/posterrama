#!/bin/bash

# Coverage Report Generator for Posterrama
# This script runs tests with coverage and opens the HTML report

echo "🧪 Running tests with coverage..."
npm run test:coverage

echo ""
echo "📊 Coverage Summary:"
echo "================="

# Check if coverage directory exists
if [ -d "coverage" ]; then
    echo "✅ Coverage reports generated successfully!"
    echo ""
    echo "📁 Available reports:"
    echo "   • HTML Report: coverage/lcov-report/index.html"
    echo "   • LCOV Report: coverage/lcov.info"
    echo "   • JSON Report: coverage/coverage-final.json"
    echo ""
    
    # Check if we're in a GUI environment to open the HTML report
    if command -v xdg-open > /dev/null; then
        echo "🌐 Opening HTML coverage report..."
        xdg-open coverage/lcov-report/index.html
    elif command -v open > /dev/null; then
        echo "🌐 Opening HTML coverage report..."
        open coverage/lcov-report/index.html
    else
        echo "💡 To view the HTML report, open: file://$(pwd)/coverage/lcov-report/index.html"
    fi
else
    echo "❌ Coverage reports were not generated. Check for errors above."
    exit 1
fi

echo ""
echo "🎯 Coverage Goals:"
echo "=================="
echo "• Statements: 65%+ (Current: Check output above)"
echo "• Branches: 50%+ (Current: Check output above)"
echo "• Functions: 60%+ (Current: Check output above)"
echo "• Lines: 65%+ (Current: Check output above)"
echo ""
echo "📈 To improve coverage:"
echo "   1. Add tests for uncovered lines"
echo "   2. Test error conditions and edge cases"
echo "   3. Test all code branches (if/else paths)"
echo "   4. Mock external dependencies properly"
