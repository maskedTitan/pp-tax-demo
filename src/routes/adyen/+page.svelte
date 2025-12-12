<script>
    import { onMount } from "svelte";
    // Dynamic import of CSS and JS to avoid SSR/Build issues

    let adyenContainer;
    let errorMessage = "";
    let paymentSuccess = false;
    let paymentResult = null;

    // New Features State
    let isRecurring = true;
    let lockAddress = false;
    let useServiceAddress = true;
    let currentPaymentData = null;
    let currentPspReference = null;
    let paypalOrderId = null;
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
    let showJson = false;

    // Placeholder configuration - in a real app these come from backend
    const clientKey = import.meta.env.VITE_ADYEN_CLIENT_KEY;
    const environment = "test";

    onMount(async () => {
        try {
            // Dynamically import Adyen to ensure it only runs on client and avoids build resolution issues
            const module = await import("@adyen/adyen-web");
            const AdyenCheckout = module.default || module.AdyenCheckout;
            const PayPal = module.PayPal; // Get PayPal class

            // Dynamically import CSS
            await import("@adyen/adyen-web/styles/adyen.css");

            const configuration = {
                environment,
                clientKey,
                countryCode: "US",
                analytics: {
                    enabled: false, // Disabled for localhost dev
                },
                onError: (error) => {
                    console.error("Adyen Error:", error);
                },
            };

            console.log("Initializing AdyenCheckout...");
            const checkout = await AdyenCheckout(configuration);
            console.log("Checkout initialized");

            // Create PayPal component using v6 API (direct instantiation)
            const paypalComponent = new PayPal(checkout, {
                environment,
                showPayButton: true,
                countryCode: "US", // Required for PayPal
                amount: {
                    value: 1000,
                    currency: "USD",
                },
                // Enable Express Checkout flow to allow address updates
                isExpress: true,
                blockPayPalCreditButton: true,
                blockPayPalPayLaterButton: true,

                // Handling Address Changes (Required for "Editable" address)
                onShippingAddressChange: async (data, actions) => {
                    console.log(
                        "Adyen: User changed shipping address in PayPal",
                        data,
                    );

                    if (data.orderID) {
                        paypalOrderId = data.orderID;
                    }

                    // Update final display address from PayPal data
                    if (data.shippingAddress) {
                        finalShippingAddress = data.shippingAddress;
                    }

                    const countryCode = data.shippingAddress?.countryCode;
                    if (countryCode && countryCode !== "US") {
                        return actions.reject(data.errors.COUNTRY_ERROR);
                    }

                    try {
                        // We need the original paymentData and pspReference to update the order
                        if (!currentPaymentData || !currentPspReference) {
                            console.warn(
                                "No paymentData or pspReference available for updateOrder",
                            );
                            return Promise.resolve();
                        }

                        const response = await fetch(
                            "/api/adyen/payments/update-order",
                            {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                    paymentData: currentPaymentData,
                                    pspReference: currentPspReference,
                                    shippingAddress: data.shippingAddress,
                                }),
                            },
                        );

                        const result = await response.json();

                        if (result.paymentData) {
                            console.log(
                                "Adyen: Order updated successfully",
                                result,
                            );
                            // Update our local reference for subsequent changes
                            currentPaymentData = result.paymentData;
                            // Resolve with the new payload for Adyen
                            // Adyen expects an object potentially containing paymentData
                            return Promise.resolve(result);
                        } else {
                            console.error("Adyen: Update failed", result);
                            return actions.reject();
                        }
                    } catch (error) {
                        console.error("Adyen: Update error", error);
                        return actions.reject();
                    }
                },

                onShippingOptionsChange: (data) => {
                    console.log("Adyen: User changed shipping option", data);
                    return Promise.resolve();
                },

                onSubmit: async (state, component) => {
                    console.log("PayPal Submit (Payment Data):", state.data);
                    component.setStatus("loading");

                    // Only Initialize final address with form data IF it hasn't been updated by PayPal events
                    // And only if we are using the service address
                    if (!finalShippingAddress && useServiceAddress) {
                        finalShippingAddress = {
                            street: `${serviceAddress.houseNumberOrName} ${serviceAddress.street}`,
                            city: serviceAddress.city,
                            state: serviceAddress.stateOrProvince,
                            postalCode: serviceAddress.postalCode,
                            countryCode: serviceAddress.country,
                        };
                    }

                    try {
                        const payload = {
                            data: state.data,
                            recurring: isRecurring,
                            lockAddress: lockAddress && useServiceAddress, // Only lock if we are sending an address
                        };

                        if (useServiceAddress) {
                            payload.shopperName = {
                                firstName: serviceAddress.firstName,
                                lastName: serviceAddress.lastName,
                            };
                            payload.deliveryAddress = {
                                street: serviceAddress.street,
                                houseNumberOrName:
                                    serviceAddress.houseNumberOrName,
                                city: serviceAddress.city,
                                stateOrProvince: serviceAddress.stateOrProvince,
                                postalCode: serviceAddress.postalCode,
                                country: serviceAddress.country,
                            };
                        }

                        const response = await fetch("/api/adyen/payments", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(payload),
                        });

                        const result = await response.json();

                        if (!response.ok) {
                            throw new Error(result.error || "Payment failed");
                        }

                        if (result.action) {
                            // Store paymentData for future updates (e.g. shipping change)
                            if (result.action.paymentData) {
                                currentPaymentData = result.action.paymentData;
                            }
                            if (result.pspReference) {
                                currentPspReference = result.pspReference;
                            }
                            component.handleAction(result.action);
                        } else {
                            component.setStatus("ready");
                            paymentSuccess = true;
                            paymentResult = result;
                        }
                    } catch (error) {
                        console.error("Payment Error:", error);
                        component.setStatus("ready");
                        alert("Payment Error: " + error.message);
                    }
                },

                onAdditionalDetails: async (state, component) => {
                    console.log("PayPal Additional Details:", state.data);
                    component.setStatus("loading");

                    try {
                        // Merge state.data with currentPaymentData to ensure we send the latest signature
                        const detailsRequest = { ...state.data };
                        if (currentPaymentData) {
                            detailsRequest.paymentData = currentPaymentData;
                        }

                        const response = await fetch(
                            "/api/adyen/payments/details",
                            {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ data: detailsRequest }),
                            },
                        );

                        const result = await response.json();
                        console.log("Final Adyen Result:", result);

                        if (!response.ok) {
                            throw new Error(
                                result.error || "Payment details failed",
                            );
                        }

                        if (result.action) {
                            component.handleAction(result.action);
                        } else {
                            // Show success/result
                            component.setStatus("ready");
                            paymentSuccess = true;
                            paymentResult = result;

                            // Attempt to fetch full address details from PayPal if we have the Order ID
                            if (paypalOrderId) {
                                try {
                                    console.log(
                                        "Fetching full PayPal order details for:",
                                        paypalOrderId,
                                    );
                                    const ppResponse = await fetch(
                                        `/api/paypal/order/${paypalOrderId}`,
                                    );
                                    const ppOrder = await ppResponse.json();
                                    console.log(
                                        "[DEBUG] Fetched PayPal Order:",
                                        ppOrder,
                                    );

                                    if (
                                        ppOrder.purchase_units?.[0]?.shipping
                                            ?.address
                                    ) {
                                        const ppAddress =
                                            ppOrder.purchase_units[0].shipping
                                                .address;
                                        console.log(
                                            "[DEBUG] Full PayPal Address from Fetch:",
                                            ppAddress,
                                        );

                                        // Update display with high-fidelity address
                                        finalShippingAddress = {
                                            street: ppAddress.address_line_1,
                                            line2: ppAddress.address_line_2,
                                            city: ppAddress.admin_area_2,
                                            state: ppAddress.admin_area_1,
                                            postalCode: ppAddress.postal_code,
                                            countryCode: ppAddress.country_code,
                                        };
                                    }
                                } catch (err) {
                                    console.error(
                                        "Failed to fetch full PayPal address:",
                                        err,
                                    );
                                }
                            }
                        }
                    } catch (error) {
                        console.error("Payment Details Error:", error);
                        component.setStatus("ready");
                        alert("Payment Details Error: " + error.message);
                    }
                },

                onCancel: (data, component) => {
                    console.log("PayPal Cancelled:", data);
                },
                onError: (error, component) => {
                    console.error("PayPal Error:", error);
                },
            });

            if (adyenContainer) {
                paypalComponent.mount(adyenContainer);
            }
        } catch (error) {
            console.error("Failed to initialize Adyen:", error);
            errorMessage =
                "Failed to initialize Adyen checkout. Check console for details.";
        }
    });
</script>

<div class="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
    <div class="container mx-auto px-8 max-w-7xl py-8">
        <!-- Two Column Layout -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <!-- Left Column: Forms and Options -->
            <div class="space-y-6">
                {#if !paymentSuccess}
                    <!-- Checkout Options -->
                    <div
                        class="mb-6 p-5 bg-gradient-to-r from-slate-50 to-slate-100 rounded-xl border border-slate-200/50 shadow-sm"
                    >
                        <div class="flex items-center gap-2 mb-4">
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                class="h-5 w-5 text-purple-600"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                            >
                                <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    stroke-width="2"
                                    d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
                                />
                            </svg>
                            <h3 class="font-bold text-slate-800 text-lg">
                                Checkout Options
                            </h3>
                        </div>

                        <!-- Recurring Checkbox -->
                        <div class="space-y-3">
                            <label
                                class="flex items-start p-4 bg-white border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-50 transition-colors"
                            >
                                <input
                                    type="checkbox"
                                    id="recurring"
                                    bind:checked={isRecurring}
                                    class="w-5 h-5 text-purple-600 rounded focus:ring-purple-500 border-slate-300 mt-0.5"
                                />
                                <div class="ml-3">
                                    <span class="font-semibold text-slate-800"
                                        >Subscribe (Recurring Payment)</span
                                    >
                                    <p class="text-xs text-slate-500 mt-1">
                                        Save payment details for future
                                        automatic payments
                                    </p>
                                </div>
                            </label>

                            <!-- Toggle Service Address -->
                            <label
                                class="flex items-start p-4 bg-white border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-50 transition-colors"
                            >
                                <input
                                    type="checkbox"
                                    id="useServiceAddress"
                                    bind:checked={useServiceAddress}
                                    class="w-5 h-5 text-purple-600 rounded focus:ring-purple-500 border-slate-300 mt-0.5"
                                />
                                <div class="ml-3">
                                    <span class="font-semibold text-slate-800"
                                        >Include Service Address</span
                                    >
                                    <p class="text-xs text-slate-500 mt-1">
                                        Prefill the address in PayPal
                                    </p>
                                </div>
                            </label>

                            {#if useServiceAddress}
                                <!-- Lock Address Checkbox -->
                                <label
                                    class="flex items-start p-4 bg-white border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-50 transition-colors"
                                >
                                    <input
                                        type="checkbox"
                                        id="lockAddress"
                                        bind:checked={lockAddress}
                                        class="w-5 h-5 text-purple-600 rounded focus:ring-purple-500 border-slate-300 mt-0.5"
                                    />
                                    <div class="ml-3">
                                        <span
                                            class="font-semibold text-slate-800"
                                            >Lock Address in PayPal</span
                                        >
                                        <p class="text-xs text-slate-500 mt-1">
                                            Uncheck to allow editing address in
                                            PayPal popup
                                        </p>
                                    </div>
                                </label>
                            {/if}
                        </div>
                    </div>

                    {#if useServiceAddress}
                        <!-- Service Address Form -->
                        <div
                            class="mb-6 p-5 bg-gradient-to-r from-slate-50 to-slate-100 rounded-xl border border-slate-200/50 shadow-sm"
                        >
                            <div class="flex items-center gap-2 mb-4">
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    class="h-5 w-5 text-orange-600"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                >
                                    <path
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        stroke-width="2"
                                        d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                                    />
                                    <path
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        stroke-width="2"
                                        d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                                    />
                                </svg>
                                <h4 class="font-bold text-slate-800 text-lg">
                                    Service Address
                                </h4>
                            </div>
                            <div class="grid grid-cols-1 gap-4">
                                <div class="grid grid-cols-2 gap-4">
                                    <div>
                                        <label
                                            for="firstName"
                                            class="block text-sm font-semibold text-slate-700 mb-2"
                                            >First Name</label
                                        >
                                        <input
                                            id="firstName"
                                            class="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all bg-white hover:bg-slate-50"
                                            type="text"
                                            placeholder="John"
                                            bind:value={
                                                serviceAddress.firstName
                                            }
                                        />
                                    </div>
                                    <div>
                                        <label
                                            for="lastName"
                                            class="block text-sm font-semibold text-slate-700 mb-2"
                                            >Last Name</label
                                        >
                                        <input
                                            id="lastName"
                                            class="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all bg-white hover:bg-slate-50"
                                            type="text"
                                            placeholder="Doe"
                                            bind:value={serviceAddress.lastName}
                                        />
                                    </div>
                                </div>
                                <div class="grid grid-cols-4 gap-4">
                                    <div>
                                        <label
                                            for="houseNumber"
                                            class="block text-sm font-semibold text-slate-700 mb-2"
                                            >Number</label
                                        >
                                        <input
                                            id="houseNumber"
                                            class="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all bg-white hover:bg-slate-50"
                                            type="text"
                                            placeholder="123"
                                            bind:value={
                                                serviceAddress.houseNumberOrName
                                            }
                                        />
                                    </div>
                                    <div class="col-span-3">
                                        <label
                                            for="street"
                                            class="block text-sm font-semibold text-slate-700 mb-2"
                                            >Street Name</label
                                        >
                                        <input
                                            id="street"
                                            class="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all bg-white hover:bg-slate-50"
                                            type="text"
                                            placeholder="Rocket Rd"
                                            bind:value={serviceAddress.street}
                                        />
                                    </div>
                                </div>
                                <div class="grid grid-cols-2 gap-4">
                                    <div>
                                        <label
                                            for="city"
                                            class="block text-sm font-semibold text-slate-700 mb-2"
                                            >City</label
                                        >
                                        <input
                                            id="city"
                                            class="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all bg-white hover:bg-slate-50"
                                            type="text"
                                            placeholder="Hawthorne"
                                            bind:value={serviceAddress.city}
                                        />
                                    </div>
                                    <div>
                                        <label
                                            for="postalCode"
                                            class="block text-sm font-semibold text-slate-700 mb-2"
                                            >Postal Code</label
                                        >
                                        <input
                                            id="postalCode"
                                            class="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all bg-white hover:bg-slate-50"
                                            type="text"
                                            placeholder="90250"
                                            bind:value={
                                                serviceAddress.postalCode
                                            }
                                        />
                                    </div>
                                </div>
                                <div class="grid grid-cols-2 gap-4">
                                    <div>
                                        <label
                                            for="state"
                                            class="block text-sm font-semibold text-slate-700 mb-2"
                                            >State / Province</label
                                        >
                                        <input
                                            id="state"
                                            class="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all bg-white hover:bg-slate-50 uppercase"
                                            type="text"
                                            placeholder="CA"
                                            maxlength="2"
                                            bind:value={
                                                serviceAddress.stateOrProvince
                                            }
                                        />
                                    </div>
                                    <div>
                                        <label
                                            for="country"
                                            class="block text-sm font-semibold text-slate-700 mb-2"
                                            >Country</label
                                        >
                                        <input
                                            id="country"
                                            class="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all bg-white hover:bg-slate-50 uppercase"
                                            type="text"
                                            placeholder="US"
                                            maxlength="2"
                                            bind:value={serviceAddress.country}
                                        />
                                    </div>
                                </div>
                            </div>
                            <p
                                class="text-xs text-slate-500 mt-4 p-3 bg-amber-50 rounded-lg border border-amber-200/50"
                            >
                                ℹ️ This address will be prefilled in PayPal
                                checkout (if lock address is enabled).
                            </p>
                        </div>
                    {/if}
                {/if}
            </div>

            <!-- Right Column: Payment and Messages -->
            <div class="space-y-6">
                {#if !paymentSuccess}
                    <!-- PayPal Button Container -->
                    <div
                        class="p-5 bg-gradient-to-r from-purple-50 to-indigo-50 rounded-xl border border-purple-200/50 shadow-sm sticky top-6"
                    >
                        <div class="flex items-center gap-2 mb-4">
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                class="h-5 w-5 text-purple-600"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                            >
                                <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    stroke-width="2"
                                    d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
                                />
                            </svg>
                            <h4 class="font-bold text-slate-800 text-lg">
                                Complete Payment
                            </h4>
                        </div>
                        <div
                            bind:this={adyenContainer}
                            class="adyen-container max-w-sm mx-auto"
                        ></div>
                    </div>

                    {#if errorMessage}
                        <div
                            class="bg-gradient-to-r from-red-50 to-rose-50 border-2 border-red-400 rounded-2xl p-6 shadow-lg"
                        >
                            <div class="flex items-center gap-3">
                                <div
                                    class="bg-red-500 text-white rounded-full p-2"
                                >
                                    <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        class="h-6 w-6"
                                        fill="none"
                                        viewBox="0 0 24 24"
                                        stroke="currentColor"
                                    >
                                        <path
                                            stroke-linecap="round"
                                            stroke-linejoin="round"
                                            stroke-width="2"
                                            d="M6 18L18 6M6 6l12 12"
                                        />
                                    </svg>
                                </div>
                                <p class="text-lg font-semibold text-red-800">
                                    {errorMessage}
                                </p>
                            </div>
                        </div>
                    {/if}
                {:else}
                    <!-- Success Message -->
                    <div
                        class="bg-gradient-to-r from-emerald-50 to-teal-50 border-2 border-emerald-400 rounded-2xl p-6 shadow-lg"
                    >
                        <div class="flex items-center gap-3 mb-4">
                            <div
                                class="bg-emerald-500 text-white rounded-full p-2"
                            >
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    class="h-6 w-6"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                >
                                    <path
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        stroke-width="2"
                                        d="M5 13l4 4L19 7"
                                    />
                                </svg>
                            </div>
                            <div>
                                <h3 class="font-bold text-xl text-emerald-800">
                                    Payment Successful!
                                </h3>
                                <p class="text-sm text-emerald-700">
                                    Thank you for your order.
                                </p>
                            </div>
                        </div>
                        <div
                            class="p-5 bg-white/80 rounded-xl shadow-inner border border-emerald-200"
                        >
                            <div class="space-y-3 text-sm">
                                <div
                                    class="flex justify-between items-center pb-2 border-b border-slate-200"
                                >
                                    <span class="font-semibold text-slate-700"
                                        >Merchant Reference:</span
                                    >
                                    <code
                                        class="bg-slate-100 px-3 py-1 rounded-lg font-mono text-xs"
                                    >
                                        {paymentResult.merchantReference}
                                    </code>
                                </div>
                                <div
                                    class="flex justify-between items-center pb-2 border-b border-slate-200"
                                >
                                    <span class="font-semibold text-slate-700"
                                        >PSP Reference:</span
                                    >
                                    <code
                                        class="bg-slate-100 px-3 py-1 rounded-lg font-mono text-xs"
                                    >
                                        {paymentResult.pspReference}
                                    </code>
                                </div>
                                <div
                                    class="flex justify-between items-center pb-2 border-b border-slate-200"
                                >
                                    <span class="font-semibold text-slate-700"
                                        >Result Code:</span
                                    >
                                    <span
                                        class="bg-emerald-100 text-emerald-700 px-3 py-1 rounded-lg font-semibold text-xs"
                                    >
                                        {paymentResult.resultCode}
                                    </span>
                                </div>

                                {#if finalShippingAddress}
                                    <div
                                        class="mt-4 pt-3 border-t-2 border-emerald-200"
                                    >
                                        <div
                                            class="flex items-center gap-2 mb-3"
                                        >
                                            <svg
                                                xmlns="http://www.w3.org/2000/svg"
                                                class="h-5 w-5 text-emerald-600"
                                                fill="none"
                                                viewBox="0 0 24 24"
                                                stroke="currentColor"
                                            >
                                                <path
                                                    stroke-linecap="round"
                                                    stroke-linejoin="round"
                                                    stroke-width="2"
                                                    d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                                                />
                                                <path
                                                    stroke-linecap="round"
                                                    stroke-linejoin="round"
                                                    stroke-width="2"
                                                    d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                                                />
                                            </svg>
                                            <strong class="text-slate-800"
                                                >Shipping Address:</strong
                                            >
                                        </div>
                                        <div
                                            class="bg-slate-50 rounded-lg p-4 text-slate-700"
                                        >
                                            <p class="font-medium">
                                                {finalShippingAddress.street ||
                                                    finalShippingAddress.line1 ||
                                                    ""}
                                                {finalShippingAddress.line2
                                                    ? `, ${finalShippingAddress.line2}`
                                                    : ""}
                                            </p>
                                            <p>
                                                {finalShippingAddress.city}, {finalShippingAddress.state}
                                            </p>
                                            <p>
                                                {finalShippingAddress.postalCode}
                                            </p>
                                            <p class="font-semibold">
                                                {finalShippingAddress.countryCode}
                                            </p>
                                        </div>
                                    </div>
                                {/if}
                            </div>
                        </div>
                        <button
                            class="mt-5 w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold py-3 px-6 rounded-xl transition-all shadow-md hover:shadow-lg"
                            onclick={() => location.reload()}
                        >
                            Place Another Order
                        </button>

                        <div class="mt-6 pt-4 border-t border-emerald-200">
                            <button
                                class="text-sm font-semibold text-purple-600 hover:text-purple-700 hover:underline mb-2 flex items-center gap-2"
                                onclick={() => (showJson = !showJson)}
                            >
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    class="h-4 w-4"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                >
                                    <path
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        stroke-width="2"
                                        d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
                                    />
                                </svg>
                                {showJson ? "Hide" : "Show"} Raw Adyen Response
                            </button>

                            {#if showJson}
                                <div
                                    class="mt-3 p-4 bg-slate-900 text-emerald-400 rounded-xl text-xs font-mono overflow-x-auto shadow-lg border border-slate-700"
                                >
                                    <pre>{JSON.stringify(
                                            paymentResult,
                                            null,
                                            2,
                                        )}</pre>
                                </div>
                            {/if}
                        </div>
                    </div>
                {/if}
            </div>
        </div>

        <!-- Info Note (Full Width Below Grid) -->
        <div
            class="mt-6 p-5 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200/50 rounded-xl"
        >
            <div class="flex items-start gap-3">
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-6 w-6 text-blue-600 flex-shrink-0 mt-0.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                >
                    <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                </svg>
                <div>
                    <p class="font-bold text-blue-900 mb-2">
                        Implementation Note
                    </p>
                    <p class="text-sm text-blue-800 mb-2">
                        This is a demonstration using Adyen's Web Components for
                        PayPal integration.
                    </p>
                    <p class="text-sm font-semibold text-blue-900 mb-1">
                        Requirements:
                    </p>
                    <ul
                        class="list-disc list-inside text-sm text-blue-700 space-y-1 ml-2"
                    >
                        <li>Valid Adyen Client Key configured</li>
                        <li>Server-side /payments endpoint implemented</li>
                        <li>
                            Server-side /payments/details endpoint implemented
                        </li>
                        <li>
                            Server-side /payments/update-order endpoint for
                            dynamic updates
                        </li>
                    </ul>
                </div>
            </div>
        </div>
    </div>

    <!-- Footer -->
    <div
        class="bg-gradient-to-r from-slate-800 to-slate-900 text-white py-8 mt-8"
    >
        <div class="container mx-auto px-8 max-w-2xl">
            <div class="text-center space-y-3">
                <div
                    class="inline-flex items-center gap-2 bg-purple-500/20 text-purple-300 px-4 py-2 rounded-full text-sm font-semibold"
                >
                    <span>⚙️</span> Test Environment - Adyen Sandbox
                </div>
                <p class="text-slate-300 text-sm">
                    Integrated payment processing via Adyen Web Components
                </p>
            </div>
            <div
                class="mt-6 p-5 bg-slate-700/50 border border-slate-600 rounded-xl text-left max-w-xl mx-auto"
            >
                <p class="font-bold text-white mb-3 flex items-center gap-2">
                    <span>🎯</span> Key Features
                </p>
                <ul
                    class="list-disc list-inside space-y-2 text-sm text-slate-300"
                >
                    <li>PayPal integration through Adyen platform</li>
                    <li>Recurring payment support (subscription)</li>
                    <li>Address prefill and lock options</li>
                    <li>Dynamic shipping address updates</li>
                    <li>Secure payment tokenization</li>
                </ul>
            </div>
        </div>
    </div>
</div>
