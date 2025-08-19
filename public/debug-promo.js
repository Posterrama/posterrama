// Test script to check promo box visibility
setTimeout(() => {
    console.log('=== PROMO BOX STATUS CHECK ===');
    
    const promoBox = document.getElementById('promo-box');
    const body = document.body;
    
    console.log('Body classes:', body.className);
    console.log('Promo box exists:', !!promoBox);
    
    if (promoBox) {
        console.log('Promo box classes:', promoBox.className);
        console.log('Promo box computed style display:', window.getComputedStyle(promoBox).display);
        console.log('Promo box computed style opacity:', window.getComputedStyle(promoBox).opacity);
        console.log('Promo box computed style visibility:', window.getComputedStyle(promoBox).visibility);
        console.log('Promo box computed style z-index:', window.getComputedStyle(promoBox).zIndex);
    }
    
    // Force show promo box if not visible
    if (promoBox && window.getComputedStyle(promoBox).opacity === '0') {
        console.log('FORCING PROMO BOX VISIBLE');
        body.classList.add('promo-site');
        promoBox.classList.remove('is-hidden');
        promoBox.style.display = 'block';
        promoBox.style.opacity = '1';
        promoBox.style.visibility = 'visible';
        promoBox.style.zIndex = '99999';
    }
}, 2000);
