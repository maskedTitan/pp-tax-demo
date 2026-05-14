<script>
    import { onMount, onDestroy } from "svelte";
    import { calculateTax, calculateTotal, getTaxRate } from "$lib/taxRates.js";
    
    let paypalContainer;
    let errorMessage = "";
    let paymentSuccess = false;
    let paymentResult = null;
    let paypalLoading = true;

    // Developer Logs
    let developerLogs = [];
    function addLog(step, data = null) {
        const timestamp = new Date().toLocaleTimeString();
        developerLogs = [...developerLogs, { step, data, timestamp }];
        console.log(`[Developer Log] ${step}`, data || '');
    }

    // Feature Flags - merging Adyen and PayPal features
    let disableShipping = false;
    let isRecurring = false;
    let zeroDollarAuth = false;
    let useServiceAddress = true;
    let lockAddress = false;

    const PRODUCT_SUBTOTAL = "10.00";

    // Reactive Tax calculations based on serviceAddress
    $: currentTax = calculateTax(PRODUCT_SUBTOTAL, serviceAddress.stateOrProvince);
    $: currentTotal = calculateTotal(PRODUCT_SUBTOTAL, serviceAddress.stateOrProvince);
    $: currentTaxRate = getTaxRate(serviceAddress.stateOrProvince);

    // Session Timeout
    const TIMEOUT_SECONDS = 30;
    let enableSessionTimeout = true;
    let sessionStartTime = null;
    let sessionTimeoutId = null;
    let countdownIntervalId = null;
    let remainingTime = null;
    let sessionExpired = false;

    $: timeoutMs = TIMEOUT_SECONDS * 1000;

    // UI States
    let showCheckoutOptions = true;
    let showServiceAddress = false;
    let showImplementationNote = false;
    let showJson = false;

    let paypalOrderId = null; 
    let isInitialMount = true;
    
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
        {
            label: "California HQ",
            tax: "8.5%",
            address: { firstName: "Elon", lastName: "Musk", houseNumberOrName: "1", street: "Rocket Rd", city: "Hawthorne", stateOrProvince: "CA", postalCode: "90250", country: "US" }
        },
        {
            label: "Texas Starbase",
            tax: "8.0%",
            address: { firstName: "Star", lastName: "Base", houseNumberOrName: "1", street: "Memories Way", city: "Boca Chica", stateOrProvince: "TX", postalCode: "78521", country: "US" }
        },
        {
            label: "Florida Pad",
            tax: "7.0%",
            address: { firstName: "Launch", lastName: "Complex", houseNumberOrName: "39A", street: "Space Center", city: "Merritt Island", stateOrProvince: "FL", postalCode: "32899", country: "US" }
        },
        {
            label: "Delaware Office",
            tax: "0%",
            address: { firstName: "John", lastName: "Doe", houseNumberOrName: "1209", street: "Orange St", city: "Wilmington", stateOrProvince: "DE", postalCode: "19801", country: "US" }
        }
    ];
    
    let finalShippingAddress = null;
    let braintreeClientToken = null;
    let paypalInstance = null;

    function startSessionTimer() {
        if (!enableSessionTimeout) return;
        clearSessionTimer();
        sessionStartTime = Date.now();
        sessionExpired = false;
        remainingTime = Math.floor(timeoutMs / 1000);

        sessionTimeoutId = setTimeout(() => {
            sessionExpired = true;
            remainingTime = 0;
            clearSessionTimer();
            if (paypalContainer) paypalContainer.innerHTML = '';
        }, timeoutMs);

        countdownIntervalId = setInterval(() => {
            if (sessionStartTime) {
                const elapsed = Date.now() - sessionStartTime;
                remainingTime = Math.max(0, Math.floor((timeoutMs - elapsed) / 1000));
            }
        }, 1000);
    }

    function clearSessionTimer() {
        if (sessionTimeoutId) clearTimeout(sessionTimeoutId);
        if (countdownIntervalId) clearInterval(countdownIntervalId);
    }

    function resetSession() {
        sessionExpired = false;
        sessionStartTime = null;
        remainingTime = null;
        clearSessionTimer();
        setupBraintreePaypal(); // Remount
    }

    onDestroy(() => {
        clearSessionTimer();
    });

    async function setupBraintreePaypal() {
        paypalLoading = true;
        try {
            addLog("Initializing Braintree PayPal setup...");
            if (!braintreeClientToken) {
                addLog("Fetching Braintree Client Token...");
                const res = await fetch('/api/braintree/client-token');
                if (!res.ok) throw new Error("Failed to fetch Braintree Token");
                const data = await res.json();
                braintreeClientToken = data.clientToken;
                addLog("Braintree Client Token fetched successfully", { clientTokenPreview: braintreeClientToken.substring(0, 20) + "..." });
            } else {
                addLog("Using existing Braintree Client Token");
            }

            addLog("Importing braintree-web module...");
            const module = await import('braintree-web');

            addLog("Creating Braintree client instance...");
            const clientInstance = await module.client.create({
                authorization: braintreeClientToken
            });

            addLog("Creating PayPal Checkout instance...");
            paypalInstance = await module.paypalCheckout.create({
                client: clientInstance
            });

            if (paypalContainer) paypalContainer.innerHTML = '';

            addLog("Loading PayPal SDK...");
            const sdkConfig = {
                currency: 'USD'
            };
            if (zeroDollarAuth) {
                sdkConfig.vault = true;
            } else {
                sdkConfig.intent = 'capture';
            }

            await paypalInstance.loadPayPalSDK(sdkConfig);

            if (window.paypal && paypalContainer) {
                addLog("Rendering PayPal Buttons...");

                // Only $0 auth is true vault mode (no amount shown, billing agreement only).
                // isRecurring uses checkout flow + requestBillingAgreement to show the amount
                // while still setting up a vault token alongside the transaction.
                const isVaultMode = zeroDollarAuth;

                function buildPaymentConfig() {
                    const flow = isVaultMode ? 'vault' : 'checkout';
                    const config = { flow, currency: 'USD' };
                    if (flow === 'checkout') {
                        config.intent = 'capture';
                        config.amount = currentTotal.toString();
                        config.displayName = 'SpaceX Parts Store';
                        if (isRecurring) {
                            config.requestBillingAgreement = true;
                        }
                    }
                    if (!isVaultMode) {
                        if (disableShipping) {
                            config.enableShippingAddress = false;
                        } else {
                            config.enableShippingAddress = true;
                            if (useServiceAddress) {
                                config.shippingAddressOverride = {
                                    recipientName: `${serviceAddress.firstName} ${serviceAddress.lastName}`,
                                    line1: serviceAddress.street,
                                    line2: serviceAddress.houseNumberOrName,
                                    city: serviceAddress.city,
                                    countryCode: serviceAddress.country,
                                    postalCode: serviceAddress.postalCode,
                                    state: serviceAddress.stateOrProvince,
                                    phone: '1234567890'
                                };
                                config.shippingAddressEditable = !lockAddress;
                            }
                        }
                        if (!finalShippingAddress && useServiceAddress && !disableShipping) {
                            finalShippingAddress = {
                                street: `${serviceAddress.houseNumberOrName} ${serviceAddress.street}`,
                                city: serviceAddress.city,
                                state: serviceAddress.stateOrProvince,
                                postalCode: serviceAddress.postalCode,
                                countryCode: serviceAddress.country,
                            };
                        }
                    }
                    return config;
                }

                const buttonConfig = {
                    fundingSource: window.paypal.FUNDING.PAYPAL,
                    style: { height: 48, shape: 'rect', color: 'black' },
                    onApprove: async function (data, actions) {
                        addLog("PayPal onApprove triggered", data);
                        try {
                            const payload = await paypalInstance.tokenizePayment(data);
                            addLog("Payment tokenized successfully", payload);
                            paypalOrderId = payload.nonce;
                            await submitNonceToServer(payload);
                        } catch (err) {
                            addLog("Error tokenizing payment", err);
                            errorMessage = err.message || "Failed to tokenize payment";
                        }
                    },
                    onCancel: function (data) {
                        addLog("PayPal checkout canceled", data);
                        clearSessionTimer();
                    },
                    onError: function (err) {
                        addLog("PayPal Error", err);
                        console.error('PayPal Error:', err);
                        errorMessage = err.message || "An error occurred with PayPal.";
                    }
                };

                // intent=tokenize (vault mode) requires createBillingAgreement, not createOrder.
                // onShippingChange is only valid in checkout flow.
                if (isVaultMode) {
                    buttonConfig.createBillingAgreement = function () {
                        addLog("createBillingAgreement called — vault flow");
                        if (enableSessionTimeout && !sessionStartTime) startSessionTimer();
                        const config = buildPaymentConfig();
                        addLog("Calling paypalInstance.createPayment", config);
                        return paypalInstance.createPayment(config);
                    };
                } else {
                    buttonConfig.createOrder = function () {
                        addLog("createOrder called — checkout flow");
                        if (enableSessionTimeout && !sessionStartTime) startSessionTimer();
                        const config = buildPaymentConfig();
                        addLog("Calling paypalInstance.createPayment", config);
                        return paypalInstance.createPayment(config);
                    };
                    buttonConfig.onShippingChange = function (data, actions) {
                        addLog("PayPal onShippingChange triggered", data);
                        const stateCode = data.shipping_address?.state || data.shippingAddress?.state;
                        const countryCode = data.shipping_address?.country_code || data.shippingAddress?.countryCode;
                        if (countryCode && countryCode !== 'US') {
                            addLog("Rejecting shipping change: unsupported country", { countryCode });
                            return actions.reject(data.errors.COUNTRY_ERROR);
                        }
                        if (!stateCode || disableShipping) {
                            addLog("Resolving shipping change directly");
                            return actions.resolve();
                        }
                        const newTotal = calculateTotal(PRODUCT_SUBTOTAL, stateCode);
                        if (newTotal === currentTotal.toString()) {
                            addLog("Tax unchanged, resolving immediately", { stateCode, newTotal });
                            return actions.resolve();
                        }
                        addLog("Updating payment with new total", { amount: newTotal });
                        return paypalInstance.updatePayment({
                            amount: newTotal,
                            currency: 'USD',
                            paymentId: data.paymentId || data.orderID,
                            shippingAddress: data.shippingAddress || data.shipping_address
                        });
                    };
                }

                await window.paypal.Buttons(buttonConfig).render(paypalContainer);
                paypalLoading = false;
                addLog("PayPal Buttons rendered successfully");
            }
        } catch (err) {
            paypalLoading = false;
            addLog("Braintree Initialization Error", { message: err.message });
            console.error('Braintree Initialization Error:', err);
            errorMessage = err.message || "Failed to initialize Braintree. Check configuration.";
        }
    }

    $: disableShipping, lockAddress, useServiceAddress, isRecurring, zeroDollarAuth, rebuildPaypal();
    function rebuildPaypal() {
        if (!isInitialMount && braintreeClientToken && !paymentSuccess) {
            setupBraintreePaypal();
        }
    }

    onMount(async () => {
        await setupBraintreePaypal();
        isInitialMount = false;
    });

    async function submitNonceToServer(payload) {
        try {
            addLog("Submitting nonce to server for transaction...");
            const amountStr = zeroDollarAuth ? '0.00' : currentTotal.toString();
            const requestBody = { 
                nonce: payload.nonce, 
                isVault: zeroDollarAuth || isRecurring,
                amount: amountStr 
            };
            addLog("POST /api/braintree/checkout", requestBody);
            
            const res = await fetch('/api/braintree/checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });
            const result = await res.json();
            
            addLog("Server responded with transaction result", result);

            if (result.success) {
                paymentSuccess = true;
                paymentResult = {
                    transactionId: result.transactionId,
                    nonce: payload.nonce,
                    details: payload.details,
                    type: payload.type
                };
                
                // If Braintree captures shipping address details in payload
                if (payload.details?.shippingAddress) {
                    finalShippingAddress = payload.details.shippingAddress;
                }
                
                clearSessionTimer();
            } else {
                errorMessage = `Payment failed: ${result.error}`;
            }
        } catch (error) {
             addLog("Failed to submit transaction to server", { error: error.message });
             errorMessage = "Failed to submit transaction to server.";
        }
    }
</script>

<div class="min-h-screen bg-gray-50">
    <div class="container mx-auto px-8 max-w-7xl py-8">
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <!-- Left Column: Forms and Options -->
            <div class="space-y-6">
                {#if !paymentSuccess}
                    <div class="bg-white rounded-lg border border-gray-200 overflow-hidden">
                        <button onclick={() => (showCheckoutOptions = !showCheckoutOptions)} class="w-full p-4 flex items-center justify-between text-left hover:bg-gray-50 transition-colors">
                            <div class="flex items-center gap-3">
                                <div class="text-blue-600">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                                    </svg>
                                </div>
                                <h3 class="font-bold text-gray-900 text-sm">Checkout Options (Braintree config)</h3>
                            </div>
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-400 transition-transform {showCheckoutOptions ? 'rotate-180' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                            </svg>
                        </button>

                        {#if showCheckoutOptions}
                            <div class="px-4 pb-4 border-t border-gray-100 pt-2 space-y-2">
                                <label class="flex items-center p-2 rounded hover:bg-gray-50 cursor-pointer">
                                    <input type="checkbox" bind:checked={disableShipping} class="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 border-gray-300" />
                                    <div class="ml-3">
                                        <span class="block text-sm font-medium text-gray-900">Disable Shipping Address</span>
                                        <p class="text-xs text-gray-500">Hide address in checkout</p>
                                    </div>
                                </label>
                                
                                <label class="flex items-center p-2 rounded hover:bg-gray-50 cursor-pointer">
                                    <input type="checkbox" bind:checked={isRecurring} class="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 border-gray-300" />
                                    <div class="ml-3">
                                        <span class="block text-sm font-medium text-gray-900">Subscribe (Recurring / Vault)</span>
                                        <p class="text-xs text-gray-500">Save payment for future</p>
                                    </div>
                                </label>

                                <label class="flex items-center p-2 rounded hover:bg-gray-50 cursor-pointer pl-6">
                                    <input type="checkbox" bind:checked={zeroDollarAuth} class="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 border-gray-300" />
                                    <div class="ml-3">
                                        <span class="block text-sm font-medium text-gray-900">$0 Auth (Vault Only)</span>
                                        <p class="text-xs text-gray-500">Save without charging up front</p>
                                    </div>
                                </label>

                                <label class="flex items-center p-2 rounded hover:bg-gray-50 cursor-pointer">
                                    <input type="checkbox" bind:checked={useServiceAddress} class="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 border-gray-300" />
                                    <div class="ml-3">
                                        <span class="block text-sm font-medium text-gray-900">Include Service Address</span>
                                        <p class="text-xs text-gray-500">Prefill address in PayPal</p>
                                    </div>
                                </label>

                                {#if useServiceAddress}
                                    <label class="flex items-center p-2 rounded hover:bg-gray-50 cursor-pointer pl-6">
                                        <input type="checkbox" bind:checked={lockAddress} class="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 border-gray-300" />
                                        <div class="ml-3">
                                            <span class="block text-sm font-medium text-gray-900">Lock Address</span>
                                            <p class="text-xs text-gray-500">Prevent editing in popup</p>
                                        </div>
                                    </label>
                                {/if}

                                <div class="border-t border-gray-200 my-3 pt-3">
                                    <p class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Session Timeout</p>
                                </div>

                                <label class="flex items-center p-2 rounded hover:bg-gray-50 cursor-pointer">
                                    <input type="checkbox" bind:checked={enableSessionTimeout} class="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 border-gray-300" />
                                    <div class="ml-3">
                                        <span class="block text-sm font-medium text-gray-900">Enable Session Timeout</span>
                                        <p class="text-xs text-gray-500">Expire checkout after {TIMEOUT_SECONDS} seconds</p>
                                    </div>
                                </label>
                            </div>
                        {/if}
                    </div>

                    {#if useServiceAddress}
                        <div class="bg-white rounded-lg border border-gray-200 overflow-hidden">
                            <button onclick={() => (showServiceAddress = !showServiceAddress)} class="w-full p-4 flex items-center justify-between text-left hover:bg-gray-50 transition-colors">
                                <div class="flex items-center gap-3">
                                    <div class="text-orange-600">
                                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                                        </svg>
                                    </div>
                                    <h4 class="font-bold text-gray-900 text-sm">Service Address</h4>
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
                                                <button 
                                                    type="button" 
                                                    class="text-left p-3 border {serviceAddress.stateOrProvince === demo.address.stateOrProvince ? 'border-orange-400 bg-orange-50' : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'} rounded-lg transition-colors"
                                                    onclick={() => serviceAddress = { ...demo.address }}
                                                >
                                                    <div class="flex justify-between items-center mb-1">
                                                        <span class="font-bold text-gray-900 text-xs">{demo.label}</span>
                                                        <span class="text-[10px] font-bold px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">{demo.tax} Tax</span>
                                                    </div>
                                                    <div class="text-xs text-gray-500 truncate">{demo.address.city}, {demo.address.stateOrProvince}</div>
                                                </button>
                                            {/each}
                                        </div>
                                    </div>
                                    <div class="grid grid-cols-1 gap-3">
                                        <div class="grid grid-cols-2 gap-3">
                                            <div>
                                                <label for="firstName" class="block text-xs font-semibold text-gray-700 mb-1">First Name</label>
                                                <input id="firstName" class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm" type="text" bind:value={serviceAddress.firstName} />
                                            </div>
                                            <div>
                                                <label for="lastName" class="block text-xs font-semibold text-gray-700 mb-1">Last Name</label>
                                                <input id="lastName" class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm" type="text" bind:value={serviceAddress.lastName} />
                                            </div>
                                        </div>
                                        <div class="grid grid-cols-4 gap-3">
                                            <div>
                                                <label for="houseNumber" class="block text-xs font-semibold text-gray-700 mb-1">Number</label>
                                                <input id="houseNumber" class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm" type="text" bind:value={serviceAddress.houseNumberOrName} />
                                            </div>
                                            <div class="col-span-3">
                                                <label for="street" class="block text-xs font-semibold text-gray-700 mb-1">Street</label>
                                                <input id="street" class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm" type="text" bind:value={serviceAddress.street} />
                                            </div>
                                        </div>
                                        <div class="grid grid-cols-2 gap-3">
                                            <div>
                                                <label for="city" class="block text-xs font-semibold text-gray-700 mb-1">City</label>
                                                <input id="city" class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm" type="text" bind:value={serviceAddress.city} />
                                            </div>
                                            <div>
                                                <label for="postalCode" class="block text-xs font-semibold text-gray-700 mb-1">Postal Code</label>
                                                <input id="postalCode" class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm" type="text" bind:value={serviceAddress.postalCode} />
                                            </div>
                                        </div>
                                        <div class="grid grid-cols-2 gap-3">
                                            <div>
                                                <label for="state" class="block text-xs font-semibold text-gray-700 mb-1">State</label>
                                                <input id="state" class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm uppercase" type="text" bind:value={serviceAddress.stateOrProvince} maxlength="2" />
                                            </div>
                                            <div>
                                                <label for="country" class="block text-xs font-semibold text-gray-700 mb-1">Country</label>
                                                <input id="country" class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm uppercase" type="text" bind:value={serviceAddress.country} maxlength="2" />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            {/if}
                        </div>
                    {/if}
                {/if}
            </div>

            <!-- Right Column -->
            <div class="space-y-6">
                {#if !paymentSuccess}
                    {#if sessionExpired}
                        <div class="p-5 bg-white rounded-lg border border-gray-200">
                            <p class="text-gray-700 mb-2"><span class="font-medium">Session timed out</span></p>
                            <button onclick={resetSession} class="px-4 py-2 bg-gray-900 text-white text-sm rounded hover:bg-gray-800 transition-colors">Restart Checkout</button>
                        </div>
                    {:else}
                        <div class="p-5 bg-white rounded-lg border border-gray-200 sticky top-6">
                            <div class="flex items-center gap-2 mb-4">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                                </svg>
                                <h4 class="font-bold text-gray-900 text-lg">Complete Payment</h4>
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

                            <div class="mt-6 mx-auto w-full max-w-[260px] relative">
                                {#if paypalLoading}
                                    <div class="flex items-center justify-center h-12 gap-2 text-gray-400">
                                        <svg class="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                                        </svg>
                                        <span class="text-sm">Loading payment...</span>
                                    </div>
                                {/if}
                                <div bind:this={paypalContainer} class:hidden={paypalLoading}></div>
                            </div>
                        </div>
                    {/if}

                    {#if errorMessage}
                        <div class="bg-red-50 border border-red-200 rounded-lg p-6">
                            <div class="flex items-center gap-3">
                                <div class="text-red-500">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </div>
                                <p class="text-sm font-semibold text-red-800">{errorMessage}</p>
                            </div>
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
                        <div class="p-5 bg-white rounded-lg border border-gray-200 mt-4">
                            <div class="space-y-3 text-sm">
                                <div class="flex justify-between items-center pb-2 border-b border-gray-100">
                                    <span class="font-semibold text-gray-700">Transaction ID:</span>
                                    <code class="bg-gray-100 px-3 py-1 rounded font-mono text-xs">{paymentResult.transactionId}</code>
                                </div>
                                <div class="flex justify-between items-center pb-2 border-b border-gray-100">
                                    <span class="font-semibold text-gray-700">Nonce:</span>
                                    <code class="bg-gray-100 px-3 py-1 rounded font-mono text-xs truncate max-w-[200px]">{paymentResult.nonce}</code>
                                </div>

                                {#if finalShippingAddress}
                                    <div class="mt-4 pt-3 border-t border-gray-200">
                                        <div class="flex items-center gap-2 mb-3">
                                            <strong class="text-gray-900">Shipping Address:</strong>
                                        </div>
                                        <div class="bg-gray-50 rounded p-4 text-gray-700">
                                            <p class="font-medium">
                                                {finalShippingAddress.street || finalShippingAddress.line1 || finalShippingAddress.address_line_1 || ""}
                                                {finalShippingAddress.line2 || finalShippingAddress.address_line_2 ? `, ${finalShippingAddress.line2 || finalShippingAddress.address_line_2}` : ""}
                                            </p>
                                            <p>{finalShippingAddress.city || finalShippingAddress.admin_area_2}, {finalShippingAddress.state || finalShippingAddress.admin_area_1}</p>
                                            <p>{finalShippingAddress.postalCode || finalShippingAddress.postal_code}</p>
                                            <p class="font-semibold">{finalShippingAddress.countryCode || finalShippingAddress.country_code}</p>
                                        </div>
                                    </div>
                                {/if}
                            </div>
                        </div>
                        <button class="mt-5 w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded transition-all" onclick={() => location.reload()}>
                            Place Another Order
                        </button>
                    </div>
                {/if}
            </div>
        </div>

        <!-- Developer Logs Panel -->
        <div class="mt-6 bg-gray-900 rounded-lg overflow-hidden border border-gray-800 shadow-xl">
            <div class="p-4 border-b border-gray-800 flex justify-between items-center bg-gray-950">
                <h3 class="font-mono text-sm font-bold text-green-400 flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    Developer Logs
                </h3>
                <button onclick={() => developerLogs = []} class="text-xs text-gray-400 hover:text-white transition-colors">Clear Logs</button>
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

        <div class="mt-6 bg-white border border-gray-200 rounded-lg overflow-hidden">
            <button onclick={() => (showImplementationNote = !showImplementationNote)} class="w-full p-4 flex items-center justify-between text-left hover:bg-gray-50 transition-colors">
                <div class="flex items-center gap-3">
                    <p class="font-bold text-gray-900">Implementation Note</p>
                </div>
            </button>

            {#if showImplementationNote}
                <div class="px-5 pb-5 pt-0">
                    <div class="ml-9">
                        <p class="text-sm text-gray-700 mb-2">
                            This is a demonstration using Braintree's PayPal Checkout component.
                            It mimics features available in the Adyen implementation.
                        </p>
                    </div>
                </div>
            {/if}
        </div>
    </div>
</div>
