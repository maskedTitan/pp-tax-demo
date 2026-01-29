<script>
	import { onMount } from "svelte";
	import { loadScript } from "@paypal/paypal-js";
	import {
		PUBLIC_PAYPAL_CLIENT_ID,
		PUBLIC_PAYPAL_PROD_CLIENT_ID,
	} from "$env/static/public";
	import { calculateTax, calculateTotal, getTaxRate } from "$lib/taxRates.js";

	let paypalButtonsContainer;
	let errorMessage = "";
	let successMessage = "";
	let vaultId = "";
	let payerEmail = "";
	let isProduction = false;
	let paypal; // Store paypal instance

	// Product details
	const PRODUCT_SUBTOTAL = "1.00";

	// Shipping address with prefilled values
	let shippingAddress = {
		name: "John Doe",
		address_line_1: "123 Main Street",
		address_line_2: "Apt 4B",
		admin_area_2: "San Francisco",
		admin_area_1: "CA",
		postal_code: "94102",
		country_code: "US",
	};

	let shippingPreference = "SET_PROVIDED_ADDRESS";
	let requestVaulting = false;
	let disableShipping = false;
	let zeroDollarAuth = false;

	// Collapsible section states
	let showTaxDemo = false;
	let showShippingPreference = false;
	let showShippingAddress = false;

	// Charge vaulted payment state
	let chargeAmount = "5.00";
	let chargeLoading = false;
	let chargeResult = null;

	async function chargeVaultedPayment() {
		if (!vaultId) {
			errorMessage = "No vaulted payment method available";
			return;
		}

		chargeLoading = true;
		chargeResult = null;

		try {
			const response = await fetch("/api/paypal/charge-vault", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					vaultId: vaultId,
					amount: chargeAmount,
					currencyCode: "USD",
					description: "Charge from saved payment method",
					isProduction,
				}),
			});

			const data = await response.json();

			if (!response.ok) {
				throw new Error(data.error || "Failed to charge");
			}

			chargeResult = {
				success: true,
				orderId: data.id,
				status: data.status,
				captureId: data.capture?.id,
				amount: data.capture?.amount?.value,
			};
		} catch (error) {
			console.error("Error charging vault:", error);
			chargeResult = {
				success: false,
				error: error.message,
			};
		} finally {
			chargeLoading = false;
		}
	}

	// Calculate tax and total based on current shipping address
	$: currentTax = calculateTax(
		PRODUCT_SUBTOTAL,
		shippingAddress.admin_area_1,
	);
	$: currentTotal = calculateTotal(
		PRODUCT_SUBTOTAL,
		shippingAddress.admin_area_1,
	);
	$: currentTaxRate = getTaxRate(shippingAddress.admin_area_1);

	async function initializePayPal() {
		try {
			// Clear existing buttons if any
			if (paypalButtonsContainer) {
				paypalButtonsContainer.innerHTML = "";
			}
			errorMessage = "";
			successMessage = "";

			const clientId = isProduction
				? PUBLIC_PAYPAL_PROD_CLIENT_ID
				: PUBLIC_PAYPAL_CLIENT_ID;

			if (
				isProduction &&
				(!clientId || clientId === "YOUR_PRODUCTION_CLIENT_ID_HERE")
			) {
				errorMessage =
					"Production PayPal credentials not configured. Please set PUBLIC_PAYPAL_PROD_CLIENT_ID in your environment variables.";
				return;
			}

			// Reload script with new client ID
			paypal = await loadScript({
				clientId: clientId,
				currency: "USD",
				enableFunding: "venmo",
				"data-namespace":
					"paypal_sdk_" + (isProduction ? "prod" : "sandbox"),
			});

			if (paypal && paypal.Buttons) {
				let buttonConfig = {};

				if (zeroDollarAuth) {
					// Vault-only flow: Use createVaultSetupToken instead of createOrder
					buttonConfig = {
						createVaultSetupToken: async () => {
							try {
								const response = await fetch(
									"/api/paypal/create-setup-token",
									{
										method: "POST",
										headers: {
											"Content-Type": "application/json",
										},
										body: JSON.stringify({
											brand_name: "PayPal Demo Store",
											shipping_preference: disableShipping
												? "NO_SHIPPING"
												: "GET_FROM_FILE",
											isProduction,
										}),
									},
								);

								const setupToken = await response.json();

								if (!response.ok) {
									throw new Error(
										setupToken.error ||
											"Failed to create setup token",
									);
								}

								return setupToken.id;
							} catch (error) {
								console.error(
									"Error creating setup token:",
									error,
								);
								errorMessage =
									"Failed to create setup token. Please try again.";
								throw error;
							}
						},
						onApprove: async (data) => {
							try {
								// Exchange setup token for payment token
								const response = await fetch(
									"/api/paypal/create-payment-token",
									{
										method: "POST",
										headers: {
											"Content-Type": "application/json",
										},
										body: JSON.stringify({
											vaultSetupToken:
												data.vaultSetupToken,
											isProduction,
										}),
									},
								);

								const tokenData = await response.json();

								if (!response.ok) {
									throw new Error(
										tokenData.error ||
											"Failed to create payment token",
									);
								}

								console.log("Vault successful:", tokenData);

								// Store vault ID
								vaultId = tokenData.id || "";
								payerEmail =
									tokenData.payment_source?.paypal
										?.email_address || "";

								successMessage = `Payment method saved! Vault ID: ${vaultId}`;
								errorMessage = "";
							} catch (error) {
								console.error(
									"Error creating payment token:",
									error,
								);
								errorMessage =
									"Failed to save payment method. Please try again.";
								successMessage = "";
							}
						},
						onError: (err) => {
							console.error("PayPal error:", err);
							errorMessage =
								"An error occurred. Please try again.";
							successMessage = "";
						},
					};
				} else {
					// Regular order flow
					buttonConfig = {
						createOrder: async (data, actions) => {
							try {
								const response = await fetch(
									"/api/paypal/create-order",
									{
										method: "POST",
										headers: {
											"Content-Type": "application/json",
										},
										body: JSON.stringify({
											amount: PRODUCT_SUBTOTAL,
											currency_code: "USD",
											description: "Sample Product",
											brand_name: "PayPal Demo Store",
											shipping_address: shippingAddress,
											shipping_preference: disableShipping
												? "NO_SHIPPING"
												: shippingPreference,
											initial_state:
												shippingAddress.admin_area_1,
											isProduction,
											requestVaulting,
											paymentSource: data.paymentSource,
										}),
									},
								);

								const order = await response.json();

								if (!response.ok) {
									throw new Error(
										order.error || "Failed to create order",
									);
								}

								return order.id;
							} catch (error) {
								console.error("Error creating order:", error);
								errorMessage =
									"Failed to create order. Please try again.";
								throw error;
							}
						},
						onApprove: async (data) => {
							try {
								const response = await fetch(
									"/api/paypal/capture-order",
									{
										method: "POST",
										headers: {
											"Content-Type": "application/json",
										},
										body: JSON.stringify({
											orderId: data.orderID,
											isProduction,
										}),
									},
								);

								const captureData = await response.json();

								if (!response.ok) {
									throw new Error(
										captureData.error ||
											"Failed to capture order",
									);
								}

								console.log("Capture successful:", captureData);

								vaultId = captureData.vault_id || "";
								payerEmail =
									captureData.payer?.email_address || "";

								let message = `Transaction completed! Order ID: ${captureData.id}`;
								if (vaultId) {
									message += ` | Payment method vaulted for future use!`;
								}

								successMessage = message;
								errorMessage = "";
							} catch (error) {
								console.error("Error capturing order:", error);
								errorMessage =
									"Payment failed. Please try again.";
								successMessage = "";
							}
						},
						onError: (err) => {
							console.error("PayPal error:", err);
							errorMessage =
								"An error occurred during the transaction. Please try again.";
							successMessage = "";
						},
					};

					// Only add shipping address change handler for regular flow
					if (!disableShipping) {
						buttonConfig.onShippingAddressChange = (
							data,
							actions,
						) => {
							const stateCode = data.shippingAddress?.state;
							const countryCode =
								data.shippingAddress?.countryCode;

							if (countryCode && countryCode !== "US") {
								return actions.reject(
									data.errors.COUNTRY_ERROR,
								);
							}

							if (!stateCode) {
								return Promise.resolve();
							}

							return fetch("/api/paypal/update-order", {
								method: "POST",
								headers: {
									"Content-Type": "application/json",
								},
								body: JSON.stringify({
									orderId: data.orderID,
									subtotal: PRODUCT_SUBTOTAL,
									stateCode: stateCode,
									isProduction,
								}),
							})
								.then((response) => response.json())
								.then((updateData) => {
									console.log(
										"Order updated with tax:",
										updateData,
									);
									return Promise.resolve();
								})
								.catch((error) => {
									console.error(
										"Error in onShippingAddressChange:",
										error,
									);
									return actions.reject();
								});
						};
					}
				}

				await paypal
					.Buttons(buttonConfig)
					.render(paypalButtonsContainer);
			}
		} catch (error) {
			console.error("Failed to load PayPal SDK:", error);
			errorMessage =
				"Failed to load PayPal. Please check your configuration.";
		}
	}

	function toggleEnvironment() {
		isProduction = !isProduction;
		initializePayPal();
	}

	onMount(() => {
		initializePayPal();
	});
</script>

<div class="min-h-screen bg-gray-50">
	<div class="container mx-auto px-4 sm:px-8 max-w-7xl py-4 sm:py-6">
		<!-- Two Column Layout -->
		<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
			<!-- Left Column: Forms and Details -->
			<div class="space-y-4">
				<!-- Environment Toggle -->
				<div
					class="bg-white rounded-md p-3 border border-gray-200 flex justify-between items-center"
				>
					<div class="flex items-center gap-2">
						<span class="text-sm font-semibold text-gray-700"
							>Environment:</span
						>
						<span
							class={`px-2 py-1 rounded text-xs font-bold ${isProduction ? "bg-blue-100 text-blue-700" : "bg-yellow-100 text-yellow-800"}`}
						>
							{isProduction ? "PRODUCTION" : "SANDBOX"}
						</span>
					</div>
					<button
						on:click={toggleEnvironment}
						class={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${isProduction ? "bg-blue-600" : "bg-gray-200"}`}
					>
						<span class="sr-only">Toggle Environment</span>
						<span
							class={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isProduction ? "translate-x-6" : "translate-x-1"}`}
						></span>
					</button>
				</div>

				<!-- Product Card -->
				<!-- Product Card -->
				<div class="bg-white rounded-lg border border-gray-200 p-4">
					<div class="flex items-center gap-3 mb-4">
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
									d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"
								/>
							</svg>
						</div>
						<h2 class="text-lg font-bold text-gray-900">
							Product Details
						</h2>
					</div>
					<div
						class="p-4 bg-gray-50 rounded-md border border-gray-100"
					>
						<p class="text-gray-700">
							<span class="font-semibold text-gray-900"
								>{zeroDollarAuth
									? "Payment Method Setup"
									: "Sample Product"}</span
							>
							{#if zeroDollarAuth}
								<span
									class="ml-2 px-2 py-0.5 bg-gray-200 text-gray-700 text-xs font-medium rounded-full"
									>$0 VAULT</span
								>
							{/if}
						</p>
						{#if zeroDollarAuth}
							<div class="text-gray-600 space-y-1 mt-2 text-sm">
								<div
									class="flex justify-between items-center py-2"
								>
									<span class="font-medium text-gray-900"
										>Amount</span
									>
									<span
										class="text-lg font-bold text-gray-900"
										>$0.00 USD</span
									>
								</div>
								<p class="text-xs text-gray-500 mt-1">
									No charge - payment method will be saved for
									future use
								</p>
							</div>
						{:else}
							<div class="text-gray-600 space-y-1 mt-2 text-sm">
								<div
									class="flex justify-between items-center py-1 border-b border-gray-200"
								>
									<span class="text-gray-600">Subtotal</span>
									<span class="font-medium"
										>${PRODUCT_SUBTOTAL} USD</span
									>
								</div>
								<div
									class="flex justify-between items-center py-1 border-b border-gray-200"
								>
									<span class="text-gray-600"
										>Tax ({currentTaxRate}% - {shippingAddress.admin_area_1})</span
									>
									<span class="font-medium text-gray-900"
										>${currentTax} USD</span
									>
								</div>
								<div
									class="flex justify-between items-center py-2"
								>
									<span class="font-bold text-gray-900"
										>Total</span
									>
									<span
										class="text-lg font-bold text-gray-900"
										>${currentTotal} USD</span
									>
								</div>
							</div>
						{/if}
					</div>

					<!-- Collapsible Tax Demo -->
					<div
						class="mt-3 border border-gray-200 rounded-md overflow-hidden"
					>
						<button
							on:click={() => (showTaxDemo = !showTaxDemo)}
							class="w-full p-3 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
						>
							<span
								class="text-sm font-semibold text-gray-700 flex items-center gap-2"
							>
								Tax Demo Info
							</span>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								class="h-4 w-4 text-gray-500 transition-transform {showTaxDemo
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
						{#if showTaxDemo}
							<div
								class="px-3 pb-3 bg-gray-50 border-t border-gray-100"
							>
								<p class="text-xs text-gray-600 mb-2 mt-2">
									Tax updates automatically based on shipping
									state.
								</p>
								<div class="grid grid-cols-4 gap-1 text-xs">
									<div
										class="bg-white border border-gray-200 rounded p-1 text-center"
									>
										<span
											class="text-gray-900 font-semibold"
											>CA</span
										>
										<span class="text-gray-500 block"
											>8.5%</span
										>
									</div>
									<div
										class="bg-white border border-gray-200 rounded p-1 text-center"
									>
										<span
											class="text-gray-900 font-semibold"
											>TX</span
										>
										<span class="text-gray-500 block"
											>8.0%</span
										>
									</div>
									<div
										class="bg-white border border-gray-200 rounded p-1 text-center"
									>
										<span
											class="text-gray-900 font-semibold"
											>FL</span
										>
										<span class="text-gray-500 block"
											>7.0%</span
										>
									</div>
									<div
										class="bg-white border border-gray-200 rounded p-1 text-center"
									>
										<span
											class="text-gray-900 font-semibold"
											>DE</span
										>
										<span class="text-gray-500 block"
											>0%</span
										>
									</div>
								</div>
							</div>
						{/if}
					</div>
				</div>

				<!-- Subscribe / Recurring Toggle - Prominent -->
				<!-- Subscribe / Recurring Toggle - Prominent -->
				<div class="bg-white rounded-lg p-4 border border-gray-200">
					<label
						class="flex items-center justify-between cursor-pointer"
					>
						<div class="flex items-center gap-3">
							<div class="text-gray-700">
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
										d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
									/>
								</svg>
							</div>
							<div>
								<span class="font-bold text-gray-900 text-lg"
									>Subscribe (Recurring)</span
								>
								<p class="text-xs text-gray-500">
									Save payment method for future charges
								</p>
							</div>
						</div>
						<div class="relative">
							<input
								type="checkbox"
								bind:checked={requestVaulting}
								class="sr-only"
							/>
							<div
								class={`w-11 h-6 rounded-full transition-colors ${requestVaulting ? "bg-blue-600" : "bg-gray-200"}`}
							></div>
							<div
								class={`absolute top-1 left-1 w-4 h-4 rounded-full transition-transform bg-white shadow ${requestVaulting ? "translate-x-5" : ""}`}
							></div>
						</div>
					</label>

					<!-- Zero Dollar Auth (Vault Only) -->
					<label
						class="flex items-center justify-between cursor-pointer mt-3 pt-3 border-t border-gray-100"
					>
						<div class="flex items-center gap-3">
							<div class="text-gray-700">
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
										d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
									/>
								</svg>
							</div>
							<div>
								<span class="font-bold text-gray-900"
									>$0 Auth (Vault Only)</span
								>
								<p class="text-xs text-gray-500">
									Save payment method without charging
								</p>
							</div>
						</div>
						<div class="relative">
							<input
								type="checkbox"
								bind:checked={zeroDollarAuth}
								on:change={initializePayPal}
								class="sr-only"
							/>
							<div
								class={`w-11 h-6 rounded-full transition-colors ${zeroDollarAuth ? "bg-blue-600" : "bg-gray-200"}`}
							></div>
							<div
								class={`absolute top-1 left-1 w-4 h-4 rounded-full transition-transform bg-white shadow ${zeroDollarAuth ? "translate-x-5" : ""}`}
							></div>
						</div>
					</label>
				</div>

				<!-- Collapsible Shipping Preference Card -->
				<!-- Collapsible Shipping Preference Card -->
				<div
					class="bg-white rounded-lg border border-gray-200 overflow-hidden"
				>
					<button
						on:click={() =>
							(showShippingPreference = !showShippingPreference)}
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
							<div>
								<h3 class="text-base font-bold text-gray-900">
									Shipping Preference
								</h3>
								<p class="text-xs text-gray-500">
									{disableShipping
										? "Disabled"
										: shippingPreference ===
											  "SET_PROVIDED_ADDRESS"
											? "Locked"
											: "Editable"}
								</p>
							</div>
						</div>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="h-5 w-5 text-gray-400 transition-transform {showShippingPreference
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
					{#if showShippingPreference}
						<div
							class="px-4 pb-4 space-y-2 border-t border-gray-100 mt-2 pt-2"
						>
							<!-- Disable Shipping Checkbox -->
							<label
								class="flex items-center p-2 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
							>
								<input
									type="checkbox"
									bind:checked={disableShipping}
									on:change={initializePayPal}
									class="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
								/>
								<div class="ml-2">
									<span
										class="font-semibold text-gray-800 text-sm"
										>Disable Shipping</span
									>
									<p class="text-xs text-gray-500">
										Hide address in checkout
									</p>
								</div>
							</label>

							<!-- Shipping Preference Radio Group -->
							<label
								class:opacity-50={disableShipping}
								class:pointer-events-none={disableShipping}
								class="flex items-center p-2 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
							>
								<input
									type="radio"
									bind:group={shippingPreference}
									value="SET_PROVIDED_ADDRESS"
									disabled={disableShipping}
									class="w-4 h-4 text-blue-600 border-gray-300"
								/>
								<div class="ml-2">
									<span
										class="font-semibold text-gray-800 text-sm"
										>Lock Address</span
									>
									<p class="text-xs text-gray-500">
										Pre-fill and prevent editing
									</p>
								</div>
							</label>
							<label
								class="flex items-center p-2 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
								class:opacity-50={disableShipping}
								class:pointer-events-none={disableShipping}
							>
								<input
									type="radio"
									bind:group={shippingPreference}
									value="GET_FROM_FILE"
									disabled={disableShipping}
									class="w-4 h-4 text-blue-600 border-gray-300"
								/>
								<div class="ml-2">
									<span
										class="font-semibold text-gray-800 text-sm"
										>Editable</span
									>
									<p class="text-xs text-gray-500">
										User selects in popup
									</p>
								</div>
							</label>
						</div>
					{/if}
				</div>

				<!-- Collapsible Shipping Address Form Card -->
				<!-- Collapsible Shipping Address Form Card -->
				<div
					class="bg-white rounded-lg border border-gray-200 overflow-hidden"
				>
					<button
						on:click={() =>
							(showShippingAddress = !showShippingAddress)}
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
										d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
									/>
								</svg>
							</div>
							<div>
								<h2 class="text-base font-bold text-gray-900">
									Shipping Address
								</h2>
								<p class="text-xs text-gray-500">
									{shippingAddress.admin_area_2}, {shippingAddress.admin_area_1}
									{shippingAddress.postal_code}
								</p>
							</div>
						</div>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="h-5 w-5 text-gray-400 transition-transform {showShippingAddress
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
					{#if showShippingAddress}
						<div
							class="px-4 pb-4 border-t border-gray-100 mt-2 pt-2"
						>
							<div class="grid grid-cols-1 md:grid-cols-2 gap-3">
								<div class="md:col-span-2">
									<label
										for="fullName"
										class="block text-xs font-semibold text-gray-700 mb-1"
										>Full Name</label
									>
									<input
										id="fullName"
										type="text"
										bind:value={shippingAddress.name}
										class="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
									/>
								</div>
								<div class="md:col-span-2">
									<label
										for="address1"
										class="block text-xs font-semibold text-gray-700 mb-1"
										>Address Line 1</label
									>
									<input
										id="address1"
										type="text"
										bind:value={
											shippingAddress.address_line_1
										}
										class="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
									/>
								</div>
								<div class="md:col-span-2">
									<label
										for="address2"
										class="block text-xs font-semibold text-gray-700 mb-1"
										>Address Line 2</label
									>
									<input
										id="address2"
										type="text"
										bind:value={
											shippingAddress.address_line_2
										}
										class="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
									/>
								</div>
								<div>
									<label
										for="city"
										class="block text-xs font-semibold text-gray-700 mb-1"
										>City</label
									>
									<input
										id="city"
										type="text"
										bind:value={
											shippingAddress.admin_area_2
										}
										class="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
									/>
								</div>
								<div>
									<label
										for="state"
										class="block text-xs font-semibold text-gray-700 mb-1"
										>State</label
									>
									<input
										id="state"
										type="text"
										bind:value={
											shippingAddress.admin_area_1
										}
										placeholder="CA"
										maxlength="2"
										class="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white uppercase"
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
										type="text"
										bind:value={shippingAddress.postal_code}
										class="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
									/>
								</div>
								<div>
									<label
										for="countryCode"
										class="block text-xs font-semibold text-gray-700 mb-1"
										>Country</label
									>
									<input
										id="countryCode"
										type="text"
										bind:value={
											shippingAddress.country_code
										}
										placeholder="US"
										maxlength="2"
										class="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white uppercase"
									/>
								</div>
							</div>
						</div>
					{/if}
				</div>
			</div>

			<!-- Right Column: Payment and Messages -->
			<div class="space-y-4">
				<!-- PayPal Button Card -->
				<!-- PayPal Button Card -->
				<div
					class="bg-white rounded-lg p-4 border border-gray-200 sticky top-4"
				>
					<div class="flex items-center gap-3 mb-4">
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
									d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
								/>
							</svg>
						</div>
						<h3 class="text-lg font-bold text-gray-900">
							Complete Payment
						</h3>
					</div>
					<div
						bind:this={paypalButtonsContainer}
						data-testid="paypal-buttons-container"
						class="max-w-sm mx-auto"
					></div>
					<!-- Status indicator -->
					{#if zeroDollarAuth}
						<div
							class="mt-3 p-2 bg-gray-50 border border-gray-200 rounded"
						>
							<div class="flex items-center gap-2 text-sm">
								<span class="text-gray-600">💳</span>
								<span class="font-medium text-gray-900"
									>$0 Auth - Save payment method only</span
								>
							</div>
						</div>
					{:else if requestVaulting}
						<div
							class="mt-3 p-2 bg-gray-50 border border-gray-200 rounded"
						>
							<div class="flex items-center gap-2 text-sm">
								<span class="text-gray-600">locks</span>
								<span class="font-medium text-gray-900"
									>Vaulting Enabled</span
								>
							</div>
						</div>
					{/if}
				</div>

				{#if successMessage}
					<div
						class="bg-green-50 border border-green-200 rounded-lg p-4"
					>
						<div class="flex items-center gap-3 mb-2">
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
							<p class="text-sm font-bold text-green-900">
								{successMessage}
							</p>
						</div>
						{#if vaultId}
							<div class="mt-3 pt-3 border-t border-green-200">
								<p
									class="text-xs font-bold text-green-800 mb-2"
								>
									Vaulted Payment Details
								</p>
								<div
									class="bg-white border border-green-100 rounded p-2 space-y-1"
								>
									<p class="text-xs">
										<span
											class="font-semibold text-gray-700"
											>Vault ID:</span
										>
										<code
											class="bg-gray-100 px-1.5 py-0.5 rounded font-mono text-xs ml-1"
											>{vaultId}</code
										>
									</p>
									{#if payerEmail}
										<p class="text-xs">
											<span
												class="font-semibold text-slate-700"
												>Email:</span
											>
											<span class="ml-1"
												>{payerEmail}</span
											>
										</p>
									{/if}
								</div>
							</div>

							<!-- Charge Vaulted Payment -->
							<div class="mt-3 pt-3 border-t border-green-200">
								<p
									class="text-xs font-bold text-green-900 mb-2"
								>
									Charge Saved Payment Method
								</p>
								<div class="flex gap-2">
									<div class="flex-1">
										<div class="relative">
											<span
												class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm"
												>$</span
											>
											<input
												type="text"
												bind:value={chargeAmount}
												placeholder="5.00"
												class="w-full pl-7 pr-3 py-2 text-sm border border-green-300 rounded focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
											/>
										</div>
									</div>
									<button
										on:click={chargeVaultedPayment}
										disabled={chargeLoading}
										class="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white text-sm font-semibold rounded transition-colors"
									>
										{chargeLoading
											? "Charging..."
											: "Charge"}
									</button>
								</div>

								{#if chargeResult}
									<div
										class="mt-2 p-2 rounded {chargeResult.success
											? 'bg-green-100'
											: 'bg-red-100'}"
									>
										{#if chargeResult.success}
											<p class="text-xs text-green-800">
												<span class="font-bold"
													>Charged ${chargeResult.amount}!</span
												><br />
												Order: {chargeResult.orderId}<br
												/>
												Capture: {chargeResult.captureId}
											</p>
										{:else}
											<p
												class="text-xs text-red-800 font-semibold"
											>
												{chargeResult.error}
											</p>
										{/if}
									</div>
								{/if}
							</div>
						{/if}
					</div>
				{/if}

				{#if errorMessage}
					<div class="bg-red-50 border border-red-200 rounded-lg p-4">
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
							<p class="text-sm font-semibold text-red-800">
								{errorMessage}
							</p>
						</div>
					</div>
				{/if}
			</div>
		</div>
	</div>

	<!-- Compact Footer -->
	<div class="bg-white border-t border-gray-200 py-4 mt-4">
		<div class="container mx-auto px-4 sm:px-8 max-w-2xl">
			<div class="text-center">
				{#if !isProduction}
					<span
						class="inline-flex items-center gap-1 bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full text-xs font-semibold"
					>
						Sandbox Mode
					</span>
				{:else}
					<span
						class="inline-flex items-center gap-1 bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-xs font-semibold"
					>
						Production Mode
					</span>
				{/if}
			</div>
		</div>
	</div>
</div>
