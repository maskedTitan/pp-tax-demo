<script>
    import { onMount } from "svelte";
    // Dynamic import of CSS and JS to avoid SSR/Build issues

    let adyenContainer;
    let errorMessage = "";
    let paymentSuccess = false;
    let paymentResult = null;

    // New Features State
    let isRecurring = false;
    let lockAddress = false;
    let useServiceAddress = true;
    let disableShipping = true;

    // UI State for collapsibles
    let showCheckoutOptions = true;
    let showServiceAddress = false;
    let showImplementationNote = false;
    let currentPaymentData = null;
    let currentPspReference = null;
    let paypalOrderId = null;
    let paypalComponent = null;
    let adyenCheckout = null;
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
    let showJson = false;

    // Placeholder configuration - in a real app these come from backend
    const clientKey = import.meta.env.VITE_ADYEN_CLIENT_KEY;
    const environment = "test";

    async function createPayPalComponent(checkout, PayPal) {
        // Unmount existing component if any
        if (paypalComponent) {
            try {
                paypalComponent.unmount();
            } catch (e) {
                console.log("Error unmounting component:", e);
            }
        }

        // Create PayPal component configuration
        const paypalConfig = {
            environment,
            showPayButton: true,
            countryCode: "US", // Required for PayPal
            amount: {
                value: 100, // $1.00
                currency: "USD",
            },
            blockPayPalCreditButton: true,
            blockPayPalPayLaterButton: false,

            // Custom Button Styling
            style: {
                color: "black",
                height: 48,
            },
        };

        // Configure shipping based on disableShipping state
        if (disableShipping) {
            // Disable shipping address collection
            paypalConfig.isExpress = false;
            paypalConfig.shippingAddressRequired = false;
            paypalConfig.shippingAddressEditable = false;
        } else {
            // Enable shipping address collection
            paypalConfig.isExpress = true;
            paypalConfig.shippingAddressRequired = true;
            paypalConfig.shippingAddressEditable = true;

            // Add shipping address change handler when shipping is enabled
            paypalConfig.onShippingAddressChange = async (data, actions) => {
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
            };

            paypalConfig.onShippingOptionsChange = (data) => {
                console.log("Adyen: User changed shipping option", data);
                return Promise.resolve();
            };
        }

        paypalConfig.onSubmit = async (state, component) => {
            console.log(
                "PayPal Submit (Full State Data):",
                JSON.stringify(state.data, null, 2),
            );
            console.log(
                "Full Payment Method Object:",
                JSON.stringify(state.data.paymentMethod, null, 2),
            );
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
                const isPayPalType =
                    state.data?.paymentMethod?.type === "paypal";

                const payload = {
                    data: state.data,
                    recurring: isRecurring,
                    disableShipping: disableShipping,
                    lockAddress: lockAddress && useServiceAddress, // Only lock if we are sending an address
                };

                if (useServiceAddress) {
                    payload.shopperName = {
                        firstName: serviceAddress.firstName,
                        lastName: serviceAddress.lastName,
                    };
                    payload.deliveryAddress = {
                        street: serviceAddress.street,
                        houseNumberOrName: serviceAddress.houseNumberOrName,
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
        };

        paypalConfig.onAdditionalDetails = async (state, component) => {
            console.log("PayPal Additional Details:", state.data);
            component.setStatus("loading");

            try {
                // Merge state.data with currentPaymentData to ensure we send the latest signature
                const detailsRequest = { ...state.data };
                if (currentPaymentData) {
                    detailsRequest.paymentData = currentPaymentData;
                }

                const response = await fetch("/api/adyen/payments/details", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ data: detailsRequest }),
                });

                const result = await response.json();
                console.log("Final Adyen Result:", result);

                if (!response.ok) {
                    throw new Error(result.error || "Payment details failed");
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
                                ppOrder.purchase_units?.[0]?.shipping?.address
                            ) {
                                const ppAddress =
                                    ppOrder.purchase_units[0].shipping.address;
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
        };

        paypalConfig.onCancel = (data, component) => {
            console.log("PayPal Cancelled:", data);
        };

        paypalConfig.onError = (error, component) => {
            console.error("PayPal Error:", error);
        };

        // Create PayPal component with the configuration
        paypalComponent = new PayPal(checkout, paypalConfig);

        if (adyenContainer) {
            paypalComponent.mount(adyenContainer);
        }
    }

    // Reactive statement to recreate PayPal component when disableShipping changes
    // Skip on initial mount to avoid double creation
    $: if (
        adyenCheckout &&
        adyenContainer &&
        !paymentSuccess &&
        !isInitialMount
    ) {
        console.log(
            "Recreating PayPal component with disableShipping:",
            disableShipping,
        );
        (async () => {
            const module = await import("@adyen/adyen-web");
            const PayPal = module.PayPal;
            await createPayPalComponent(adyenCheckout, PayPal);
        })();
    }

    // Watch disableShipping to trigger the reactive statement above
    $: disableShipping, void 0;

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
            adyenCheckout = await AdyenCheckout(configuration);
            console.log("Checkout initialized");

            // Initial component creation
            await createPayPalComponent(adyenCheckout, PayPal);

            // Mark initial mount as complete
            isInitialMount = false;
        } catch (error) {
            console.error("Failed to initialize Adyen:", error);
            errorMessage =
                "Failed to initialize Adyen checkout. Check console for details.";
        }
    });
</script>

<div class="min-h-screen bg-gray-50">
    <div class="container mx-auto px-8 max-w-7xl py-8">
        <!-- Two Column Layout -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <!-- Left Column: Forms and Options -->
            <div class="space-y-6">
                {#if !paymentSuccess}
                    <!-- Collapsible Checkout Options -->
                    <div
                        class="bg-white rounded-lg border border-gray-200 overflow-hidden"
                    >
                        <button
                            onclick={() =>
                                (showCheckoutOptions = !showCheckoutOptions)}
                            class="w-full p-4 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
                        >
                            <div class="flex items-center gap-3">
                                <div class="text-blue-600">
                                    <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        class="h-5 w-5"
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
                                </div>
                                <h3 class="font-bold text-gray-900 text-sm">
                                    Checkout Options
                                </h3>
                            </div>
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                class="h-5 w-5 text-gray-400 transition-transform {showCheckoutOptions
                                    ? 'rotate-180'
                                    : ''}"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                            >
                                <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    stroke-width="2"
                                    d="M19 9l-7 7-7-7"
                                />
                            </svg>
                        </button>

                        {#if showCheckoutOptions}
                            <div
                                class="px-4 pb-4 border-t border-gray-100 pt-2 space-y-2"
                            >
                                <label
                                    class="flex items-center p-2 rounded hover:bg-gray-50 cursor-pointer"
                                >
                                    <input
                                        type="checkbox"
                                        bind:checked={disableShipping}
                                        class="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 border-gray-300"
                                    />
                                    <div class="ml-3">
                                        <span
                                            class="block text-sm font-medium text-gray-900"
                                            >Disable Shipping Address</span
                                        >
                                        <p class="text-xs text-gray-500">
                                            Hide address in checkout
                                        </p>
                                    </div>
                                </label>

                                <label
                                    class="flex items-center p-2 rounded hover:bg-gray-50 cursor-pointer"
                                >
                                    <input
                                        type="checkbox"
                                        bind:checked={isRecurring}
                                        class="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 border-gray-300"
                                    />
                                    <div class="ml-3">
                                        <span
                                            class="block text-sm font-medium text-gray-900"
                                            >Subscribe (Recurring)</span
                                        >
                                        <p class="text-xs text-gray-500">
                                            Save payment for future
                                        </p>
                                    </div>
                                </label>

                                <label
                                    class="flex items-center p-2 rounded hover:bg-gray-50 cursor-pointer"
                                >
                                    <input
                                        type="checkbox"
                                        bind:checked={useServiceAddress}
                                        class="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 border-gray-300"
                                    />
                                    <div class="ml-3">
                                        <span
                                            class="block text-sm font-medium text-gray-900"
                                            >Include Service Address</span
                                        >
                                        <p class="text-xs text-gray-500">
                                            Prefill address in PayPal
                                        </p>
                                    </div>
                                </label>

                                {#if useServiceAddress}
                                    <label
                                        class="flex items-center p-2 rounded hover:bg-gray-50 cursor-pointer pl-6"
                                    >
                                        <input
                                            type="checkbox"
                                            bind:checked={lockAddress}
                                            class="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 border-gray-300"
                                        />
                                        <div class="ml-3">
                                            <span
                                                class="block text-sm font-medium text-gray-900"
                                                >Lock Address</span
                                            >
                                            <p class="text-xs text-gray-500">
                                                Prevent editing in popup
                                            </p>
                                        </div>
                                    </label>
                                {/if}
                            </div>
                        {/if}
                    </div>

                    {#if useServiceAddress}
                        <!-- Collapsible Service Address Form -->
                        <div
                            class="bg-white rounded-lg border border-gray-200 overflow-hidden"
                        >
                            <button
                                onclick={() =>
                                    (showServiceAddress = !showServiceAddress)}
                                class="w-full p-4 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
                            >
                                <div class="flex items-center gap-3">
                                    <div class="text-orange-600">
                                        <svg
                                            xmlns="http://www.w3.org/2000/svg"
                                            class="h-5 w-5"
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
                                    </div>
                                    <h4 class="font-bold text-gray-900 text-sm">
                                        Service Address
                                    </h4>
                                </div>
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    class="h-5 w-5 text-gray-400 transition-transform {showServiceAddress
                                        ? 'rotate-180'
                                        : ''}"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                >
                                    <path
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        stroke-width="2"
                                        d="M19 9l-7 7-7-7"
                                    />
                                </svg>
                            </button>

                            {#if showServiceAddress}
                                <div
                                    class="px-4 pb-4 border-t border-gray-100 pt-3"
                                >
                                    <div class="grid grid-cols-1 gap-3">
                                        <div class="grid grid-cols-2 gap-3">
                                            <div>
                                                <label
                                                    for="firstName"
                                                    class="block text-xs font-semibold text-gray-700 mb-1"
                                                    >First Name</label
                                                >
                                                <input
                                                    id="firstName"
                                                    class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                                                    type="text"
                                                    bind:value={
                                                        serviceAddress.firstName
                                                    }
                                                />
                                            </div>
                                            <div>
                                                <label
                                                    for="lastName"
                                                    class="block text-xs font-semibold text-gray-700 mb-1"
                                                    >Last Name</label
                                                >
                                                <input
                                                    id="lastName"
                                                    class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                                                    type="text"
                                                    bind:value={
                                                        serviceAddress.lastName
                                                    }
                                                />
                                            </div>
                                        </div>
                                        <div class="grid grid-cols-4 gap-3">
                                            <div>
                                                <label
                                                    for="houseNumber"
                                                    class="block text-xs font-semibold text-gray-700 mb-1"
                                                    >Number</label
                                                >
                                                <input
                                                    id="houseNumber"
                                                    class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                                                    type="text"
                                                    bind:value={
                                                        serviceAddress.houseNumberOrName
                                                    }
                                                />
                                            </div>
                                            <div class="col-span-3">
                                                <label
                                                    for="street"
                                                    class="block text-xs font-semibold text-gray-700 mb-1"
                                                    >Street</label
                                                >
                                                <input
                                                    id="street"
                                                    class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                                                    type="text"
                                                    bind:value={
                                                        serviceAddress.street
                                                    }
                                                />
                                            </div>
                                        </div>
                                        <div class="grid grid-cols-2 gap-3">
                                            <div>
                                                <label
                                                    for="city"
                                                    class="block text-xs font-semibold text-gray-700 mb-1"
                                                    >City</label
                                                >
                                                <input
                                                    id="city"
                                                    class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                                                    type="text"
                                                    bind:value={
                                                        serviceAddress.city
                                                    }
                                                />
                                            </div>
                                            <div>
                                                <label
                                                    for="postalCode"
                                                    class="block text-xs font-semibold text-gray-700 mb-1"
                                                    >Postal Code</label
                                                >
                                                <input
                                                    id="postalCode"
                                                    class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                                                    type="text"
                                                    bind:value={
                                                        serviceAddress.postalCode
                                                    }
                                                />
                                            </div>
                                        </div>
                                        <div class="grid grid-cols-2 gap-3">
                                            <div>
                                                <label
                                                    for="state"
                                                    class="block text-xs font-semibold text-gray-700 mb-1"
                                                    >State</label
                                                >
                                                <input
                                                    id="state"
                                                    class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm uppercase"
                                                    type="text"
                                                    bind:value={
                                                        serviceAddress.stateOrProvince
                                                    }
                                                    maxlength="2"
                                                />
                                            </div>
                                            <div>
                                                <label
                                                    for="country"
                                                    class="block text-xs font-semibold text-gray-700 mb-1"
                                                    >Country</label
                                                >
                                                <input
                                                    id="country"
                                                    class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm uppercase"
                                                    type="text"
                                                    bind:value={
                                                        serviceAddress.country
                                                    }
                                                    maxlength="2"
                                                />
                                            </div>
                                        </div>
                                        <p
                                            class="text-xs text-gray-500 bg-gray-50 p-2 rounded"
                                        >
                                            ℹ️ This address will be prefilled in
                                            PayPal checkout.
                                        </p>
                                    </div>
                                </div>
                            {/if}
                        </div>
                    {/if}
                {/if}
            </div>

            <!-- Right Column: Payment and Messages -->
            <div class="space-y-6">
                {#if !paymentSuccess}
                    <!-- PayPal Button Container -->
                    <div
                        class="p-5 bg-white rounded-lg border border-gray-200 sticky top-6"
                    >
                        <div class="flex items-center gap-2 mb-4">
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                class="h-5 w-5 text-blue-600"
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
                            <h4 class="font-bold text-gray-900 text-lg">
                                Complete Payment
                            </h4>
                        </div>
                        <div
                            bind:this={adyenContainer}
                            class="adyen-container w-64 mx-auto"
                        ></div>
                    </div>

                    {#if errorMessage}
                        <div
                            class="bg-red-50 border border-red-200 rounded-lg p-6"
                        >
                            <div class="flex items-center gap-3">
                                <div class="text-red-500">
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
                        class="bg-green-50 border border-green-200 rounded-lg p-6"
                    >
                        <div class="flex items-center gap-3 mb-4">
                            <div class="text-green-600">
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
                                <h3 class="font-bold text-xl text-green-900">
                                    Payment Successful!
                                </h3>
                                <p class="text-sm text-green-800">
                                    Thank you for your order.
                                </p>
                            </div>
                        </div>
                        <div
                            class="p-5 bg-white rounded-lg border border-gray-200"
                        >
                            <div class="space-y-3 text-sm">
                                <div
                                    class="flex justify-between items-center pb-2 border-b border-gray-100"
                                >
                                    <span class="font-semibold text-gray-700"
                                        >Merchant Reference:</span
                                    >
                                    <code
                                        class="bg-gray-100 px-3 py-1 rounded font-mono text-xs"
                                    >
                                        {paymentResult.merchantReference}
                                    </code>
                                </div>
                                <div
                                    class="flex justify-between items-center pb-2 border-b border-gray-100"
                                >
                                    <span class="font-semibold text-gray-700"
                                        >PSP Reference:</span
                                    >
                                    <code
                                        class="bg-gray-100 px-3 py-1 rounded font-mono text-xs"
                                    >
                                        {paymentResult.pspReference}
                                    </code>
                                </div>
                                <div
                                    class="flex justify-between items-center pb-2 border-b border-gray-100"
                                >
                                    <span class="font-semibold text-gray-700"
                                        >Result Code:</span
                                    >
                                    <span
                                        class="bg-green-100 text-green-800 px-3 py-1 rounded font-semibold text-xs"
                                    >
                                        {paymentResult.resultCode}
                                    </span>
                                </div>

                                {#if finalShippingAddress}
                                    <div
                                        class="mt-4 pt-3 border-t border-gray-200"
                                    >
                                        <div
                                            class="flex items-center gap-2 mb-3"
                                        >
                                            <svg
                                                xmlns="http://www.w3.org/2000/svg"
                                                class="h-5 w-5 text-green-600"
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
                                            <strong class="text-gray-900"
                                                >Shipping Address:</strong
                                            >
                                        </div>
                                        <div
                                            class="bg-gray-50 rounded p-4 text-gray-700"
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
                            class="mt-5 w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded transition-all"
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

        <!-- Collapsible Info Note -->
        <div
            class="mt-6 bg-white border border-gray-200 rounded-lg overflow-hidden"
        >
            <button
                onclick={() =>
                    (showImplementationNote = !showImplementationNote)}
                class="w-full p-4 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
            >
                <div class="flex items-center gap-3">
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        class="h-6 w-6 text-blue-600"
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
                    <p class="font-bold text-gray-900">Implementation Note</p>
                </div>
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-5 w-5 text-gray-400 transition-transform {showImplementationNote
                        ? 'rotate-180'
                        : ''}"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                >
                    <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M19 9l-7 7-7-7"
                    />
                </svg>
            </button>

            {#if showImplementationNote}
                <div class="px-5 pb-5 pt-0">
                    <div class="ml-9">
                        <p class="text-sm text-gray-700 mb-2">
                            This is a demonstration using Adyen's Web Components
                            for PayPal integration.
                        </p>
                        <p class="text-sm font-semibold text-gray-900 mb-1">
                            Requirements:
                        </p>
                        <ul
                            class="list-disc list-inside text-sm text-gray-600 space-y-1 ml-2"
                        >
                            <li>Valid Adyen Client Key configured</li>
                            <li>Server-side /payments endpoint implemented</li>
                            <li>
                                Server-side /payments/details endpoint
                                implemented
                            </li>
                            <li>
                                Server-side /payments/update-order endpoint for
                                dynamic updates
                            </li>
                        </ul>
                    </div>
                </div>
            {/if}
        </div>
    </div>

    <!-- Footer -->
    <div class="bg-white border-t border-gray-200 py-4 mt-8">
        <div class="container mx-auto px-8 max-w-2xl">
            <div class="text-center">
                <div
                    class="inline-flex items-center gap-2 bg-purple-100 text-purple-800 px-3 py-1 rounded-full text-xs font-semibold"
                >
                    <span>⚙️</span> Adyen Sandbox
                </div>
            </div>
        </div>
    </div>
</div>
