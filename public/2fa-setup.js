document.addEventListener('DOMContentLoaded', () => {
    const qrCodeContainer = document.getElementById('qr-code-container');
    const secretKeyContainer = document.getElementById('secret-key-container');
    const errorMessage = document.getElementById('error-message');
    const form = document.querySelector('form');

    // Check for error from previous verification attempt
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('error')) {
        errorMessage.textContent = 'Invalid or expired code. Please try again.';
        errorMessage.style.display = 'block';
    }

    /**
     * Displays a fatal error message, hides the form, and provides a link to restart the setup.
     * @param {string} message The error message to display.
     */
    function displayFatalError(message) {
        qrCodeContainer.innerHTML = `<p class="error-text">${message}</p>`;
        secretKeyContainer.textContent = 'Error loading secret.';
        if (form) {
            form.style.display = 'none'; // Hide the verification form
        }
        const p = document.createElement('p');
        const a = document.createElement('a');
        a.href = '/admin/setup';
        a.textContent = 'Start Over';
        a.className = 'button-secondary'; // Use existing styles for a consistent look
        p.style.marginTop = '1rem';
        p.appendChild(a);
        qrCodeContainer.appendChild(p);
    }

    // Fetch the QR code and secret from the server
    async function loadQrCode() {
        try {
            const response = await fetch('/api/admin/2fa-qr-code');
            if (!response.ok) {
                let errorMsg = `HTTP error! Status: ${response.status}`;
                try {
                    const errorData = await response.json();
                    errorMsg = errorData.error || errorMsg;
                } catch (e) {
                    // Ignore if response is not JSON, use the status text.
                    errorMsg = response.statusText;
                }
                throw new Error(errorMsg);
            }
            const data = await response.json();

            qrCodeContainer.innerHTML = ''; // Clear "Loading..." text
            const qrImg = document.createElement('img');
            qrImg.src = data.qr;
            qrImg.alt = 'Scan this QR code with your authenticator app';
            qrCodeContainer.appendChild(qrImg);
            secretKeyContainer.textContent = data.secret;

        } catch (error) {
            console.error('Failed to load 2FA setup data:', error);
            displayFatalError(error.message || 'Could not fetch 2FA data. Please restart setup.');
        }
    }

    loadQrCode();
});