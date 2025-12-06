<script>
	import { onMount } from "svelte";
	import { loadScript } from "@paypal/paypal-js";
	import { PUBLIC_PAYPAL_CLIENT_ID } from "$env/static/public";
	import { calculateTax, calculateTotal, getTaxRate } from "$lib/taxRates.js";

	let paypalButtonsContainer;
	let errorMessage = "";
	let successMessage = "";
	let vaultId = "";
	let payerEmail = "";

	// Product details
	const PRODUCT_SUBTOTAL = "10.00";

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
		try {
			const paypal = await loadScript({
				clientId: PUBLIC_PAYPAL_CLIENT_ID,
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

<div class="container mx-auto p-8 max-w-2xl">
	<h1 class="text-4xl font-bold mb-6 text-center">PayPal Checkout Demo</h1>

	<div class="bg-white shadow-lg rounded-lg p-6 mb-4">
		<h2 class="text-2xl font-semibold mb-4">Product Details</h2>
		<div class="mb-6">
			<p class="text-gray-700">
				<span class="font-semibold">Product:</span> Sample Product
			</p>
			<div class="text-gray-700 space-y-1">
				<p>
					<span class="font-semibold">Subtotal:</span>
					${PRODUCT_SUBTOTAL} USD
				</p>
				<p>
					<span class="font-semibold">Tax ({currentTaxRate}%):</span>
					${currentTax} USD
					<span class="text-sm text-gray-600"
						>({shippingAddress.admin_area_1})</span
					>
				</p>
				<p class="text-lg font-bold text-gray-900">
					<span class="font-semibold">Total:</span> ${currentTotal} USD
				</p>
			</div>
			<div class="mt-3 p-3 bg-blue-50 border border-blue-200 rounded">
				<p class="text-sm text-blue-800">
					<span class="font-semibold">Vaulting Enabled:</span> Your payment
					method will be securely saved for future purchases.
				</p>
			</div>

			<div class="mt-3 p-3 bg-purple-50 border border-purple-200 rounded">
				<p class="text-sm font-semibold text-purple-900 mb-2">
					Dynamic Tax Calculation Demo
				</p>
				<p class="text-xs text-purple-800 mb-2">
					The order starts at <span class="font-semibold">$10.00</span
					> (no tax). When you select your shipping address in PayPal,
					the total updates automatically based on the state.
				</p>
				<div class="text-xs text-purple-700 mt-2 space-y-1">
					<p>
						<span class="font-semibold"
							>Examples when you select state in PayPal:</span
						>
					</p>
					<p>• California (8.5%): $10.00 → $10.85</p>
					<p>• Texas (8.0%): $10.00 → $10.80</p>
					<p>• Florida (7.0%): $10.00 → $10.70</p>
					<p>• Delaware (0%): $10.00 → $10.00</p>
				</div>
			</div>
		</div>

		<!-- Shipping Preference Toggle -->
		<div class="mb-6 p-4 bg-gray-50 border border-gray-200 rounded">
			<h3 class="text-lg font-semibold mb-3">Shipping Preference</h3>
			<div class="flex space-x-4">
				<label class="inline-flex items-center">
					<input
						type="radio"
						bind:group={shippingPreference}
						value="SET_PROVIDED_ADDRESS"
						class="form-radio text-blue-600"
					/>
					<span class="ml-2">Set Provided Address (Pre-fill)</span>
				</label>
				<label class="inline-flex items-center">
					<input
						type="radio"
						bind:group={shippingPreference}
						value="GET_FROM_FILE"
						class="form-radio text-blue-600"
					/>
					<span class="ml-2">Get From File (PayPal Account)</span>
				</label>
			</div>
			<p class="text-xs text-gray-600 mt-2">
				{#if shippingPreference === "SET_PROVIDED_ADDRESS"}
					The address below will be sent to PayPal to pre-fill the
					checkout.
				{:else}
					The user will select their shipping address from their
					PayPal account.
				{/if}
			</p>
		</div>

		<!-- Shipping Address Form -->
		<h2 class="text-2xl font-semibold mb-4 mt-6">Shipping Address</h2>
		<div class="mb-6 p-4 bg-gray-50 border border-gray-200 rounded">
			<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
				<div class="md:col-span-2">
					<label
						class="block text-sm font-semibold text-gray-700 mb-1"
						>Full Name</label
					>
					<input
						type="text"
						bind:value={shippingAddress.name}
						class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
					/>
				</div>
				<div class="md:col-span-2">
					<label
						class="block text-sm font-semibold text-gray-700 mb-1"
						>Address Line 1</label
					>
					<input
						type="text"
						bind:value={shippingAddress.address_line_1}
						class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
					/>
				</div>
				<div class="md:col-span-2">
					<label
						class="block text-sm font-semibold text-gray-700 mb-1"
					>
						Address Line 2 (Optional)
					</label>
					<input
						type="text"
						bind:value={shippingAddress.address_line_2}
						class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
					/>
				</div>
				<div>
					<label
						class="block text-sm font-semibold text-gray-700 mb-1"
						>City</label
					>
					<input
						type="text"
						bind:value={shippingAddress.admin_area_2}
						class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
					/>
				</div>
				<div>
					<label
						class="block text-sm font-semibold text-gray-700 mb-1"
						>State</label
					>
					<input
						type="text"
						bind:value={shippingAddress.admin_area_1}
						placeholder="e.g., CA"
						maxlength="2"
						class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
					/>
				</div>
				<div>
					<label
						class="block text-sm font-semibold text-gray-700 mb-1"
						>Postal Code</label
					>
					<input
						type="text"
						bind:value={shippingAddress.postal_code}
						class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
					/>
				</div>
				<div>
					<label
						class="block text-sm font-semibold text-gray-700 mb-1"
						>Country Code</label
					>
					<input
						type="text"
						bind:value={shippingAddress.country_code}
						placeholder="US"
						maxlength="2"
						class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
					/>
				</div>
			</div>
			<p class="text-xs text-gray-600 mt-3">
				This address will be prefilled in PayPal checkout but can be
				edited during payment.
			</p>
		</div>

		<div class="mb-4">
			<h3 class="text-lg font-semibold mb-2">Pay with PayPal:</h3>
			<div
				bind:this={paypalButtonsContainer}
				class="max-w-sm mx-auto"
			></div>
		</div>

		{#if successMessage}
			<div
				class="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded mb-4"
			>
				<p class="font-semibold">{successMessage}</p>
				{#if vaultId}
					<div class="mt-3 pt-3 border-t border-green-300">
						<p class="text-sm font-semibold mb-2">
							Vaulted Payment Details:
						</p>
						<p class="text-sm">
							<span class="font-semibold">Vault ID:</span>
							<code class="bg-green-200 px-2 py-1 rounded"
								>{vaultId}</code
							>
						</p>
						{#if payerEmail}
							<p class="text-sm mt-1">
								<span class="font-semibold">Payer Email:</span>
								{payerEmail}
							</p>
						{/if}
						<p class="text-xs mt-2 text-green-600">
							This payment method can be used for future
							transactions without re-entering payment details.
						</p>
					</div>
				{/if}
			</div>
		{/if}

		{#if errorMessage}
			<div
				class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4"
			>
				{errorMessage}
			</div>
		{/if}
	</div>

	<div class="text-center text-gray-600 text-sm space-y-2">
		<p class="font-semibold">Sandbox Environment - Test Mode</p>
		<p>Use PayPal sandbox credentials to test the checkout.</p>
		<div
			class="mt-4 p-4 bg-gray-50 border border-gray-200 rounded text-left max-w-xl mx-auto"
		>
			<p class="font-semibold text-gray-800 mb-2">
				How to Test Dynamic Tax:
			</p>
			<ol class="list-decimal list-inside space-y-1 text-xs">
				<li>Click the PayPal button above</li>
				<li>Log in with your sandbox account</li>
				<li>Select or change your shipping address</li>
				<li>
					Watch the total amount update based on the selected state
				</li>
				<li>Try different states to see different tax calculations</li>
			</ol>
		</div>
	</div>
</div>
