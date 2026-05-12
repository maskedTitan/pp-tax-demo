<script>
    import { onMount, onDestroy } from 'svelte';
    import { calculateTax, calculateTotal, getTaxRate } from '$lib/taxRates.js';

    const PRODUCT_SUBTOTAL = '10.00';

    // Phase: 'loading' | 'new-user' | 'returning-user'
    let phase = 'loading';
    let storedPmt = null;

    let paypalContainerRef;
    let savedPmContainerRef;
    let submitBtnRef;

    let clientToken = null;
    let paypalCheckoutInstance = null;

    // Checkout state
    let checkoutData = null;
    let paymentSuccess = false;
    let paymentResult = null;
    let errorMessage = '';

    // Address
    let serviceAddress = {
        firstName: 'John', lastName: 'Doe',
        street: '1 Rocket Rd', city: 'Hawthorne',
        stateOrProvince: 'CA', postalCode: '90250', country: 'US'
    };

    $: currentTax = calculateTax(PRODUCT_SUBTOTAL, serviceAddress.stateOrProvince);
    $: currentTotal = calculateTotal(PRODUCT_SUBTOTAL, serviceAddress.stateOrProvince);
    $: currentTaxRate = getTaxRate(serviceAddress.stateOrProvince);

    // Developer logs
    let logs = [];
    function log(step, data = null) {
        const timestamp = new Date().toLocaleTimeString();
        logs = [...logs, { step, data, timestamp }];
        console.log(`[SPM] ${step}`, data || '');
    }

    onMount(async () => {
        await detectPhase();
    });

    async function detectPhase() {
        log('Checking vault session for stored PMT...');
        const res = await fetch('/api/braintree/vault-session');
        const data = await res.json();
        storedPmt = data.paymentMethodToken;

        if (storedPmt) {
            log('PMT found in session — returning user flow', { pmt: storedPmt });
            phase = 'returning-user';
            await initReturningUser();
        } else {
            log('No PMT in session — new user flow');
            phase = 'new-user';
            await initNewUser();
        }
    }

    // ─── New User: vault via Buttons ───────────────────────────────────────────

    async function initNewUser() {
        try {
            log('Fetching client token (no PMT)...');
            const res = await fetch('/api/braintree/client-token');
            const data = await res.json();
            clientToken = data.clientToken;
            log('Client token received');

            const braintree = await import('braintree-web');

            log('Creating Braintree client instance...');
            const clientInstance = await braintree.client.create({ authorization: clientToken });

            log('Creating PayPal Checkout instance...');
            paypalCheckoutInstance = await braintree.paypalCheckout.create({
                client: clientInstance
            });

            log('Loading PayPal SDK...');
            await paypalCheckoutInstance.loadPayPalSDK({
                currency: 'USD',
                vault: true,
                components: 'buttons,messages'
            });

            if (paypalContainerRef) paypalContainerRef.innerHTML = '';

            log('Rendering Buttons (vault / requestBillingAgreement flow) ...');
            window.paypal.Buttons({
                fundingSource: window.paypal.FUNDING.PAYPAL,
                style: { height: 48, shape: 'rect', color: 'black' },
                createBillingAgreement: () => {
                    log('createBillingAgreement called — vault flow');
                    return paypalCheckoutInstance.createPayment({
                        flow: 'vault',
                        currency: 'USD',
                        requestBillingAgreement: true,
                        displayName: 'SpaceX Parts Store'
                    });
                },
                onApprove: (data) => {
                    log('onApprove — tokenizing payment', data);
                    return paypalCheckoutInstance.tokenizePayment(data, async (err, payload) => {
                        if (err) {
                            log('Tokenization error', err);
                            errorMessage = err.message || 'Failed to tokenize payment';
                            return;
                        }
                        log('Payment tokenized', { nonce: payload.nonce, type: payload.type });
                        await vaultAndStore(payload);
                    });
                },
                onError: (err) => {
                    log('PayPal error', err);
                    errorMessage = err.message || 'PayPal error';
                }
            }).render(paypalContainerRef);

            log('Buttons rendered — waiting for consumer to vault a PayPal account');
        } catch (err) {
            log('initNewUser error', { message: err.message });
            errorMessage = err.message || 'Initialization failed';
        }
    }

    async function vaultAndStore(payload) {
        try {
            log('Submitting nonce to /api/braintree/checkout to vault...');
            const res = await fetch('/api/braintree/checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    nonce: payload.nonce,
                    createCustomer: true,
                    amount: currentTotal.toString()
                })
            });
            const result = await res.json();
            log('Vault checkout result', result);

            if (!result.success) {
                errorMessage = `Vault failed: ${result.error}`;
                return;
            }

            const vaultToken = result.vaultToken;
            if (vaultToken) {
                log('Storing PMT in server session', { vaultToken });
                await fetch('/api/braintree/vault-session', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ paymentMethodToken: vaultToken })
                });
                storedPmt = vaultToken;
            }

            paymentSuccess = true;
            paymentResult = {
                transactionId: result.transactionId,
                nonce: payload.nonce,
                vaultToken,
                phase: 'new-user-vault'
            };
            log('Vault complete — PMT stored. Reload page to demo returning user flow.');
        } catch (err) {
            log('vaultAndStore error', { message: err.message });
            errorMessage = err.message || 'Failed to vault payment';
        }
    }

    // ─── Returning User: SavedPaymentMethods ───────────────────────────────────

    async function initReturningUser() {
        try {
            // Try to embed the PMT in the client token for identity resolution.
            // Falls back to a plain token if Braintree rejects it (e.g. anonymous vault entry).
            log('Fetching client token with PMT...', { pmt: storedPmt });
            const params = new URLSearchParams({ paymentMethodToken: storedPmt });
            let res = await fetch(`/api/braintree/client-token?${params}`);
            let data = await res.json();

            if (!data.clientToken) {
                log('Client token with PMT failed — falling back to plain client token', { error: data.error });
                res = await fetch('/api/braintree/client-token');
                data = await res.json();
            }

            if (!data.clientToken) {
                throw new Error(`Failed to get client token: ${data.error || 'unknown error'}`);
            }

            clientToken = data.clientToken;
            log('Client token received');

            const braintree = await import('braintree-web');

            log('Creating Braintree client instance...');
            const clientInstance = await braintree.client.create({ authorization: clientToken });

            log('Creating PayPal Checkout instance (autoSetDataUserIdToken: true)...');
            paypalCheckoutInstance = await braintree.paypalCheckout.create({
                client: clientInstance,
                autoSetDataUserIdToken: true
            });

            // vault-management requires explicit PayPal merchant enablement.
            // Try with it first; fall back to without if SDK returns 400.
            log('Loading PayPal SDK (attempting with vault-management)...');
            try {
                await paypalCheckoutInstance.loadPayPalSDK({
                    currency: 'USD',
                    intent: 'capture',
                    components: 'buttons,messages,vault-management'
                });
                log('PayPal SDK loaded with vault-management');
            } catch {
                log('vault-management rejected by PayPal SDK — retrying without it');
                await paypalCheckoutInstance.loadPayPalSDK({
                    currency: 'USD',
                    intent: 'capture',
                    components: 'buttons,messages'
                });
                log('PayPal SDK loaded (without vault-management)');
            }

            if (!window.paypal.SavedPaymentMethods) {
                throw new Error(
                    'paypal.SavedPaymentMethods is not available. ' +
                    'The vault-management component must be enabled for this PayPal merchant account. ' +
                    'Contact your PayPal representative to enable Saved Payment Methods.'
                );
            }

            if (savedPmContainerRef) savedPmContainerRef.innerHTML = '';

            log('Rendering paypal.SavedPaymentMethods()...');
            const spm = window.paypal.SavedPaymentMethods({
                createOrder: () => {
                    log('createOrder called — consumer is changing payment instrument');
                    return paypalCheckoutInstance.createPayment({
                        flow: 'checkout',
                        amount: currentTotal.toString(),
                        currency: 'USD',
                        intent: 'capture',
                        editBillingAgreement: true
                    });
                },
                onApprove: (data) => {
                    log('onApprove — consumer changed instrument, tokenizing', data);
                    return paypalCheckoutInstance.tokenizePayment(data, (err, payload) => {
                        if (err) {
                            log('Tokenization error', err);
                            errorMessage = err.message;
                            return;
                        }
                        checkoutData = { type: 'nonce', nonce: payload.nonce };
                        log('Nonce path — checkoutData set', checkoutData);
                    });
                },
                onReady: (data) => {
                    log('onReady — component rendered, PMT available', data);
                    checkoutData = {
                        type: 'paymentMethodToken',
                        paymentMethodToken: data.paymentMethodToken
                    };
                    if (submitBtnRef) submitBtnRef.disabled = false;
                },
                onClick: () => {
                    log('onClick — consumer clicked Change');
                },
                onError: (err) => {
                    log('SavedPaymentMethods error', { code: err.code, message: err.message });
                    if (err.code === 'NO_VAULTED_PAYMENT_METHODS') {
                        log('Falling back to new-user Buttons flow');
                        phase = 'new-user';
                        initNewUser();
                    } else {
                        errorMessage = err.message || 'SavedPaymentMethods error';
                    }
                },
                message: {
                    amount: currentTotal.toString(),
                    position: 'bottom',
                    offer: 'paylater'
                },
                styles: {
                    root: { 'font-family': 'system-ui, sans-serif' },
                    component: { 'border': '1px solid #e5e7eb', 'border-radius': '8px', 'padding': '16px' },
                    layout: { logoVisibility: 'show', labelVisibility: 'show' }
                }
            });

            spm.render(savedPmContainerRef);
            log('SavedPaymentMethods rendered — waiting for onReady');
        } catch (err) {
            log('initReturningUser error', { message: err.message });
            errorMessage = err.message || 'Initialization failed';
        }
    }

    async function handleSubmit() {
        if (!checkoutData) return;
        log('Complete Purchase clicked — submitting', checkoutData);

        try {
            const body = {
                type: checkoutData.type,
                amount: currentTotal.toString()
            };
            if (checkoutData.type === 'nonce') body.nonce = checkoutData.nonce;
            if (checkoutData.type === 'paymentMethodToken') body.paymentMethodToken = checkoutData.paymentMethodToken;

            const res = await fetch('/api/braintree/checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const result = await res.json();
            log('Checkout result', result);

            if (result.success) {
                paymentSuccess = true;
                paymentResult = {
                    transactionId: result.transactionId,
                    path: checkoutData.type,
                    phase: 'returning-user'
                };
            } else {
                errorMessage = `Payment failed: ${result.error}`;
            }
        } catch (err) {
            log('Submit error', { message: err.message });
            errorMessage = err.message || 'Failed to submit payment';
        }
    }

    async function resetSession() {
        log('Resetting vault session...');
        await fetch('/api/braintree/vault-session', { method: 'DELETE' });
        location.reload();
    }
</script>

<div class="min-h-screen bg-gray-50">
    <div class="container mx-auto px-8 max-w-5xl py-8 space-y-6">

        <!-- Header -->
        <div class="flex items-center justify-between">
            <div>
                <h1 class="text-2xl font-bold text-gray-900">Braintree — Saved Payment Methods</h1>
                <p class="text-sm text-gray-500 mt-1">
                    {#if phase === 'loading'}Detecting session...{/if}
                    {#if phase === 'new-user'}<span class="text-orange-600 font-medium">New user</span> — Vault a PayPal account to become a returning customer{/if}
                    {#if phase === 'returning-user'}<span class="text-green-600 font-medium">Returning user</span> — Saved payment instrument detected{/if}
                </p>
            </div>
            {#if phase === 'returning-user' && !paymentSuccess}
                <button onclick={resetSession} class="text-xs px-3 py-1.5 border border-gray-300 rounded text-gray-600 hover:bg-gray-100 transition-colors">
                    Reset session (simulate new user)
                </button>
            {/if}
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <!-- Left: Order Summary -->
            <div class="space-y-4">
                <div class="bg-white rounded-lg border border-gray-200 p-5">
                    <h2 class="font-bold text-gray-900 mb-4">Order Summary</h2>
                    <div class="space-y-2 text-sm">
                        <div class="flex justify-between">
                            <span class="text-gray-600">Product</span>
                            <span class="font-medium">SpaceX Part</span>
                        </div>
                        <div class="flex justify-between border-t border-gray-100 pt-2">
                            <span class="text-gray-600">Subtotal</span>
                            <span>${PRODUCT_SUBTOTAL}</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-gray-600">Tax ({currentTaxRate}%)</span>
                            <span>${currentTax}</span>
                        </div>
                        <div class="flex justify-between border-t border-gray-200 pt-2 font-bold text-base">
                            <span>Total</span>
                            <span>${currentTotal}</span>
                        </div>
                    </div>
                </div>

                <!-- Phase explanation -->
                <div class="bg-blue-50 border border-blue-200 rounded-lg p-4 text-xs text-blue-800 space-y-1.5">
                    {#if phase === 'new-user'}
                        <p class="font-bold">How this demo works:</p>
                        <p>1. Click the PayPal button below to go through the vault flow.</p>
                        <p>2. After authorizing, your Payment Method Token is stored in the server session.</p>
                        <p>3. Reload the page — you'll automatically be in the <strong>returning user</strong> flow with the Saved Payment Methods component.</p>
                    {:else if phase === 'returning-user'}
                        <p class="font-bold">How this demo works:</p>
                        <p>The Saved Payment Methods component loaded your vaulted PayPal account.</p>
                        <p><strong>Default path:</strong> Click "Complete Purchase" without changing anything — uses PMT directly.</p>
                        <p><strong>Edit path:</strong> Click "Change" in the component, select a different instrument — generates a nonce.</p>
                        <p>Click "Reset session" to simulate a new user again.</p>
                    {/if}
                </div>
            </div>

            <!-- Right: Payment Component -->
            <div>
                {#if !paymentSuccess}
                    <div class="bg-white rounded-lg border border-gray-200 p-5">
                        <h2 class="font-bold text-gray-900 mb-4">
                            {phase === 'new-user' ? 'Connect PayPal' : 'Complete Payment'}
                        </h2>

                        {#if phase === 'loading'}
                            <div class="text-sm text-gray-500 animate-pulse">Initializing...</div>

                        {:else if phase === 'new-user'}
                            <!-- Vault Buttons flow -->
                            <p class="text-sm text-gray-600 mb-4">
                                Connect your PayPal account to save it for future purchases.
                            </p>
                            <div bind:this={paypalContainerRef} class="w-full max-w-[260px] mx-auto"></div>

                        {:else if phase === 'returning-user'}
                            <!-- Saved Payment Methods flow -->
                            <div bind:this={savedPmContainerRef} class="mb-4"></div>

                            <button
                                bind:this={submitBtnRef}
                                onclick={handleSubmit}
                                disabled={!checkoutData}
                                class="w-full mt-2 py-3 px-6 bg-gray-900 text-white font-bold rounded transition-all
                                       disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-800"
                            >
                                Complete Purchase — ${currentTotal}
                            </button>
                            {#if !checkoutData}
                                <p class="text-xs text-gray-400 text-center mt-2">Waiting for payment component to load...</p>
                            {/if}
                        {/if}

                        {#if errorMessage}
                            <div class="mt-4 bg-red-50 border border-red-200 rounded p-3 text-sm text-red-800">
                                {errorMessage}
                            </div>
                        {/if}
                    </div>

                {:else}
                    <!-- Success state -->
                    <div class="bg-green-50 border border-green-200 rounded-lg p-6">
                        <div class="flex items-center gap-3 mb-4">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                            </svg>
                            <div>
                                <h3 class="font-bold text-xl text-green-900">Payment Successful!</h3>
                                <p class="text-sm text-green-700">
                                    {paymentResult.phase === 'new-user-vault'
                                        ? 'PayPal account vaulted. Reload to try the returning user flow.'
                                        : `Charged via ${paymentResult.path === 'paymentMethodToken' ? 'Payment Method Token' : 'Nonce'} path.`}
                                </p>
                            </div>
                        </div>
                        <div class="bg-white rounded border border-gray-200 p-4 text-sm space-y-2">
                            {#if paymentResult.transactionId}
                                <div class="flex justify-between">
                                    <span class="text-gray-600">Transaction ID</span>
                                    <code class="text-xs bg-gray-100 px-2 py-0.5 rounded">{paymentResult.transactionId}</code>
                                </div>
                            {/if}
                            <div class="flex justify-between">
                                <span class="text-gray-600">Path used</span>
                                <span class="font-medium capitalize">{paymentResult.path || 'vault'}</span>
                            </div>
                            {#if paymentResult.vaultToken}
                                <div class="flex justify-between">
                                    <span class="text-gray-600">Vault Token</span>
                                    <code class="text-xs bg-gray-100 px-2 py-0.5 rounded">{paymentResult.vaultToken}</code>
                                </div>
                            {/if}
                        </div>
                        <button onclick={() => location.reload()} class="mt-4 w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2.5 px-4 rounded transition-colors">
                            {paymentResult.phase === 'new-user-vault' ? 'Continue as Returning User →' : 'Place Another Order'}
                        </button>
                    </div>
                {/if}
            </div>
        </div>

        <!-- Developer Logs -->
        <div class="bg-gray-900 rounded-lg overflow-hidden border border-gray-800">
            <div class="p-4 border-b border-gray-800 flex justify-between items-center bg-gray-950">
                <h3 class="font-mono text-sm font-bold text-green-400">Developer Logs</h3>
                <button onclick={() => logs = []} class="text-xs text-gray-400 hover:text-white">Clear</button>
            </div>
            <div class="p-4 max-h-[400px] overflow-y-auto font-mono text-xs space-y-3">
                {#if logs.length === 0}
                    <div class="text-gray-500 italic">Initializing...</div>
                {:else}
                    {#each logs as entry}
                        <div class="border-l-2 border-gray-700 pl-3">
                            <div class="flex justify-between">
                                <span class="text-blue-300 font-semibold">{entry.step}</span>
                                <span class="text-gray-500 text-[10px]">{entry.timestamp}</span>
                            </div>
                            {#if entry.data}
                                <pre class="mt-1 text-gray-300 bg-gray-800 p-2 rounded overflow-x-auto text-[10px]">{JSON.stringify(entry.data, null, 2)}</pre>
                            {/if}
                        </div>
                    {/each}
                {/if}
            </div>
        </div>
    </div>
</div>
