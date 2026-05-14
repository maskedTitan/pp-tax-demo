<script>
    import { onMount, onDestroy } from "svelte";
    import { calculateTax, calculateTotal, getTaxRate } from "$lib/taxRates.js";

    let errorMessage = "";
    let paymentSuccess = false;
    let paymentResult = null;
    let paypalLoading = true;
    let sessionRef = null;

    // Developer Logs
    let developerLogs = [];
    function addLog(step, data = null) {
        const timestamp = new Date().toLocaleTimeString();
        developerLogs = [...developerLogs, { step, data, timestamp }];
        console.log(`[BT v6] ${step}`, data || '');
    }

    // Feature flags
    let isRecurring = false;
    let zeroDollarAuth = false;
    let disableShipping = false;
    let enableSessionTimeout = false;

    const PRODUCT_SUBTOTAL = "10.00";
    const TIMEOUT_SECONDS = 30;

    let sessionStartTime = null;
    let sessionTimeoutId = null;
    let countdownIntervalId = null;
    let remainingTime = null;
    let sessionExpired = false;

    let serviceAddress = {
        firstName: "John",
        lastName: "Doe",
        houseNumberOrName: "123",
        street: "1 Rocket Rd",
        city: "Hawthorne",
        stateOrProvince: "CA",
        postalCode: "90250",
        country: "US",
    };

    const demoAddresses = [
        { label: "California HQ", tax: "8.5%", address: { firstName: "Elon", lastName: "Musk", houseNumberOrName: "1", street: "Rocket Rd", city: "Hawthorne", stateOrProvince: "CA", postalCode: "90250", country: "US" } },
        { label: "Texas Starbase", tax: "8.0%", address: { firstName: "Star", lastName: "Base", houseNumberOrName: "1", street: "Memories Way", city: "Boca Chica", stateOrProvince: "TX", postalCode: "78521", country: "US" } },
        { label: "Florida Pad", tax: "7.0%", address: { firstName: "Launch", lastName: "Complex", houseNumberOrName: "39A", street: "Space Center", city: "Merritt Island", stateOrProvince: "FL", postalCode: "32899", country: "US" } },
        { label: "Delaware Office", tax: "0%", address: { firstName: "John", lastName: "Doe", houseNumberOrName: "1209", street: "Orange St", city: "Wilmington", stateOrProvince: "DE", postalCode: "19801", country: "US" } }
    ];

    $: currentTax = calculateTax(PRODUCT_SUBTOTAL, serviceAddress.stateOrProvince);
    $: currentTotal = calculateTotal(PRODUCT_SUBTOTAL, serviceAddress.stateOrProvince);
    $: currentTaxRate = getTaxRate(serviceAddress.stateOrProvince);

    let showCheckoutOptions = true;
    let showServiceAddress = false;
    let isInitialMount = true;
    let braintreeClientToken = null;
    let paypalV6Instance = null;

    // --- Session timeout ---
    function startSessionTimer() {
        if (!enableSessionTimeout) return;
        clearSessionTimer();
        sessionStartTime = Date.now();
        sessionExpired = false;
        remainingTime = TIMEOUT_SECONDS;
        sessionTimeoutId = setTimeout(() => {
            sessionExpired = true;
            remainingTime = 0;
            clearSessionTimer();
        }, TIMEOUT_SECONDS * 1000);
        countdownIntervalId = setInterval(() => {
            if (sessionStartTime) {
                const elapsed = Date.now() - sessionStartTime;
                remainingTime = Math.max(0, Math.floor((TIMEOUT_SECONDS * 1000 - elapsed) / 1000));
            }
        }, 1000);
    }

    function clearSessionTimer() {
        if (sessionTimeoutId) clearTimeout(sessionTimeoutId);
        if (countdownIntervalId) clearInterval(countdownIntervalId);
    }

    onDestroy(() => clearSessionTimer());

    // --- CDN script loader ---
    function loadScript(src) {
        return new Promise((resolve, reject) => {
            if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
            const s = document.createElement('script');
            s.src = src;
            s.onload = resolve;
            s.onerror = reject;
            document.head.appendChild(s);
        });
    }

    async function setupBraintreeV6() {
        paypalLoading = true;
        errorMessage = "";
        sessionRef = null;

        try {
            addLog("Fetching client token...");
            if (!braintreeClientToken) {
                const res = await fetch('/api/braintree/client-token');
                if (!res.ok) throw new Error("Failed to fetch client token");
                const data = await res.json();
                braintreeClientToken = data.clientToken;
                addLog("Client token fetched", { preview: braintreeClientToken.substring(0, 20) + "..." });
            }

            addLog("Loading Braintree CDN scripts...");
            const base = "https://js.braintreegateway.com/web/3.141.0/js";
            await loadScript(`${base}/client.min.js`);
            await loadScript(`${base}/paypal-checkout-v6.min.js`);
            addLog("CDN scripts loaded");

            addLog("Creating Braintree client...");
            const clientInstance = await window.braintree.client.create({ authorization: braintreeClientToken });

            addLog("Creating paypalCheckoutV6 instance...");
            paypalV6Instance = await window.braintree.paypalCheckoutV6.create({ client: clientInstance });

            addLog("Loading PayPal SDK...");
            await paypalV6Instance.loadPayPalSDK();
            addLog("PayPal SDK loaded");

            buildSession();
        } catch (err) {
            paypalLoading = false;
            addLog("Init error", { message: err.message });
            errorMessage = err.message || "Failed to initialize Braintree v6.";
        }
    }

    function buildSession() {
        if (!paypalV6Instance) return;

        addLog("Building payment session...", { isRecurring, zeroDollarAuth, disableShipping });

        const onApprove = async (data) => {
            addLog("onApprove triggered", data);
            try {
                let tokenizeArg;
                if (zeroDollarAuth || isRecurring) {
                    tokenizeArg = { billingToken: data.billingToken };
                } else {
                    tokenizeArg = { payerID: data.payerId, orderID: data.orderId };
                }
                const payload = await paypalV6Instance.tokenizePayment(tokenizeArg);
                addLog("Tokenized", payload);
                await submitNonceToServer(payload);
            } catch (err) {
                addLog("Tokenize error", { message: err.message });
                errorMessage = err.message || "Failed to tokenize payment.";
            }
        };

        try {
            if (zeroDollarAuth) {
                // Pure vault — no charge
                sessionRef = paypalV6Instance.createBillingAgreementSession({
                    billingAgreementDescription: "Save PayPal for future payments",
                    onApprove,
                });
                addLog("Created billing agreement session ($0 auth)");
            } else if (isRecurring) {
                // Charge + vault in one flow
                sessionRef = paypalV6Instance.createCheckoutWithVaultSession({
                    amount: currentTotal.toString(),
                    currency: "USD",
                    intent: "capture",
                    billingAgreementDetails: { description: "Save PayPal for future charges" },
                    onApprove,
                    ...(!disableShipping && {
                        onShippingAddressChange: (data) => {
                            const stateCode = data.shippingAddress?.stateOrProvinceCode || data.shippingAddress?.state;
                            const newTotal = calculateTotal(PRODUCT_SUBTOTAL, stateCode);
                            if (newTotal === currentTotal.toString()) {
                                addLog("Tax unchanged, resolving immediately", { stateCode });
                                return Promise.resolve();
                            }
                            addLog("Updating payment for new state", { stateCode, newTotal });
                            return paypalV6Instance.updatePayment({
                                paymentId: data.orderId,
                                amount: newTotal,
                                currency: "USD",
                            });
                        }
                    }),
                });
                addLog("Created checkout-with-vault session (recurring)");
            } else {
                // Standard one-time payment
                sessionRef = paypalV6Instance.createOneTimePaymentSession({
                    amount: currentTotal.toString(),
                    currency: "USD",
                    intent: "capture",
                    onApprove,
                    ...(!disableShipping && {
                        onShippingAddressChange: (data) => {
                            const stateCode = data.shippingAddress?.stateOrProvinceCode || data.shippingAddress?.state;
                            const newTotal = calculateTotal(PRODUCT_SUBTOTAL, stateCode);
                            if (newTotal === currentTotal.toString()) {
                                addLog("Tax unchanged, resolving immediately", { stateCode });
                                return Promise.resolve();
                            }
                            addLog("Updating payment for new state", { stateCode, newTotal });
                            return paypalV6Instance.updatePayment({
                                paymentId: data.orderId,
                                amount: newTotal,
                                currency: "USD",
                            });
                        }
                    }),
                });
                addLog("Created one-time payment session");
            }
            paypalLoading = false;
        } catch (err) {
            paypalLoading = false;
            addLog("Session build error", { message: err.message });
            errorMessage = err.message || "Failed to build payment session.";
        }
    }

    function handlePayPalClick() {
        if (!sessionRef) return;
        addLog("PayPal button clicked — starting session");
        if (enableSessionTimeout && !sessionStartTime) startSessionTimer();
        sessionRef.start();
    }

    async function submitNonceToServer(payload) {
        try {
            addLog("Submitting nonce to server...");
            const amountStr = zeroDollarAuth ? '0.00' : currentTotal.toString();
            const body = {
                nonce: payload.nonce,
                isVault: zeroDollarAuth || isRecurring,
                amount: amountStr,
            };
            addLog("POST /api/braintree/checkout", body);
            const res = await fetch('/api/braintree/checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const result = await res.json();
            addLog("Server response", result);
            if (result.success) {
                paymentSuccess = true;
                paymentResult = { transactionId: result.transactionId, vaultToken: result.vaultToken, nonce: payload.nonce };
                clearSessionTimer();
            } else {
                errorMessage = `Payment failed: ${result.error}`;
            }
        } catch (err) {
            addLog("Server submit error", { message: err.message });
            errorMessage = "Failed to submit transaction.";
        }
    }

    let isInitialMountDone = false;
    $: isRecurring, zeroDollarAuth, disableShipping, rebuildSession();
    function rebuildSession() {
        if (!isInitialMountDone || !braintreeClientToken || !paypalV6Instance || paymentSuccess) return;
        buildSession();
    }

    onMount(async () => {
        await setupBraintreeV6();
        isInitialMountDone = true;
    });
</script>

<div class="min-h-screen bg-gray-50">
    <div class="container mx-auto px-8 max-w-7xl py-8">
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">

            <!-- Left Column -->
            <div class="space-y-6">
                {#if !paymentSuccess}
                    <!-- Checkout Options -->
                    <div class="bg-white rounded-lg border border-gray-200 overflow-hidden">
                        <button onclick={() => (showCheckoutOptions = !showCheckoutOptions)} class="w-full p-4 flex items-center justify-between text-left hover:bg-gray-50 transition-colors">
                            <div class="flex items-center gap-3">
                                <div class="text-blue-600">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                                    </svg>
                                </div>
                                <h3 class="font-bold text-gray-900 text-sm">Checkout Options (Braintree v6)</h3>
                            </div>
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-400 transition-transform {showCheckoutOptions ? 'rotate-180' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                            </svg>
                        </button>

                        {#if showCheckoutOptions}
                            <div class="px-4 pb-4 border-t border-gray-100 pt-2 space-y-2">
                                <label class="flex items-center p-2 rounded hover:bg-gray-50 cursor-pointer">
                                    <input type="checkbox" bind:checked={disableShipping} class="w-4 h-4 text-blue-600 rounded border-gray-300" />
                                    <div class="ml-3">
                                        <span class="block text-sm font-medium text-gray-900">Disable Shipping Address</span>
                                        <p class="text-xs text-gray-500">Hide address collection in checkout</p>
                                    </div>
                                </label>

                                <label class="flex items-center p-2 rounded hover:bg-gray-50 cursor-pointer">
                                    <input type="checkbox" bind:checked={isRecurring} class="w-4 h-4 text-blue-600 rounded border-gray-300" />
                                    <div class="ml-3">
                                        <span class="block text-sm font-medium text-gray-900">Checkout with Vault (Recurring)</span>
                                        <p class="text-xs text-gray-500">Charge + save PayPal for future use via <code class="text-blue-600">createCheckoutWithVaultSession</code></p>
                                    </div>
                                </label>

                                <label class="flex items-center p-2 rounded hover:bg-gray-50 cursor-pointer pl-6">
                                    <input type="checkbox" bind:checked={zeroDollarAuth} class="w-4 h-4 text-blue-600 rounded border-gray-300" />
                                    <div class="ml-3">
                                        <span class="block text-sm font-medium text-gray-900">$0 Auth (Vault Only)</span>
                                        <p class="text-xs text-gray-500">Save without charging via <code class="text-blue-600">createBillingAgreementSession</code></p>
                                    </div>
                                </label>

                                <label class="flex items-center p-2 rounded hover:bg-gray-50 cursor-pointer">
                                    <input type="checkbox" bind:checked={enableSessionTimeout} class="w-4 h-4 text-blue-600 rounded border-gray-300" />
                                    <div class="ml-3">
                                        <span class="block text-sm font-medium text-gray-900">Enable Session Timeout</span>
                                        <p class="text-xs text-gray-500">Expire checkout after {TIMEOUT_SECONDS}s</p>
                                    </div>
                                </label>
                            </div>
                        {/if}
                    </div>

                    <!-- Service Address -->
                    <div class="bg-white rounded-lg border border-gray-200 overflow-hidden">
                        <button onclick={() => (showServiceAddress = !showServiceAddress)} class="w-full p-4 flex items-center justify-between text-left hover:bg-gray-50 transition-colors">
                            <div class="flex items-center gap-3">
                                <div class="text-orange-600">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                                    </svg>
                                </div>
                                <h4 class="font-bold text-gray-900 text-sm">Service Address (Tax Calculation)</h4>
                            </div>
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-400 transition-transform {showServiceAddress ? 'rotate-180' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                            </svg>
                        </button>

                        {#if showServiceAddress}
                            <div class="px-4 pb-4 border-t border-gray-100 pt-3">
                                <div class="mb-4">
                                    <p class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Quick Fill Demos</p>
                                    <div class="grid grid-cols-2 gap-2">
                                        {#each demoAddresses as demo}
                                            <button type="button" class="text-left p-3 border {serviceAddress.stateOrProvince === demo.address.stateOrProvince ? 'border-orange-400 bg-orange-50' : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'} rounded-lg transition-colors" onclick={() => serviceAddress = { ...demo.address }}>
                                                <div class="flex justify-between items-center mb-1">
                                                    <span class="font-bold text-gray-900 text-xs">{demo.label}</span>
                                                    <span class="text-[10px] font-bold px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">{demo.tax} Tax</span>
                                                </div>
                                                <div class="text-xs text-gray-500 truncate">{demo.address.city}, {demo.address.stateOrProvince}</div>
                                            </button>
                                        {/each}
                                    </div>
                                </div>
                                <p class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mb-3">
                                    Note: PayPal JS v6 does not yet support <code>shippingAddressOverride</code>. The address selected here sets the tax rate used for <code>onShippingAddressChange</code> updates only.
                                </p>
                                <div class="grid grid-cols-2 gap-3">
                                    <div>
                                        <label for="v6-state" class="block text-xs font-semibold text-gray-700 mb-1">State</label>
                                        <input id="v6-state" class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm uppercase" type="text" bind:value={serviceAddress.stateOrProvince} maxlength="2" />
                                    </div>
                                    <div>
                                        <label for="v6-postal" class="block text-xs font-semibold text-gray-700 mb-1">Postal Code</label>
                                        <input id="v6-postal" class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm" type="text" bind:value={serviceAddress.postalCode} />
                                    </div>
                                </div>
                            </div>
                        {/if}
                    </div>
                {/if}
            </div>

            <!-- Right Column -->
            <div class="space-y-6">
                {#if !paymentSuccess}
                    {#if sessionExpired}
                        <div class="p-5 bg-white rounded-lg border border-gray-200">
                            <p class="text-gray-700 mb-2"><span class="font-medium">Session timed out</span></p>
                            <button onclick={() => { sessionExpired = false; sessionStartTime = null; remainingTime = null; clearSessionTimer(); }} class="px-4 py-2 bg-gray-900 text-white text-sm rounded hover:bg-gray-800 transition-colors">Restart Checkout</button>
                        </div>
                    {:else}
                        <div class="p-5 bg-white rounded-lg border border-gray-200 sticky top-6">
                            <div class="flex items-center gap-2 mb-4">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                                </svg>
                                <h4 class="font-bold text-gray-900 text-lg">Complete Payment</h4>
                                <span class="ml-auto text-xs font-semibold bg-blue-100 text-blue-700 px-2 py-0.5 rounded">PayPal JS v6</span>
                            </div>

                            <div class="mb-4 bg-gray-50 rounded border border-gray-100 p-4">
                                <div class="flex justify-between items-center pb-2 border-b border-gray-200">
                                    <span class="text-sm font-medium text-gray-600">Subtotal</span>
                                    <span class="text-sm font-semibold text-gray-900">${PRODUCT_SUBTOTAL}</span>
                                </div>
                                <div class="flex justify-between items-center py-2 border-b border-gray-200">
                                    <span class="text-sm font-medium text-gray-600">Tax ({currentTaxRate}%)</span>
                                    <span class="text-sm font-semibold text-gray-900">${currentTax}</span>
                                </div>
                                <div class="flex justify-between items-center pt-2">
                                    <span class="text-sm font-medium text-gray-600">Total Due</span>
                                    <span class="text-xl font-extrabold text-gray-900 tracking-tight">
                                        ${zeroDollarAuth ? '0.00' : currentTotal}
                                    </span>
                                </div>
                            </div>

                            {#if remainingTime !== null && remainingTime < TIMEOUT_SECONDS && !sessionExpired}
                                <div class="mb-4 bg-orange-50 border border-orange-200 rounded p-2 text-center text-xs text-orange-800 animate-pulse">
                                    Payment expires in <strong>{Math.floor(remainingTime / 60)}:{Math.floor(remainingTime % 60).toString().padStart(2, '0')}</strong>
                                </div>
                            {/if}

                            <div class="mt-6 mx-auto w-full max-w-[260px]">
                                {#if paypalLoading}
                                    <div class="flex items-center justify-center h-12 gap-2 text-gray-400">
                                        <svg class="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                                        </svg>
                                        <span class="text-sm">Loading payment...</span>
                                    </div>
                                {:else}
                                    <!-- v6 uses a custom element + session.start() instead of Buttons().render() -->
                                    <button
                                        onclick={handlePayPalClick}
                                        class="w-full h-12 bg-[#ffc439] hover:bg-[#f0b429] rounded-md flex items-center justify-center gap-2 transition-colors"
                                    >
                                        <span class="font-bold text-[#003087] text-base tracking-tight">
                                            {zeroDollarAuth ? 'Save with' : isRecurring ? 'Subscribe with' : 'Pay with'}
                                        </span>
                                        <span class="font-extrabold italic text-[#003087] text-base tracking-tight">PayPal</span>
                                    </button>
                                {/if}
                            </div>
                        </div>
                    {/if}

                    {#if errorMessage}
                        <div class="bg-red-50 border border-red-200 rounded-lg p-6">
                            <p class="text-sm font-semibold text-red-800">{errorMessage}</p>
                        </div>
                    {/if}
                {:else}
                    <div class="bg-green-50 border border-green-200 rounded-lg p-6">
                        <div class="flex items-center gap-3 mb-4">
                            <div class="text-green-600">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                                </svg>
                            </div>
                            <div>
                                <h3 class="font-bold text-xl text-green-900">Payment Successful!</h3>
                                <p class="text-sm text-green-800">Thank you for your order.</p>
                            </div>
                        </div>
                        <div class="p-5 bg-white rounded-lg border border-gray-200 mt-4 space-y-3 text-sm">
                            <div class="flex justify-between items-center pb-2 border-b border-gray-100">
                                <span class="font-semibold text-gray-700">Transaction ID:</span>
                                <code class="bg-gray-100 px-3 py-1 rounded font-mono text-xs">{paymentResult.transactionId ?? '—'}</code>
                            </div>
                            <div class="flex justify-between items-center pb-2 border-b border-gray-100">
                                <span class="font-semibold text-gray-700">Vault Token:</span>
                                <code class="bg-gray-100 px-3 py-1 rounded font-mono text-xs">{paymentResult.vaultToken ?? '—'}</code>
                            </div>
                            <div class="flex justify-between items-center">
                                <span class="font-semibold text-gray-700">Nonce:</span>
                                <code class="bg-gray-100 px-3 py-1 rounded font-mono text-xs truncate max-w-[200px]">{paymentResult.nonce}</code>
                            </div>
                        </div>
                        <button class="mt-5 w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded transition-all" onclick={() => location.reload()}>
                            Place Another Order
                        </button>
                    </div>
                {/if}
            </div>
        </div>

        <!-- Developer Logs -->
        <div class="mt-6 bg-gray-900 rounded-lg overflow-hidden border border-gray-800 shadow-xl">
            <div class="p-4 border-b border-gray-800 flex justify-between items-center bg-gray-950">
                <h3 class="font-mono text-sm font-bold text-green-400 flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    Developer Logs — Braintree v6
                </h3>
                <button onclick={() => developerLogs = []} class="text-xs text-gray-400 hover:text-white transition-colors">Clear</button>
            </div>
            <div class="p-4 max-h-[400px] overflow-y-auto font-mono text-xs space-y-3">
                {#if developerLogs.length === 0}
                    <div class="text-gray-500 italic">No logs yet. Waiting for checkout events...</div>
                {:else}
                    {#each developerLogs as log}
                        <div class="border-l-2 border-gray-700 pl-3">
                            <div class="flex items-start justify-between">
                                <span class="text-blue-300 font-semibold">{log.step}</span>
                                <span class="text-gray-500 text-[10px]">{log.timestamp}</span>
                            </div>
                            {#if log.data}
                                <pre class="mt-1 text-gray-300 bg-gray-800 p-2 rounded overflow-x-auto text-[10px]">{JSON.stringify(log.data, null, 2)}</pre>
                            {/if}
                        </div>
                    {/each}
                {/if}
            </div>
        </div>
    </div>
</div>
