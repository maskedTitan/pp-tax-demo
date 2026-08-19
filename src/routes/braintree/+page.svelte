<script>
    import { onMount, onDestroy } from "svelte";
    import { calculateTax, calculateTotal, getTaxRate } from "$lib/taxRates.js";
    import CheckoutOptions from "$lib/components/CheckoutOptions.svelte";
    import ServiceAddressForm from "$lib/components/ServiceAddressForm.svelte";
    import DeveloperLogs from "$lib/components/DeveloperLogs.svelte";
    
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
    let enableSessionTimeout = false;
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
                        config.displayName = 'Acme Corp';
                        if (isRecurring) {
                            config.requestBillingAgreement = true;
                        }
                    }
                    if (disableShipping) {
                        config.enableShippingAddress = false;
                    } else {
                        config.enableShippingAddress = true;
                        if (useServiceAddress) {
                            config.shippingAddressOverride = {
                                recipientName: `${serviceAddress.firstName} ${serviceAddress.lastName}`,
                                line1: `${serviceAddress.houseNumberOrName} ${serviceAddress.street}`.trim(),
                                line2: '',
                                city: serviceAddress.city,
                                countryCode: serviceAddress.country,
                                postalCode: serviceAddress.postalCode,
                                state: serviceAddress.stateOrProvince
                            };
                            config.shippingAddressEditable = !lockAddress;
                        }
                    }
                    if (!finalShippingAddress && useServiceAddress && !disableShipping) {
                        finalShippingAddress = {
                            street: `${serviceAddress.houseNumberOrName} ${serviceAddress.street}`.trim(),
                            city: serviceAddress.city,
                            state: serviceAddress.stateOrProvince,
                            postalCode: serviceAddress.postalCode,
                            countryCode: serviceAddress.country,
                        };
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
                        if (countryCode && countryCode !== 'US' && countryCode !== 'AU') {
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
                    type: payload.type,
                    vaultToken: result.vaultToken
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

    let chargingVault = false;
    let vaultChargeError = "";

    async function chargeVaultedToken() {
        chargingVault = true;
        vaultChargeError = "";
        try {
            addLog("Charging vaulted token...");
            const requestBody = { 
                type: 'paymentMethodToken',
                paymentMethodToken: paymentResult.vaultToken,
                amount: currentTotal.toString()
            };
            addLog("POST /api/braintree/checkout", requestBody);
            
            const res = await fetch('/api/braintree/checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });
            const result = await res.json();
            
            addLog("Charge vaulted token result", result);

            if (result.success) {
                paymentResult = {
                    ...paymentResult,
                    transactionId: result.transactionId
                };
            } else {
                vaultChargeError = `Charge failed: ${result.error}`;
            }
        } catch (error) {
             addLog("Failed to charge vaulted token", { error: error.message });
             vaultChargeError = "Failed to charge vaulted token.";
        } finally {
            chargingVault = false;
        }
    }
</script>

<div class="min-h-screen bg-gray-50">
    <div class="container mx-auto px-8 max-w-7xl py-8">
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <!-- Left Column: Forms and Options -->
            <div class="space-y-6">
                {#if !paymentSuccess}
                    <CheckoutOptions 
                        bind:showCheckoutOptions 
                        bind:disableShipping 
                        bind:isRecurring 
                        bind:zeroDollarAuth 
                        bind:useServiceAddress 
                        bind:lockAddress 
                        bind:enableSessionTimeout 
                        {TIMEOUT_SECONDS} 
                        providerName="Braintree config" 
                    />

                    {#if useServiceAddress}
                        <ServiceAddressForm bind:serviceAddress bind:showServiceAddress />
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

                            <div class="mt-6 mx-auto w-full max-w-[200px] relative">
                                {#if paypalLoading}
                                    <div class="flex items-center justify-center h-12 w-full">
                                        <div class="relative flex items-center justify-center w-8 h-8">
                                            <div class="absolute inset-0 rounded-full border-[3px] border-gray-200"></div>
                                            <div class="absolute inset-0 rounded-full border-[3px] border-black border-t-transparent animate-[spin_0.8s_linear_infinite]"></div>
                                        </div>
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

                                {#if paymentResult.vaultToken}
                                    <div class="mt-4 pt-3 border-t border-gray-200">
                                        <div class="flex items-center justify-between mb-3">
                                            <strong class="text-gray-900">Vaulted Token:</strong>
                                            <code class="bg-blue-50 text-blue-800 px-3 py-1 rounded font-mono text-xs">{paymentResult.vaultToken}</code>
                                        </div>
                                        {#if vaultChargeError}
                                            <div class="mb-3 text-red-600 text-xs font-semibold">{vaultChargeError}</div>
                                        {/if}
                                        {#if chargingVault}
                                            <div class="flex items-center justify-center h-10 w-full bg-blue-50 rounded">
                                                <div class="relative flex items-center justify-center w-6 h-6">
                                                    <div class="absolute inset-0 rounded-full border-[2px] border-blue-200"></div>
                                                    <div class="absolute inset-0 rounded-full border-[2px] border-blue-600 border-t-transparent animate-[spin_0.8s_linear_infinite]"></div>
                                                </div>
                                            </div>
                                        {:else}
                                            <button onclick={chargeVaultedToken} disabled={!!paymentResult.transactionId} class="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed text-white font-semibold py-2 px-4 rounded transition-colors shadow-sm text-sm flex items-center justify-center gap-2">
                                                {#if paymentResult.transactionId}
                                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                                                    </svg>
                                                    Successfully Charged
                                                {:else}
                                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                                                    </svg>
                                                    Charge Vaulted Token (${currentTotal})
                                                {/if}
                                            </button>
                                        {/if}
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

        <DeveloperLogs bind:developerLogs bind:showJson />

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
