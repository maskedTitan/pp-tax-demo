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
    let currentPaymentData = null;
    let currentPspReference = null;
    let paypalOrderId = null;
    let shippingAddress = {
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
                    if (!finalShippingAddress) {
                        finalShippingAddress = {
                            street: `${shippingAddress.houseNumberOrName} ${shippingAddress.street}`,
                            city: shippingAddress.city,
                            state: shippingAddress.stateOrProvince,
                            postalCode: shippingAddress.postalCode,
                            countryCode: shippingAddress.country,
                        };
                    }

                    try {
                        const payload = {
                            data: state.data,
                            recurring: isRecurring,
                            lockAddress: lockAddress, // Pass preference to backend
                            shopperName: {
                                firstName: shippingAddress.firstName,
                                lastName: shippingAddress.lastName,
                            },
                            deliveryAddress: {
                                street: shippingAddress.street,
                                houseNumberOrName:
                                    shippingAddress.houseNumberOrName,
                                city: shippingAddress.city,
                                stateOrProvince:
                                    shippingAddress.stateOrProvince,
                                postalCode: shippingAddress.postalCode,
                                country: shippingAddress.country,
                            },
                        };

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
                            // Store pspReference if available (needed for updates)
                            if (result.pspReference) {
                                currentPspReference = result.pspReference;
                            }
                            component.handleAction(result.action);
                        } else {
                            // Show success/result
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
                            // Update final address from the authoritative result
                            console.log(
                                "[DEBUG] Address State BEFORE Adyen Result Check:",
                                finalShippingAddress,
                            );
                            if (result.deliveryAddress) {
                                console.log(
                                    "[DEBUG] Overwriting with result.deliveryAddress:",
                                    result.deliveryAddress,
                                );
                                finalShippingAddress = result.deliveryAddress;
                            } else if (
                                result.additionalData &&
                                result.additionalData.deliveryAddress
                            ) {
                                // ... existing logic ...
                                console.log(
                                    "[DEBUG] Overwriting with additionalData.deliveryAddress",
                                );
                                // ...
                            }
                            console.log(
                                "[DEBUG] Address State AFTER Adyen Result Check:",
                                finalShippingAddress,
                            );

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

                                        // Compare with current finalShippingAddress?
                                        // For now, let's just log and see if this IS the overwrite culprit

                                        // Update display with high-fidelity address
                                        finalShippingAddress = {
                                            street: ppAddress.address_line_1,
                                            // Combine line 2 if present
                                            line2: ppAddress.address_line_2,
                                            city: ppAddress.admin_area_2,
                                            state: ppAddress.admin_area_1,
                                            postalCode: ppAddress.postal_code,
                                            countryCode: ppAddress.country_code,
                                        };
                                        console.log(
                                            "[DEBUG] Address State AFTER Fetch Update:",
                                            finalShippingAddress,
                                        );
                                    }
                                } catch (err) {
                                    console.error(
                                        "Failed to fetch full PayPal address:",
                                        err,
                                    );
                                    // Fallback to whatever Adyen gave us (already in finalShippingAddress) is fine
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

<div class="container mx-auto p-8 max-w-2xl">
    <h1 class="text-4xl font-bold mb-6 text-center">Adyen PayPal Demo</h1>

    <div class="bg-white shadow-lg rounded-lg p-6 mb-4">
        <h2 class="text-2xl font-semibold mb-4">Checkout with Adyen</h2>

        {#if errorMessage}
            <div
                class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4"
            >
                {errorMessage}
            </div>
        {/if}

        {#if paymentSuccess}
            <div
                class="bg-green-100 border border-green-400 text-green-700 px-4 py-6 rounded mb-4 max-w-full overflow-hidden"
            >
                <h3 class="font-bold text-lg mb-2">Payment Successful!</h3>
                <p>Thank you for your order.</p>
                <div
                    class="mt-4 p-4 bg-white rounded shadow-inner text-sm font-mono text-gray-800 break-words"
                >
                    <p>
                        <strong>Merchant Reference:</strong>
                        {paymentResult.merchantReference}
                    </p>
                    <p>
                        <strong>PSP Reference:</strong>
                        {paymentResult.pspReference}
                    </p>
                    <p>
                        <strong>Result Code:</strong>
                        {paymentResult.resultCode}
                    </p>

                    {#if finalShippingAddress}
                        <div class="mt-4 border-t pt-2">
                            <strong>Shipping Address:</strong>
                            <div class="text-xs text-gray-600 mt-1">
                                <p></p>
                                <p>
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
                                <p>{finalShippingAddress.postalCode}</p>
                                <p>{finalShippingAddress.countryCode}</p>
                            </div>
                        </div>
                    {/if}
                </div>
                <button
                    class="mt-4 bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded"
                    onclick={() => location.reload()}
                >
                    Place Another Order
                </button>

                <div class="mt-6 border-t border-gray-200 pt-4">
                    <button
                        class="text-sm text-blue-600 hover:underline mb-2"
                        onclick={() => (showJson = !showJson)}
                    >
                        {showJson ? "Hide" : "Show"} Raw Adyen Response
                    </button>

                    {#if showJson}
                        <div
                            class="mt-2 p-3 bg-gray-900 text-green-400 rounded-md text-xs font-mono overflow-x-auto shadow-inner"
                        >
                            <pre>{JSON.stringify(paymentResult, null, 2)}</pre>
                        </div>
                    {/if}
                </div>
            </div>
        {:else}
            <div class="mb-6 bg-gray-50 p-4 rounded-lg border border-gray-200">
                <h3 class="font-bold text-gray-700 mb-2">Checkout Options</h3>

                <!-- Recurring Checkbox -->
                <div class="mb-4 flex flex-col space-y-2">
                    <div class="flex items-center">
                        <input
                            type="checkbox"
                            id="recurring"
                            bind:checked={isRecurring}
                            class="w-5 h-5 text-blue-600 rounded focus:ring-blue-500 border-gray-300"
                        />
                        <label
                            for="recurring"
                            class="ml-2 text-gray-700 font-medium"
                        >
                            Subscribe (Recurring Payment)
                        </label>
                    </div>

                    <!-- Lock Address Checkbox -->
                    <div class="flex items-center">
                        <input
                            type="checkbox"
                            id="lockAddress"
                            bind:checked={lockAddress}
                            class="w-5 h-5 text-blue-600 rounded focus:ring-blue-500 border-gray-300"
                        />
                        <label
                            for="lockAddress"
                            class="ml-2 text-gray-700 font-medium"
                        >
                            Lock Address in PayPal (Pre-fill)
                        </label>
                    </div>
                    <p class="text-xs text-gray-500 ml-7">
                        Uncheck to allow editing address in PayPal popup.
                    </p>
                </div>

                <hr class="my-4 border-gray-300" />

                <!-- Shipping Address Form -->
                <h4 class="font-semibold text-gray-700 mb-2">
                    Shipping Address
                </h4>
                <div class="grid grid-cols-1 gap-4">
                    <div class="grid grid-cols-2 gap-4">
                        <input
                            class="p-2 border rounded w-full"
                            type="text"
                            placeholder="First Name"
                            bind:value={shippingAddress.firstName}
                        />
                        <input
                            class="p-2 border rounded w-full"
                            type="text"
                            placeholder="Last Name"
                            bind:value={shippingAddress.lastName}
                        />
                    </div>
                    <div class="grid grid-cols-4 gap-4">
                        <input
                            class="p-2 border rounded col-span-1"
                            type="text"
                            placeholder="Number"
                            bind:value={shippingAddress.houseNumberOrName}
                        />
                        <input
                            class="p-2 border rounded col-span-3"
                            type="text"
                            placeholder="Street Name"
                            bind:value={shippingAddress.street}
                        />
                    </div>
                    <div class="grid grid-cols-2 gap-4">
                        <input
                            class="p-2 border rounded w-full"
                            type="text"
                            placeholder="City"
                            bind:value={shippingAddress.city}
                        />
                        <input
                            class="p-2 border rounded w-full"
                            type="text"
                            placeholder="Postal Code"
                            bind:value={shippingAddress.postalCode}
                        />
                    </div>
                    <div class="grid grid-cols-2 gap-4">
                        <input
                            class="p-2 border rounded w-full"
                            type="text"
                            placeholder="State / Province"
                            bind:value={shippingAddress.stateOrProvince}
                        />
                        <input
                            class="p-2 border rounded w-full"
                            type="text"
                            placeholder="Country (e.g. US)"
                            bind:value={shippingAddress.country}
                        />
                    </div>
                </div>
            </div>
            <div
                bind:this={adyenContainer}
                class="adyen-container max-w-sm mx-auto"
            ></div>
        {/if}

        <div
            class="mt-6 p-4 bg-gray-50 border border-gray-200 rounded text-sm text-gray-600"
        >
            <p class="font-semibold mb-2">Note:</p>
            <p>This is a demonstration using Adyen's Web Components.</p>
            <p>To make this fully functional, you need to:</p>
            <ul class="list-disc list-inside mt-1 ml-2">
                <li>Provide a valid Adyen Client Key</li>
                <li>Implement the /paymentMethods call on the server</li>
                <li>Implement the /payments call on the server</li>
            </ul>
        </div>
    </div>
</div>
