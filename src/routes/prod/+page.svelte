<script>
	import { onMount } from "svelte";
	import { loadScript } from "@paypal/paypal-js";
	import { PUBLIC_PAYPAL_PROD_CLIENT_ID } from "$env/static/public";
	import { calculateTax, calculateTotal, getTaxRate } from "$lib/taxRates.js";

	let paypalButtonsContainer;
	let errorMessage = "";
	let successMessage = "";
	let vaultId = "";
	let payerEmail = "";

	// Product details
	const PRODUCT_SUBTOTAL = "100.00";

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

	onMount(async () => {
		// Check if production credentials are configured
		if (
			!PUBLIC_PAYPAL_PROD_CLIENT_ID ||
			PUBLIC_PAYPAL_PROD_CLIENT_ID === "YOUR_PRODUCTION_CLIENT_ID_HERE"
		) {
			errorMessage =
				"Production PayPal credentials not configured. Please set PUBLIC_PAYPAL_PROD_CLIENT_ID in your environment variables.";
			console.error(
				"Production credentials missing. Check VERCEL_SETUP.md for setup instructions.",
			);
			return;
		}

		try {
			const paypal = await loadScript({
				clientId: PUBLIC_PAYPAL_PROD_CLIENT_ID,
				currency: "USD",
				enableFunding: "venmo",
			});

			if (paypal && paypal.Buttons) {
				await paypal
					.Buttons({
						// Creates the order on the server-side
						createOrder: async () => {
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
											shipping_preference:
												shippingPreference,
											initial_state:
												shippingAddress.admin_area_1,
											isProduction: true,
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
						// Handles shipping address changes - updates tax dynamically
						onShippingAddressChange: (data, actions) => {
							const stateCode = data.shippingAddress?.state;
							const countryCode =
								data.shippingAddress?.countryCode;

							// Only support US addresses
							if (countryCode && countryCode !== "US") {
								return actions.reject(
									data.errors.COUNTRY_ERROR,
								);
							}

							if (!stateCode) {
								return Promise.resolve();
							}

							// Call server to update order with tax
							return fetch("/api/paypal/update-order", {
								method: "POST",
								headers: {
									"Content-Type": "application/json",
								},
								body: JSON.stringify({
									orderId: data.orderID,
									subtotal: PRODUCT_SUBTOTAL,
									stateCode: stateCode,
									isProduction: true,
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
						},
						// Handles successful payment - captures on server-side
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
											isProduction: true,
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

								// Store vault ID and payer info
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
						// Handles errors
						onError: (err) => {
							console.error("PayPal error:", err);
							errorMessage =
								"An error occurred during the transaction. Please try again.";
							successMessage = "";
						},
					})
					.render(paypalButtonsContainer);
			}
		} catch (error) {
			console.error("Failed to load PayPal SDK:", error);
			errorMessage =
				"Failed to load PayPal. Please check your configuration.";
		}
	});
</script>

<div class="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
	<div class="container mx-auto px-8 max-w-7xl py-8">
		<!-- Two Column Layout -->
		<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
			<!-- Left Column: Forms and Details -->
			<div class="space-y-6">
				<!-- Product Card -->
				<div
					class="bg-white shadow-xl rounded-2xl p-6 border border-slate-200/50"
				>
					<div class="flex items-center gap-3 mb-4">
						<div
							class="bg-gradient-to-br from-blue-500 to-indigo-600 text-white rounded-lg p-2"
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
									d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"
								/>
							</svg>
						</div>
						<h2 class="text-2xl font-bold text-slate-800">
							Product Details
						</h2>
					</div>
					<div
						class="mb-4 p-4 bg-gradient-to-r from-slate-50 to-slate-100 rounded-xl"
					>
						<p class="text-slate-700 text-lg">
							<span class="font-semibold text-slate-900"
								>🛒 Sample Product</span
							>
						</p>
						<div class="text-slate-700 space-y-2 mt-3">
							<div
								class="flex justify-between items-center py-2 border-b border-slate-200"
							>
								<span class="text-slate-600">Subtotal</span>
								<span class="font-semibold"
									>${PRODUCT_SUBTOTAL} USD</span
								>
							</div>
							<div
								class="flex justify-between items-center py-2 border-b border-slate-200"
							>
								<span class="text-slate-600"
									>Tax ({currentTaxRate}% - {shippingAddress.admin_area_1})</span
								>
								<span class="font-semibold text-amber-600"
									>${currentTax} USD</span
								>
							</div>
							<div class="flex justify-between items-center py-3">
								<span class="text-lg font-bold text-slate-800"
									>Total</span
								>
								<span
									class="text-2xl font-bold text-emerald-600"
									>${currentTotal} USD</span
								>
							</div>
						</div>
					</div>
					<div
						class="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200/50 rounded-xl"
					>
						<div class="flex items-center gap-2">
							<span class="text-blue-600">🔒</span>
							<span class="font-semibold text-blue-900"
								>Vaulting Enabled</span
							>
						</div>
						<p class="text-sm text-blue-700 mt-1">
							Your payment method will be securely saved for
							future purchases.
						</p>
					</div>

					<div
						class="mt-4 p-4 bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-200/50 rounded-xl"
					>
						<p
							class="text-sm font-bold text-purple-900 mb-2 flex items-center gap-2"
						>
							<span>📊</span> Dynamic Tax Calculation Demo
						</p>
						<p class="text-xs text-purple-800 mb-3">
							The order starts at <span class="font-bold"
								>${PRODUCT_SUBTOTAL}</span
							> (no tax). When you select your shipping address in
							PayPal, the total updates automatically based on the
							state.
						</p>
						<div class="grid grid-cols-2 gap-2 text-xs">
							<div class="bg-white/70 rounded-lg p-2 text-center">
								<span class="text-purple-600 font-semibold"
									>CA</span
								>
								<span class="text-slate-600 ml-1"
									>8.5% → $1.09</span
								>
							</div>
							<div class="bg-white/70 rounded-lg p-2 text-center">
								<span class="text-purple-600 font-semibold"
									>TX</span
								>
								<span class="text-slate-600 ml-1"
									>8.0% → $1.08</span
								>
							</div>
							<div class="bg-white/70 rounded-lg p-2 text-center">
								<span class="text-purple-600 font-semibold"
									>FL</span
								>
								<span class="text-slate-600 ml-1"
									>7.0% → $1.07</span
								>
							</div>
							<div class="bg-white/70 rounded-lg p-2 text-center">
								<span class="text-purple-600 font-semibold"
									>DE</span
								>
								<span class="text-slate-600 ml-1"
									>0% → $1.00</span
								>
							</div>
						</div>
					</div>
				</div>

				<!-- Shipping Preference Card -->
				<div
					class="bg-white shadow-xl rounded-2xl p-6 border border-slate-200/50"
				>
					<div class="flex items-center gap-3 mb-4">
						<div
							class="bg-gradient-to-br from-emerald-500 to-teal-600 text-white rounded-lg p-2"
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
						<h3 class="text-xl font-bold text-slate-800">
							Shipping Preference
						</h3>
					</div>
					<div class="space-y-3">
						<label
							class="flex items-center p-3 bg-slate-50 border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-100 transition-colors"
						>
							<input
								type="radio"
								bind:group={shippingPreference}
								value="SET_PROVIDED_ADDRESS"
								class="w-5 h-5 text-blue-600 border-slate-300"
							/>
							<div class="ml-3">
								<span class="font-semibold text-slate-800"
									>Pre-fill Address</span
								>
								<p class="text-xs text-slate-500">
									Use the address below to pre-fill checkout
								</p>
							</div>
						</label>
						<label
							class="flex items-center p-3 bg-slate-50 border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-100 transition-colors"
						>
							<input
								type="radio"
								bind:group={shippingPreference}
								value="GET_FROM_FILE"
								class="w-5 h-5 text-blue-600 border-slate-300"
							/>
							<div class="ml-3">
								<span class="font-semibold text-slate-800"
									>PayPal Account Address</span
								>
								<p class="text-xs text-slate-500">
									User selects from their saved PayPal
									addresses
								</p>
							</div>
						</label>
					</div>
					<p
						class="text-xs text-slate-500 mt-4 p-3 bg-amber-50 border border-amber-200/50 rounded-lg"
					>
						{#if shippingPreference === "SET_PROVIDED_ADDRESS"}
							📋 The address below will be sent to PayPal to
							pre-fill the checkout.
						{:else}
							📁 The user will select their shipping address from
							their PayPal account.
						{/if}
					</p>
				</div>

				<!-- Shipping Address Form Card -->
				<div
					class="bg-white shadow-xl rounded-2xl p-6 border border-slate-200/50"
				>
					<div class="flex items-center gap-3 mb-4">
						<div
							class="bg-gradient-to-br from-orange-500 to-rose-600 text-white rounded-lg p-2"
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
									d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
								/>
							</svg>
						</div>
						<h2 class="text-xl font-bold text-slate-800">
							Shipping Address
						</h2>
					</div>
					<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
						<div class="md:col-span-2">
							<label
								for="fullName"
								class="block text-sm font-semibold text-slate-700 mb-2"
								>Full Name</label
							>
							<input
								id="fullName"
								type="text"
								bind:value={shippingAddress.name}
								class="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all bg-slate-50 hover:bg-white"
							/>
						</div>
						<div class="md:col-span-2">
							<label
								for="address1"
								class="block text-sm font-semibold text-slate-700 mb-2"
								>Address Line 1</label
							>
							<input
								id="address1"
								type="text"
								bind:value={shippingAddress.address_line_1}
								class="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all bg-slate-50 hover:bg-white"
							/>
						</div>
						<div class="md:col-span-2">
							<label
								for="address2"
								class="block text-sm font-semibold text-slate-700 mb-2"
								>Address Line 2 (Optional)</label
							>
							<input
								id="address2"
								type="text"
								bind:value={shippingAddress.address_line_2}
								class="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all bg-slate-50 hover:bg-white"
							/>
						</div>
						<div>
							<label
								for="city"
								class="block text-sm font-semibold text-slate-700 mb-2"
								>City</label
							>
							<input
								id="city"
								type="text"
								bind:value={shippingAddress.admin_area_2}
								class="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all bg-slate-50 hover:bg-white"
							/>
						</div>
						<div>
							<label
								for="state"
								class="block text-sm font-semibold text-slate-700 mb-2"
								>State</label
							>
							<input
								id="state"
								type="text"
								bind:value={shippingAddress.admin_area_1}
								placeholder="e.g., CA"
								maxlength="2"
								class="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all bg-slate-50 hover:bg-white uppercase"
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
								type="text"
								bind:value={shippingAddress.postal_code}
								class="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all bg-slate-50 hover:bg-white"
							/>
						</div>
						<div>
							<label
								for="countryCode"
								class="block text-sm font-semibold text-slate-700 mb-2"
								>Country Code</label
							>
							<input
								id="countryCode"
								type="text"
								bind:value={shippingAddress.country_code}
								placeholder="US"
								maxlength="2"
								class="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all bg-slate-50 hover:bg-white uppercase"
							/>
						</div>
					</div>
					<p
						class="text-xs text-slate-500 mt-4 p-3 bg-slate-50 rounded-lg border border-slate-200"
					>
						ℹ️ This address will be prefilled in PayPal checkout but
						can be edited during payment.
					</p>
				</div>
			</div>

			<!-- Right Column: Payment and Messages -->
			<div class="space-y-6">
				<!-- PayPal Button Card -->
				<div
					class="bg-white shadow-xl rounded-2xl p-6 border border-slate-200/50 sticky top-6"
				>
					<div class="flex items-center gap-3 mb-4">
						<div
							class="bg-gradient-to-br from-yellow-400 to-blue-600 text-white rounded-lg p-2"
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
									d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
								/>
							</svg>
						</div>
						<h3 class="text-xl font-bold text-slate-800">
							Complete Payment
						</h3>
					</div>
					<div
						bind:this={paypalButtonsContainer}
						data-testid="paypal-buttons-container"
						class="max-w-sm mx-auto"
					></div>
				</div>

				{#if successMessage}
					<div
						class="bg-gradient-to-r from-emerald-50 to-teal-50 border-2 border-emerald-400 rounded-2xl p-6 shadow-lg"
					>
						<div class="flex items-center gap-3 mb-3">
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
							<p class="text-lg font-bold text-emerald-800">
								{successMessage}
							</p>
						</div>
						{#if vaultId}
							<div class="mt-4 pt-4 border-t border-emerald-300">
								<p
									class="text-sm font-bold text-emerald-900 mb-3 flex items-center gap-2"
								>
									<span>🔐</span> Vaulted Payment Details
								</p>
								<div
									class="bg-white/60 rounded-xl p-4 space-y-2"
								>
									<p class="text-sm">
										<span
											class="font-semibold text-slate-700"
											>Vault ID:</span
										>
										<code
											class="bg-emerald-200/70 px-2 py-1 rounded-lg font-mono text-sm ml-2"
											>{vaultId}</code
										>
									</p>
									{#if payerEmail}
										<p class="text-sm">
											<span
												class="font-semibold text-slate-700"
												>Payer Email:</span
											>
											<span class="ml-2"
												>{payerEmail}</span
											>
										</p>
									{/if}
								</div>
								<p
									class="text-xs mt-3 text-emerald-600 bg-emerald-100 rounded-lg p-2"
								>
									✨ This payment method can be used for
									future transactions without re-entering
									payment details.
								</p>
							</div>
						{/if}

						<!-- Shipping Address -->
						<div class="mt-4 pt-4 border-t border-emerald-300">
							<p
								class="text-sm font-bold text-emerald-900 mb-3 flex items-center gap-2"
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
								<span>Shipping Address</span>
							</p>
							<div class="bg-white/60 rounded-xl p-4">
								<p class="text-sm font-semibold text-slate-700">
									{shippingAddress.name}
								</p>
								<p class="text-sm text-slate-600 mt-1">
									{shippingAddress.address_line_1}
								</p>
								{#if shippingAddress.address_line_2}
									<p class="text-sm text-slate-600">
										{shippingAddress.address_line_2}
									</p>
								{/if}
								<p class="text-sm text-slate-600">
									{shippingAddress.admin_area_2}, {shippingAddress.admin_area_1}
									{shippingAddress.postal_code}
								</p>
								<p class="text-sm text-slate-600">
									{shippingAddress.country_code}
								</p>
							</div>
						</div>
					</div>
				{/if}

				{#if errorMessage}
					<div
						class="bg-gradient-to-r from-red-50 to-rose-50 border-2 border-red-400 rounded-2xl p-6 shadow-lg"
					>
						<div class="flex items-center gap-3">
							<div class="bg-red-500 text-white rounded-full p-2">
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
			</div>
		</div>
	</div>

	<!-- Footer -->
	<div class="bg-gradient-to-r from-red-800 to-red-900 text-white py-8 mt-8">
		<div class="container mx-auto px-8 max-w-2xl">
			<div class="text-center space-y-3">
				<div
					class="inline-flex items-center gap-2 bg-red-500/30 text-red-100 px-4 py-2 rounded-full text-sm font-semibold"
				>
					<span>🔴</span> PRODUCTION Environment - LIVE MODE
				</div>
				<p class="text-red-100 text-sm">
					This uses real PayPal production credentials. Real
					transactions will be processed!
				</p>
			</div>
			<div
				class="mt-6 p-5 bg-red-700/50 border border-red-600 rounded-xl text-left max-w-xl mx-auto"
			>
				<p class="font-bold text-white mb-3 flex items-center gap-2">
					<span>⚠️</span> Production Mode Warning
				</p>
				<p class="text-sm text-red-100">
					You are using production PayPal credentials. Any payments
					made here will be real and will process actual charges. Use
					with caution!
				</p>
			</div>
		</div>
	</div>
</div>
