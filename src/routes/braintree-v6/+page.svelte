<script>
    import { onMount, onDestroy } from "svelte";
    import { calculateTax, calculateTotal, getTaxRate } from "$lib/taxRates.js";
    import DeveloperLogs from "$lib/components/DeveloperLogs.svelte";

    let errorMessage = "";
    let paymentSuccess = false;
    let paymentResult = null;
    let paypalLoading = true;
    let sessionRef = null;
    let eligibilityResult = null;

    // Developer Logs
    let logs = [];
    function addLog(label, data = null, type = 'info') {
        const timestamp = new Date().toISOString();
        logs = [...logs, {
            timestamp,
            label,
            data: data != null ? (typeof data === 'string' ? data : JSON.stringify(data, null, 2)) : null,
            type,
        }];
        console.log(`[BT v6] ${label}`, data || '');
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
        firstName: "Victor",
        lastName: "Von Doom",
        houseNumberOrName: "1",
        street: "Castle Doom",
        city: "Doomstadt",
        stateOrProvince: "NY",
        postalCode: "10001",
        country: "US",
    };

    const demoAddresses = [
        { label: "Castle Doom, NY", tax: "12.5%", address: { firstName: "Victor", lastName: "Von Doom", houseNumberOrName: "1", street: "Castle Doom", city: "Doomstadt", stateOrProvince: "NY", postalCode: "10001", country: "US" } },
        { label: "Latverian Embassy, DC", tax: "6.0%", address: { firstName: "Victor", lastName: "Von Doom", houseNumberOrName: "2300", street: "Embassy Row", city: "Washington", stateOrProvince: "MD", postalCode: "20008", country: "US" } },
        { label: "Doom Labs, CA", tax: "8.5%", address: { firstName: "Dr", lastName: "Doom", houseNumberOrName: "999", street: "Stark Blvd", city: "Los Angeles", stateOrProvince: "CA", postalCode: "90001", country: "US" } },
        { label: "Tax Haven, DE", tax: "0%", address: { firstName: "Victor", lastName: "Von Doom", houseNumberOrName: "1209", street: "Orange St", city: "Wilmington", stateOrProvince: "DE", postalCode: "19801", country: "US" } }
    ];

    $: currentTax = calculateTax(PRODUCT_SUBTOTAL, serviceAddress.stateOrProvince);
    $: currentTotal = calculateTotal(PRODUCT_SUBTOTAL, serviceAddress.stateOrProvince);
    $: currentTaxRate = getTaxRate(serviceAddress.stateOrProvince);

    let showCheckoutOptions = true;
    let showServiceAddress = false;
    let isInitialMount = true;
    let braintreeClientToken = null;
    let paypalV6Instance = null;
    let sessionAmount = null;

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
            const base = "https://js.braintreegateway.com/web/3.146.0/js";
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

            addLog("Calling findEligibleMethods...");
            try {
                const eligibility = await paypalV6Instance.findEligibleMethods({
                    amount: currentTotal.toString(),
                    currency: 'USD',
                });
                eligibilityResult = {
                    paypal: eligibility.paypal,
                    paylater: eligibility.paylater,
                    credit: eligibility.credit,
                };
                addLog("findEligibleMethods result", eligibilityResult, 'response');
            } catch (err) {
                addLog("findEligibleMethods error", { message: err.message }, 'error');
            }

            buildSession();
        } catch (err) {
            paypalLoading = false;
            addLog("Init error", { message: err.message }, 'error');
            errorMessage = err.message || "Failed to initialize Braintree v6.";
        }
    }

    function buildSession() {
        if (!paypalV6Instance) return;

        addLog("Building payment session...", { isRecurring, zeroDollarAuth, disableShipping });
        sessionAmount = currentTotal.toString();

        const onApprove = async (data) => {
            addLog("onApprove triggered", data, 'response');
            try {
                const tokenizeArg = {
                    ...data,
                    payerID: data.payerID || data.payerId,
                    orderID: data.orderID || data.orderId,
                    billingToken: data.billingToken,
                };
                addLog("Tokenizing with", tokenizeArg, 'request');
                const payload = await paypalV6Instance.tokenizePayment(tokenizeArg);
                addLog("Tokenized", payload, 'response');
                await submitNonceToServer(payload);
            } catch (err) {
                addLog("Tokenize error", { message: err.message }, 'error');
                errorMessage = err.message || "Failed to tokenize payment.";
            }
        };

        try {
            if (zeroDollarAuth) {
                sessionRef = paypalV6Instance.createBillingAgreementSession({
                    billingAgreementDescription: "Save PayPal for future payments",
                    onApprove,
                });
                addLog("Created billing agreement session ($0 auth)");
            } else if (isRecurring) {
                const checkoutWithVaultOptions = {
                    amount: currentTotal.toString(),
                    currency: "USD",
                    intent: "capture",
                    billingAgreementDetails: { description: "Save PayPal for future charges" },
                    onApprove,
                };
                if (!disableShipping) {
                    checkoutWithVaultOptions.enableShippingAddress = true;
                    checkoutWithVaultOptions.onShippingAddressChange = (data) => {
                        addLog("onShippingAddressChange (vault) — raw callback data", data, 'response');
                        const stateCode = data.shippingAddress?.stateOrProvinceCode || data.shippingAddress?.state;
                        const newTotal = calculateTotal(PRODUCT_SUBTOTAL, stateCode);
                        if (newTotal === sessionAmount) {
                            addLog("onShippingAddressChange (vault) — amount unchanged, skipping update", { stateCode, newTotal });
                            return Promise.resolve();
                        }
                        addLog("onShippingAddressChange (vault) — updating amount", { stateCode, newTotal });
                        sessionAmount = newTotal;
                        return paypalV6Instance.updatePayment({
                            paymentId: data.orderId,
                            amount: newTotal,
                            currency: "USD",
                        });
                    };
                }
                sessionRef = paypalV6Instance.createCheckoutWithVaultSession(checkoutWithVaultOptions);
                addLog("Created checkout-with-vault session (recurring)", { enableShippingAddress: !disableShipping });
            } else {
                const oneTimeOptions = {
                    amount: currentTotal.toString(),
                    currency: "USD",
                    intent: "capture",
                    onApprove,
                };
                if (!disableShipping) {
                    oneTimeOptions.enableShippingAddress = true;
                    oneTimeOptions.onShippingAddressChange = (data) => {
                        addLog("onShippingAddressChange — raw callback data", data, 'response');
                        const stateCode = data.shippingAddress?.stateOrProvinceCode || data.shippingAddress?.state;
                        const newTotal = calculateTotal(PRODUCT_SUBTOTAL, stateCode);
                        if (newTotal === sessionAmount) {
                            addLog("onShippingAddressChange — amount unchanged, skipping update", { stateCode, newTotal });
                            return Promise.resolve();
                        }
                        addLog("onShippingAddressChange — updating amount", { stateCode, newTotal });
                        sessionAmount = newTotal;
                        return paypalV6Instance.updatePayment({
                            paymentId: data.orderId,
                            amount: newTotal,
                            currency: "USD",
                        });
                    };
                }
                sessionRef = paypalV6Instance.createOneTimePaymentSession(oneTimeOptions);
                addLog("Created one-time payment session", { enableShippingAddress: !disableShipping });
            }
            paypalLoading = false;
        } catch (err) {
            paypalLoading = false;
            addLog("Session build error", { message: err.message }, 'error');
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
            const amountStr = zeroDollarAuth ? '0.00' : (sessionAmount || currentTotal.toString());
            const body = {
                nonce: payload.nonce,
                isVault: zeroDollarAuth || isRecurring,
                amount: amountStr,
            };
            addLog("POST /api/braintree/checkout", body, 'request');
            const res = await fetch('/api/braintree/checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const result = await res.json();
            if (result.mutations) {
                result.mutations.forEach((m) => {
                    addLog(`GraphQL: ${m.mutation}`, m.request, 'request');
                    addLog(`GraphQL: ${m.mutation}`, m.response, 'response');
                });
            } else {
                addLog("Server response", result, 'response');
            }
            if (result.success) {
                paymentSuccess = true;
                paymentResult = { transactionId: result.transactionId, vaultToken: result.vaultToken, vaultPaymentMethodId: result.vaultPaymentMethodId, nonce: payload.nonce, payerId: result.payerId };
                if (result.vaultPaymentMethodId) chargeTokenId = result.vaultPaymentMethodId;
                clearSessionTimer();
            } else {
                errorMessage = `Payment failed: ${result.error}`;
            }
        } catch (err) {
            addLog("Server submit error", { message: err.message }, 'error');
            errorMessage = "Failed to submit transaction.";
        }
    }

    // Charge Stored Token
    let chargeTokenId = '';
    let chargeAmount = '1.00';
    let chargeResult = null;
    let chargeError = '';
    let chargingToken = false;

    async function chargeStoredToken() {
        chargingToken = true;
        chargeResult = null;
        chargeError = '';

        try {
            const requestBody = {
                type: 'paymentMethodId',
                paymentMethodId: chargeTokenId,
                amount: chargeAmount,
            };
            addLog("Charging stored token...", requestBody, 'request');

            const res = await fetch('/api/braintree/checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
            });
            const result = await res.json();

            if (result.mutations) {
                result.mutations.forEach((m) => {
                    addLog(`GraphQL: ${m.mutation}`, m.request, 'request');
                    addLog(`GraphQL: ${m.mutation}`, m.response, 'response');
                });
            } else {
                addLog("Charge response", result, 'response');
            }

            if (!res.ok || !result.success) {
                throw new Error(result.error || 'Charge failed');
            }

            chargeResult = result;
        } catch (err) {
            chargeError = err.message;
            addLog("Error (charge)", err.message, 'error');
        } finally {
            chargingToken = false;
        }
    }

    let isInitialMountDone = false;
    $: isRecurring, zeroDollarAuth, disableShipping, currentTotal, rebuildSession();
    function rebuildSession() {
        if (!isInitialMountDone || !braintreeClientToken || !paypalV6Instance || paymentSuccess) return;
        buildSession();
    }

    onMount(async () => {
        await setupBraintreeV6();
        isInitialMountDone = true;
    });
</script>

<div class="min-h-screen bg-zinc-900">
    <div class="container mx-auto px-8 max-w-7xl py-8">
        <!-- Header -->
        <div class="mb-8 text-center">
            <h1 class="text-2xl font-bold text-emerald-400 tracking-wide uppercase">Doomsday Tix</h1>
            <p class="text-xs text-zinc-500 mt-1 tracking-widest uppercase">Latverian Ticketing Authority</p>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">

            <!-- Left Column -->
            <div class="space-y-6">
                {#if !paymentSuccess}
                    <!-- Checkout Options -->
                    <div class="bg-zinc-800 rounded-lg border border-zinc-700 overflow-hidden">
                        <button onclick={() => (showCheckoutOptions = !showCheckoutOptions)} class="w-full p-4 flex items-center justify-between text-left hover:bg-zinc-750 transition-colors">
                            <div class="flex items-center gap-3">
                                <div class="text-emerald-500">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                                    </svg>
                                </div>
                                <h3 class="font-bold text-zinc-100 text-sm">Checkout Options</h3>
                            </div>
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-zinc-500 transition-transform {showCheckoutOptions ? 'rotate-180' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                            </svg>
                        </button>

                        {#if showCheckoutOptions}
                            <div class="px-4 pb-4 border-t border-zinc-700 pt-2 space-y-2">
                                <label class="flex items-center p-2 rounded hover:bg-zinc-700/50 cursor-pointer">
                                    <input type="checkbox" bind:checked={disableShipping} class="w-4 h-4 text-emerald-500 rounded border-zinc-600 bg-zinc-700" />
                                    <div class="ml-3">
                                        <span class="block text-sm font-medium text-zinc-200">Disable Shipping Address</span>
                                        <p class="text-xs text-zinc-500">Hide address collection in checkout</p>
                                    </div>
                                </label>

                                <label class="flex items-center p-2 rounded hover:bg-zinc-700/50 cursor-pointer">
                                    <input type="checkbox" bind:checked={isRecurring} class="w-4 h-4 text-emerald-500 rounded border-zinc-600 bg-zinc-700" />
                                    <div class="ml-3">
                                        <span class="block text-sm font-medium text-zinc-200">Checkout with Vault (Recurring)</span>
                                        <p class="text-xs text-zinc-500">Charge + save PayPal via <code class="text-emerald-400">createCheckoutWithVaultSession</code></p>
                                    </div>
                                </label>

                                <label class="flex items-center p-2 rounded hover:bg-zinc-700/50 cursor-pointer pl-6">
                                    <input type="checkbox" bind:checked={zeroDollarAuth} class="w-4 h-4 text-emerald-500 rounded border-zinc-600 bg-zinc-700" />
                                    <div class="ml-3">
                                        <span class="block text-sm font-medium text-zinc-200">$0 Auth (Vault Only)</span>
                                        <p class="text-xs text-zinc-500">Save without charging via <code class="text-emerald-400">createBillingAgreementSession</code></p>
                                    </div>
                                </label>

                                <label class="flex items-center p-2 rounded hover:bg-zinc-700/50 cursor-pointer">
                                    <input type="checkbox" bind:checked={enableSessionTimeout} class="w-4 h-4 text-emerald-500 rounded border-zinc-600 bg-zinc-700" />
                                    <div class="ml-3">
                                        <span class="block text-sm font-medium text-zinc-200">Enable Session Timeout</span>
                                        <p class="text-xs text-zinc-500">Expire checkout after {TIMEOUT_SECONDS}s</p>
                                    </div>
                                </label>
                            </div>
                        {/if}
                    </div>

                    <!-- Eligible Payment Methods -->
                    {#if eligibilityResult}
                        <div class="bg-zinc-800 rounded-md p-3 border border-zinc-700">
                            <p class="text-sm font-semibold text-zinc-300 mb-2">Eligible Payment Methods</p>
                            <div class="flex gap-2 flex-wrap">
                                {#each [['PayPal', eligibilityResult.paypal], ['Pay Later', eligibilityResult.paylater], ['Credit', eligibilityResult.credit]] as [label, eligible]}
                                    <span class="px-2 py-1 rounded text-xs font-semibold {eligible ? 'bg-emerald-900/50 text-emerald-400 border border-emerald-700' : 'bg-zinc-700 text-zinc-500'}">
                                        {eligible ? '✓' : '✗'} {label}
                                    </span>
                                {/each}
                            </div>
                        </div>
                    {/if}

                    <!-- Service Address -->
                    <div class="bg-zinc-800 rounded-lg border border-zinc-700 overflow-hidden">
                        <button onclick={() => (showServiceAddress = !showServiceAddress)} class="w-full p-4 flex items-center justify-between text-left hover:bg-zinc-750 transition-colors">
                            <div class="flex items-center gap-3">
                                <div class="text-emerald-500">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                                    </svg>
                                </div>
                                <h4 class="font-bold text-zinc-100 text-sm">Service Address (Tax Calculation)</h4>
                            </div>
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-zinc-500 transition-transform {showServiceAddress ? 'rotate-180' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                            </svg>
                        </button>

                        {#if showServiceAddress}
                            <div class="px-4 pb-4 border-t border-zinc-700 pt-3">
                                <div class="mb-4">
                                    <p class="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">Latverian Outposts</p>
                                    <div class="grid grid-cols-2 gap-2">
                                        {#each demoAddresses as demo}
                                            <button type="button" class="text-left p-3 border {serviceAddress.stateOrProvince === demo.address.stateOrProvince ? 'border-emerald-600 bg-emerald-900/20' : 'border-zinc-700 bg-zinc-800 hover:border-zinc-600 hover:bg-zinc-750'} rounded-lg transition-colors" onclick={() => serviceAddress = { ...demo.address }}>
                                                <div class="flex justify-between items-center mb-1">
                                                    <span class="font-bold text-zinc-200 text-xs">{demo.label}</span>
                                                    <span class="text-[10px] font-bold px-1.5 py-0.5 bg-zinc-700 text-zinc-400 rounded">{demo.tax}</span>
                                                </div>
                                                <div class="text-xs text-zinc-500 truncate">{demo.address.city}, {demo.address.stateOrProvince}</div>
                                            </button>
                                        {/each}
                                    </div>
                                </div>
                                <p class="text-xs text-amber-400/80 bg-amber-900/20 border border-amber-700/30 rounded p-2 mb-3">
                                    Note: PayPal JS v6 does not yet support <code>shippingAddressOverride</code>. The address selected here sets the tax rate used for <code>onShippingAddressChange</code> updates only.
                                </p>
                                <div class="grid grid-cols-2 gap-3">
                                    <div>
                                        <label for="v6-state" class="block text-xs font-semibold text-zinc-400 mb-1">State</label>
                                        <input id="v6-state" class="w-full px-3 py-2 border border-zinc-600 bg-zinc-700 text-zinc-100 rounded focus:outline-none focus:ring-1 focus:ring-emerald-500 text-sm uppercase" type="text" bind:value={serviceAddress.stateOrProvince} maxlength="2" />
                                    </div>
                                    <div>
                                        <label for="v6-postal" class="block text-xs font-semibold text-zinc-400 mb-1">Postal Code</label>
                                        <input id="v6-postal" class="w-full px-3 py-2 border border-zinc-600 bg-zinc-700 text-zinc-100 rounded focus:outline-none focus:ring-1 focus:ring-emerald-500 text-sm" type="text" bind:value={serviceAddress.postalCode} />
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
                        <div class="p-5 bg-zinc-800 rounded-lg border border-zinc-700">
                            <p class="text-zinc-300 mb-2"><span class="font-medium">Session timed out</span></p>
                            <button onclick={() => { sessionExpired = false; sessionStartTime = null; remainingTime = null; clearSessionTimer(); }} class="px-4 py-2 bg-emerald-600 text-white text-sm rounded hover:bg-emerald-700 transition-colors">Restart Checkout</button>
                        </div>
                    {:else}
                        <div class="p-5 bg-zinc-800 rounded-lg border border-zinc-700 sticky top-6">
                            <div class="flex items-center gap-2 mb-4">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                                </svg>
                                <h4 class="font-bold text-zinc-100 text-lg">Complete Payment</h4>
                                <span class="ml-auto text-xs font-semibold bg-emerald-900/50 text-emerald-400 border border-emerald-700 px-2 py-0.5 rounded">PayPal JS v6</span>
                            </div>

                            <div class="mb-4 bg-zinc-900 rounded border border-zinc-700 p-4">
                                <div class="flex justify-between items-center pb-2 border-b border-zinc-700">
                                    <span class="text-sm font-medium text-zinc-400">Subtotal</span>
                                    <span class="text-sm font-semibold text-zinc-200">${PRODUCT_SUBTOTAL}</span>
                                </div>
                                <div class="flex justify-between items-center py-2 border-b border-zinc-700">
                                    <span class="text-sm font-medium text-zinc-400">Tax ({currentTaxRate}%)</span>
                                    <span class="text-sm font-semibold text-zinc-200">${currentTax}</span>
                                </div>
                                <div class="flex justify-between items-center pt-2">
                                    <span class="text-sm font-medium text-zinc-400">Total Due</span>
                                    <span class="text-xl font-extrabold text-emerald-400 tracking-tight">
                                        ${zeroDollarAuth ? '0.00' : currentTotal}
                                    </span>
                                </div>
                            </div>

                            {#if remainingTime !== null && remainingTime < TIMEOUT_SECONDS && !sessionExpired}
                                <div class="mb-4 bg-red-900/30 border border-red-700/50 rounded p-2 text-center text-xs text-red-400 animate-pulse">
                                    Payment expires in <strong>{Math.floor(remainingTime / 60)}:{Math.floor(remainingTime % 60).toString().padStart(2, '0')}</strong>
                                </div>
                            {/if}

                            <div class="mt-6 mx-auto w-full max-w-[260px]">
                                {#if paypalLoading}
                                    <div class="flex items-center justify-center h-12 gap-2 text-zinc-500">
                                        <svg class="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                                        </svg>
                                        <span class="text-sm">Loading payment...</span>
                                    </div>
                                {:else}
                                    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
                                    <paypal-button
                                        type={zeroDollarAuth || isRecurring ? undefined : 'pay'}
                                        onclick={handlePayPalClick}
                                        style="width:100%;display:block;"
                                    ></paypal-button>
                                {/if}
                            </div>
                        </div>
                    {/if}

                    {#if errorMessage}
                        <div class="bg-red-900/30 border border-red-700/50 rounded-lg p-6">
                            <p class="text-sm font-semibold text-red-400">{errorMessage}</p>
                        </div>
                    {/if}
                {:else}
                    <div class="bg-emerald-900/30 border border-emerald-700/50 rounded-lg p-6">
                        <div class="flex items-center gap-3 mb-4">
                            <div class="text-emerald-400">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                                </svg>
                            </div>
                            <div>
                                <h3 class="font-bold text-xl text-emerald-300">Payment Successful</h3>
                                <p class="text-sm text-emerald-500">Doom approves this transaction.</p>
                            </div>
                        </div>
                        <div class="p-5 bg-zinc-800 rounded-lg border border-zinc-700 mt-4 space-y-3 text-sm">
                            <div class="flex justify-between items-center pb-2 border-b border-zinc-700">
                                <span class="font-semibold text-zinc-400">Transaction ID:</span>
                                <code class="bg-zinc-900 text-zinc-200 px-3 py-1 rounded font-mono text-xs">{paymentResult.transactionId ?? '—'}</code>
                            </div>
                            <div class="flex justify-between items-center pb-2 border-b border-zinc-700">
                                <span class="font-semibold text-zinc-400">Vault Token:</span>
                                <code class="bg-zinc-900 text-zinc-200 px-3 py-1 rounded font-mono text-xs">{paymentResult.vaultToken ?? '—'}</code>
                            </div>
                            <div class="flex justify-between items-center pb-2 border-b border-zinc-700">
                                <span class="font-semibold text-zinc-400">Nonce:</span>
                                <code class="bg-zinc-900 text-zinc-200 px-3 py-1 rounded font-mono text-xs truncate max-w-[200px]">{paymentResult.nonce}</code>
                            </div>
                            <div class="flex justify-between items-center">
                                <span class="font-semibold text-zinc-400">Payer ID:</span>
                                <code class="bg-zinc-900 text-zinc-200 px-3 py-1 rounded font-mono text-xs">{paymentResult.payerId ?? '—'}</code>
                            </div>
                        </div>
                        <button class="mt-5 w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 px-6 rounded transition-all" onclick={() => location.reload()}>
                            Place Another Order
                        </button>
                    </div>

                    <!-- Charge Stored Token -->
                    <div class="bg-zinc-800 rounded-lg border border-zinc-700 p-5 mt-4">
                        <h3 class="font-bold text-zinc-100 mb-1">Charge Stored Token</h3>
                        <p class="text-xs text-zinc-500 mb-4">Use the vaulted payment method to make a merchant-initiated charge via GraphQL.</p>

                        <div class="space-y-3">
                            <div>
                                <label for="charge-token-id" class="block text-xs font-medium text-zinc-400 mb-1">Payment Method Token</label>
                                <input id="charge-token-id" type="text" bind:value={chargeTokenId}
                                    class="w-full px-3 py-2 border border-zinc-600 bg-zinc-700 text-zinc-100 rounded text-sm font-mono"
                                />
                            </div>
                            <div>
                                <label for="charge-amount" class="block text-xs font-medium text-zinc-400 mb-1">Amount (USD)</label>
                                <input id="charge-amount" type="text" bind:value={chargeAmount}
                                    class="w-full px-3 py-2 border border-zinc-600 bg-zinc-700 text-zinc-100 rounded text-sm font-mono"
                                />
                            </div>
                            <button
                                onclick={chargeStoredToken}
                                disabled={chargingToken || !chargeTokenId}
                                class="w-full py-2.5 bg-emerald-600 text-white font-bold rounded text-sm transition-all
                                       disabled:opacity-40 disabled:cursor-not-allowed hover:bg-emerald-700"
                            >
                                {chargingToken ? 'Charging...' : 'Charge Token'}
                            </button>

                            {#if chargeResult}
                                <div class="bg-emerald-900/30 border border-emerald-700/50 rounded p-3 text-sm">
                                    <p class="font-semibold text-emerald-400">Charge successful</p>
                                    <div class="mt-2 space-y-1 text-xs text-emerald-300">
                                        <div class="flex justify-between">
                                            <span>Transaction ID</span>
                                            <code class="bg-zinc-800 text-zinc-200 px-2 py-0.5 rounded">{chargeResult.transactionId}</code>
                                        </div>
                                    </div>
                                </div>
                            {/if}
                            {#if chargeError}
                                <div class="bg-red-900/30 border border-red-700/50 rounded p-3 text-sm text-red-400">
                                    {chargeError}
                                </div>
                            {/if}
                        </div>
                    </div>
                {/if}
            </div>
        </div>

        <div class="mt-6">
            <DeveloperLogs bind:logs title="Developer Logs — Doomsday Tix" />
        </div>
    </div>
</div>
