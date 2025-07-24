document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const errorMessageEl = document.getElementById('error-message');
    const submitButton = document.getElementById('submit-button');

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const originalButtonText = submitButton.textContent;
        submitButton.textContent = 'Processing...';
        submitButton.disabled = true;
        errorMessageEl.classList.add('is-hidden');

        const formData = new FormData(loginForm);
        const data = Object.fromEntries(formData.entries());

        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data),
            });

            if (response.ok) {
                // After a successful login for debug, go directly to the debug page.
                window.location.href = '/debug';
            } else {
                const errorData = await response.json();
                errorMessageEl.textContent = errorData.error || 'Unknown login error.';
                errorMessageEl.classList.remove('is-hidden');
            }
        } catch (error) {
            errorMessageEl.textContent = 'Could not reach the server.';
            errorMessageEl.classList.remove('is-hidden');
        } finally {
            submitButton.textContent = originalButtonText;
            submitButton.disabled = false;
        }
    });
});