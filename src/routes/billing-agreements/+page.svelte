<script>
	import { onMount } from "svelte";
	import { page } from "$app/stores";

	let isProduction = false;
	let loading = false;
	let errorMessage = "";
	let successMessage = "";
	let billingAgreementId = "";
	let agreementDetails = null;

	// Vault state
	let vaultLoading = false;
	let vaultResult = null;

	// Customer details for vaulting
	let customer = {
		firstName: "John",
		lastName: "Doe",
		email: "john.doe@example.com",
		company: "Acme Corp",
		phoneNumber: "4155551234",
		website: "https://example.com",
		fax: "4155555678",
	};

	// Agreement configuration
	let description = "Billing Agreement for recurring payments";
	let skipShippingAddress = false;
	let immutableShippingAddress = true;

	// Shipping address
	let shippingAddress = {
		line1: "123 Main Street",
		line2: "Apt 4B",
		city: "San Francisco",
		state: "CA",
		postal_code: "94102",
		country_code: "US",
	};

	// Developer logs
	let logs = [];
	let showLogs = false;

	function addLog(label, data) {
		logs = [
			...logs,
			{
				timestamp: new Date().toISOString(),
				label,
				data: typeof data === "string" ? data : JSON.stringify(data, null, 2),
			},
		];
	}

	async function createAgreement() {
		loading = true;
		errorMessage = "";
		successMessage = "";

		try {
			const requestBody = {
				description,
				skip_shipping_address: skipShippingAddress,
				immutable_shipping_address: immutableShippingAddress,
				isProduction,
			};

			if (!skipShippingAddress) {
				requestBody.shipping_address = {
					line1: shippingAddress.line1,
					line2: shippingAddress.line2,
					city: shippingAddress.city,
					state: shippingAddress.state,
					postal_code: shippingAddress.postal_code,
					country_code: shippingAddress.country_code,
				};
			}

			addLog("POST /api/billing-agreements/create-token", requestBody);

			const response = await fetch("/api/billing-agreements/create-token", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(requestBody),
			});

			const data = await response.json();
			addLog("Response /api/billing-agreements/create-token", data);

			if (!response.ok) {
				throw new Error(data.error || "Failed to create agreement token");
			}

			if (data.approval_url) {
				addLog("Redirecting to PayPal", data.approval_url);
				// Store token_id and environment preference before redirect
				sessionStorage.setItem("ba_token_id", data.token_id);
				sessionStorage.setItem("ba_isProduction", isProduction.toString());
				window.location.href = data.approval_url;
			} else {
				throw new Error("No approval URL received from PayPal");
			}
		} catch (error) {
			console.error("Error creating agreement:", error);
			errorMessage = error.message;
			addLog("Error", error.message);
		} finally {
			loading = false;
		}
	}

	async function executeAgreement(token) {
		loading = true;
		errorMessage = "";

		try {
			// Restore environment preference from before redirect
			const savedEnv = sessionStorage.getItem("ba_isProduction");
			if (savedEnv !== null) {
				isProduction = savedEnv === "true";
				sessionStorage.removeItem("ba_isProduction");
			}

			const requestBody = { token, isProduction };
			addLog("POST /api/billing-agreements/execute", requestBody);

			const response = await fetch("/api/billing-agreements/execute", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(requestBody),
			});

			const data = await response.json();
			addLog("Response /api/billing-agreements/execute", data);

			if (!response.ok) {
				throw new Error(data.error || "Failed to execute agreement");
			}

			billingAgreementId = data.id;
			agreementDetails = data;
			successMessage = `Billing Agreement created: ${billingAgreementId}`;
		} catch (error) {
			console.error("Error executing agreement:", error);
			errorMessage = error.message;
			addLog("Error", error.message);
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		const params = $page.url.searchParams;
		const approved = params.get("approved");
		const cancelled = params.get("cancelled");

		if (cancelled === "true") {
			errorMessage = "Agreement was cancelled by user.";
			addLog("Agreement Cancelled", "User cancelled on PayPal");
		} else if (approved === "true") {
			// Use the BA- token stored before redirect, not the EC- token from the URL
			const baToken = sessionStorage.getItem("ba_token_id");
			if (baToken) {
				sessionStorage.removeItem("ba_token_id");
				addLog("Return from PayPal", { token: baToken, approved });
				executeAgreement(baToken);
			} else {
				errorMessage = "Missing agreement token. Please try creating the agreement again.";
				addLog("Error", "No BA- token found in sessionStorage");
			}
		}
	});

	async function vaultInBraintree() {
		vaultLoading = true;
		vaultResult = null;

		try {
			const requestBody = { billingAgreementId, isProduction, customer, shippingAddress };
			addLog("POST /api/billing-agreements/vault [GraphQL: createCustomer + vaultPayPalBillingAgreement]", requestBody);

			const response = await fetch("/api/billing-agreements/vault", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(requestBody),
			});

			const data = await response.json();

			// Log each GraphQL mutation separately
			if (data.mutations) {
				data.mutations.forEach((m) => {
					addLog(`GraphQL: ${m.mutation} (request)`, m.request);
					addLog(`GraphQL: ${m.mutation} (response)`, m.response);
				});
			} else {
				addLog("Response [GraphQL: vaultPayPalBillingAgreement]", data);
			}

			if (!response.ok) {
				throw new Error(data.error || "Failed to vault billing agreement");
			}

			vaultResult = {
				...data.paymentMethod,
				customer: data.customer || null,
			};
		} catch (error) {
			console.error("Error vaulting agreement:", error);
			errorMessage = error.message;
			addLog("Error (vault)", error.message);
		} finally {
			vaultLoading = false;
		}
	}

	function toggleEnvironment() {
		isProduction = !isProduction;
	}
</script>

<div class="min-h-screen bg-gray-50">
	<div class="container mx-auto px-4 sm:px-8 max-w-7xl py-4 sm:py-6">
		<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
			<!-- Left Column: Configuration -->
			<div class="space-y-4">
				<!-- Environment Toggle -->
				<div class="bg-white rounded-md p-3 border border-gray-200 flex justify-between items-center">
					<div class="flex items-center gap-2">
						<span class="text-sm font-semibold text-gray-700">Environment:</span>
						<span class={`px-2 py-1 rounded text-xs font-bold ${isProduction ? "bg-blue-100 text-blue-700" : "bg-yellow-100 text-yellow-800"}`}>
							{isProduction ? "PRODUCTION" : "SANDBOX"}
						</span>
					</div>
					<button
						on:click={toggleEnvironment}
						class={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${isProduction ? "bg-blue-600" : "bg-gray-200"}`}
					>
						<span class="sr-only">Toggle Environment</span>
						<span class={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isProduction ? "translate-x-6" : "translate-x-1"}`}></span>
					</button>
				</div>

				<!-- Agreement Details Card -->
				<div class="bg-white rounded-lg border border-gray-200 p-4">
					<div class="flex items-center gap-3 mb-4">
						<div class="text-blue-600">
							<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
							</svg>
						</div>
						<h2 class="text-lg font-bold text-gray-900">Agreement Details</h2>
					</div>

					<div class="space-y-3">
						<div>
							<label for="description" class="block text-xs font-semibold text-gray-700 mb-1">Description</label>
							<input
								id="description"
								type="text"
								bind:value={description}
								class="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
							/>
						</div>

						<div class="flex items-center justify-between">
							<div>
								<span class="text-sm font-semibold text-gray-700">Skip Shipping Address</span>
								<p class="text-xs text-gray-500">Hide shipping in approval flow</p>
							</div>
							<label class="relative inline-flex items-center cursor-pointer">
								<input type="checkbox" bind:checked={skipShippingAddress} class="sr-only" />
								<div class={`w-11 h-6 rounded-full transition-colors ${skipShippingAddress ? "bg-blue-600" : "bg-gray-200"}`}></div>
								<div class={`absolute top-1 left-1 w-4 h-4 rounded-full transition-transform bg-white shadow ${skipShippingAddress ? "translate-x-5" : ""}`}></div>
							</label>
						</div>

						<div class="flex items-center justify-between">
							<div>
								<span class="text-sm font-semibold text-gray-700">Lock Shipping Address</span>
								<p class="text-xs text-gray-500">Prevent editing on PayPal</p>
							</div>
							<label class="relative inline-flex items-center cursor-pointer">
								<input type="checkbox" bind:checked={immutableShippingAddress} class="sr-only" />
								<div class={`w-11 h-6 rounded-full transition-colors ${immutableShippingAddress ? "bg-blue-600" : "bg-gray-200"}`}></div>
								<div class={`absolute top-1 left-1 w-4 h-4 rounded-full transition-transform bg-white shadow ${immutableShippingAddress ? "translate-x-5" : ""}`}></div>
							</label>
						</div>
					</div>
				</div>

				<!-- Shipping Address Card -->
				{#if !skipShippingAddress}
					<div class="bg-white rounded-lg border border-gray-200 p-4">
						<div class="flex items-center gap-3 mb-4">
							<div class="text-orange-600">
								<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
								</svg>
							</div>
							<h2 class="text-base font-bold text-gray-900">Shipping Address</h2>
						</div>
						<div class="grid grid-cols-1 md:grid-cols-2 gap-3">
							<div class="md:col-span-2">
								<label for="line1" class="block text-xs font-semibold text-gray-700 mb-1">Address Line 1</label>
								<input id="line1" type="text" bind:value={shippingAddress.line1} class="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white" />
							</div>
							<div class="md:col-span-2">
								<label for="line2" class="block text-xs font-semibold text-gray-700 mb-1">Address Line 2</label>
								<input id="line2" type="text" bind:value={shippingAddress.line2} class="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white" />
							</div>
							<div>
								<label for="city" class="block text-xs font-semibold text-gray-700 mb-1">City</label>
								<input id="city" type="text" bind:value={shippingAddress.city} class="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white" />
							</div>
							<div>
								<label for="state" class="block text-xs font-semibold text-gray-700 mb-1">State</label>
								<input id="state" type="text" bind:value={shippingAddress.state} placeholder="CA" maxlength="2" class="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white uppercase" />
							</div>
							<div>
								<label for="postalCode" class="block text-xs font-semibold text-gray-700 mb-1">Postal Code</label>
								<input id="postalCode" type="text" bind:value={shippingAddress.postal_code} class="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white" />
							</div>
							<div>
								<label for="countryCode" class="block text-xs font-semibold text-gray-700 mb-1">Country</label>
								<input id="countryCode" type="text" bind:value={shippingAddress.country_code} placeholder="US" maxlength="2" class="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white uppercase" />
							</div>
						</div>
					</div>
				{/if}

				<!-- Customer Details for Vaulting -->
				<div class="bg-white rounded-lg border border-gray-200 p-4">
					<div class="flex items-center gap-3 mb-4">
						<div class="text-indigo-600">
							<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
							</svg>
						</div>
						<div>
							<h2 class="text-base font-bold text-gray-900">Customer Details</h2>
							<p class="text-xs text-gray-500">Attached to Braintree customer when vaulting</p>
						</div>
					</div>
					<div class="grid grid-cols-1 md:grid-cols-2 gap-3">
						<div>
							<label for="custFirstName" class="block text-xs font-semibold text-gray-700 mb-1">First Name</label>
							<input id="custFirstName" type="text" bind:value={customer.firstName} class="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white" />
						</div>
						<div>
							<label for="custLastName" class="block text-xs font-semibold text-gray-700 mb-1">Last Name</label>
							<input id="custLastName" type="text" bind:value={customer.lastName} class="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white" />
						</div>
						<div class="md:col-span-2">
							<label for="custEmail" class="block text-xs font-semibold text-gray-700 mb-1">Email</label>
							<input id="custEmail" type="email" bind:value={customer.email} class="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white" />
						</div>
						<div>
							<label for="custCompany" class="block text-xs font-semibold text-gray-700 mb-1">Company</label>
							<input id="custCompany" type="text" bind:value={customer.company} placeholder="Optional" class="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white" />
						</div>
						<div>
							<label for="custPhone" class="block text-xs font-semibold text-gray-700 mb-1">Phone</label>
							<input id="custPhone" type="text" bind:value={customer.phoneNumber} placeholder="Optional" class="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white" />
						</div>
						<div>
							<label for="custWebsite" class="block text-xs font-semibold text-gray-700 mb-1">Website</label>
							<input id="custWebsite" type="text" bind:value={customer.website} placeholder="Optional" class="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white" />
						</div>
						<div>
							<label for="custFax" class="block text-xs font-semibold text-gray-700 mb-1">Fax</label>
							<input id="custFax" type="text" bind:value={customer.fax} placeholder="Optional" class="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white" />
						</div>
					</div>
				</div>
			</div>

			<!-- Right Column: Action & Results -->
			<div class="space-y-4">
				<!-- Create Agreement Button Card -->
				<div class="bg-white rounded-lg p-4 border border-gray-200">
					<div class="flex items-center gap-3 mb-4">
						<div class="text-blue-600">
							<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
							</svg>
						</div>
						<h3 class="text-lg font-bold text-gray-900">Create Billing Agreement</h3>
					</div>
					<p class="text-sm text-gray-600 mb-4">
						Creates a billing agreement token and redirects to PayPal for approval. After approval, the <code class="bg-gray-100 px-1 py-0.5 rounded text-xs">B-</code> prefixed agreement ID will be returned.
					</p>
					<button
						on:click={createAgreement}
						disabled={loading}
						class="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold rounded-lg transition-colors"
					>
						{#if loading}
							<span class="flex items-center justify-center gap-2">
								<svg class="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
									<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
									<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
								</svg>
								Processing...
							</span>
						{:else}
							Create Agreement
						{/if}
					</button>
				</div>

				<!-- Success Result -->
				{#if successMessage}
					<div class="bg-green-50 border border-green-200 rounded-lg p-4">
						<div class="flex items-center gap-3 mb-2">
							<div class="text-green-600">
								<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
								</svg>
							</div>
							<p class="text-sm font-bold text-green-900">{successMessage}</p>
						</div>
						{#if agreementDetails}
							<div class="mt-3 pt-3 border-t border-green-200">
								<p class="text-xs font-bold text-green-800 mb-2">Agreement Details</p>
								<div class="bg-white border border-green-100 rounded p-2 space-y-1">
									<p class="text-xs">
										<span class="font-semibold text-gray-700">Agreement ID:</span>
										<code class="bg-gray-100 px-1.5 py-0.5 rounded font-mono text-xs ml-1">{billingAgreementId}</code>
									</p>
									{#if agreementDetails.state}
										<p class="text-xs">
											<span class="font-semibold text-gray-700">State:</span>
											<span class="ml-1">{agreementDetails.state}</span>
										</p>
									{/if}
									{#if agreementDetails.description}
										<p class="text-xs">
											<span class="font-semibold text-gray-700">Description:</span>
											<span class="ml-1">{agreementDetails.description}</span>
										</p>
									{/if}
									{#if agreementDetails.payer?.payer_info?.email}
										<p class="text-xs">
											<span class="font-semibold text-gray-700">Payer Email:</span>
											<span class="ml-1">{agreementDetails.payer.payer_info.email}</span>
										</p>
									{/if}
								</div>
							</div>
						{/if}

						<!-- Vault in Braintree -->
						{#if billingAgreementId && !vaultResult}
							<div class="mt-3 pt-3 border-t border-green-200">
								<button
									on:click={vaultInBraintree}
									disabled={vaultLoading}
									class="w-full px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-semibold rounded-lg transition-colors text-sm"
								>
									{#if vaultLoading}
										<span class="flex items-center justify-center gap-2">
											<svg class="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
												<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
												<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
											</svg>
											Vaulting...
										</span>
									{:else}
										Vault in Braintree
									{/if}
								</button>
							</div>
						{/if}

						<!-- Vault Result -->
						{#if vaultResult}
							<div class="mt-3 pt-3 border-t border-green-200">
								<p class="text-xs font-bold text-indigo-800 mb-2">Braintree Vault Result</p>
								<div class="bg-white border border-indigo-100 rounded p-2 space-y-1">
									<p class="text-xs">
										<span class="font-semibold text-gray-700">Payment Method ID:</span>
										<code class="bg-indigo-50 px-1.5 py-0.5 rounded font-mono text-xs ml-1">{vaultResult.id}</code>
									</p>
									{#if vaultResult.usage}
										<p class="text-xs">
											<span class="font-semibold text-gray-700">Usage:</span>
											<span class="ml-1">{vaultResult.usage}</span>
										</p>
									{/if}
									{#if vaultResult.email}
										<p class="text-xs">
											<span class="font-semibold text-gray-700">PayPal Email:</span>
											<span class="ml-1">{vaultResult.email}</span>
										</p>
									{/if}
									{#if vaultResult.firstName || vaultResult.lastName}
										<p class="text-xs">
											<span class="font-semibold text-gray-700">Name:</span>
											<span class="ml-1">{vaultResult.firstName} {vaultResult.lastName}</span>
										</p>
									{/if}
									{#if vaultResult.payerId}
										<p class="text-xs">
											<span class="font-semibold text-gray-700">Payer ID:</span>
											<code class="bg-gray-100 px-1.5 py-0.5 rounded font-mono text-xs ml-1">{vaultResult.payerId}</code>
										</p>
									{/if}
									{#if vaultResult.billingAgreementId}
										<p class="text-xs">
											<span class="font-semibold text-gray-700">Billing Agreement:</span>
											<code class="bg-gray-100 px-1.5 py-0.5 rounded font-mono text-xs ml-1">{vaultResult.billingAgreementId}</code>
										</p>
									{/if}
								</div>

								{#if vaultResult.customer}
									<p class="text-xs font-bold text-indigo-800 mt-3 mb-1">Customer Details</p>
									<div class="bg-indigo-50 border border-indigo-100 rounded p-2 space-y-1">
										{#if vaultResult.customer.legacyId}
											<p class="text-xs">
												<span class="font-semibold text-gray-700">Customer ID:</span>
												<code class="bg-white px-1.5 py-0.5 rounded font-mono text-xs ml-1">{vaultResult.customer.legacyId}</code>
											</p>
										{/if}
										{#if vaultResult.customer.firstName || vaultResult.customer.lastName}
											<p class="text-xs">
												<span class="font-semibold text-gray-700">Name:</span>
												<span class="ml-1">{vaultResult.customer.firstName || ''} {vaultResult.customer.lastName || ''}</span>
											</p>
										{/if}
										{#if vaultResult.customer.email}
											<p class="text-xs">
												<span class="font-semibold text-gray-700">Email:</span>
												<span class="ml-1">{vaultResult.customer.email}</span>
											</p>
										{/if}
										{#if vaultResult.customer.company}
											<p class="text-xs">
												<span class="font-semibold text-gray-700">Company:</span>
												<span class="ml-1">{vaultResult.customer.company}</span>
											</p>
										{/if}
										{#if vaultResult.customer.phoneNumber}
											<p class="text-xs">
												<span class="font-semibold text-gray-700">Phone:</span>
												<span class="ml-1">{vaultResult.customer.phoneNumber}</span>
											</p>
										{/if}
									</div>
								{/if}
							</div>
						{/if}
					</div>
				{/if}

				<!-- Error -->
				{#if errorMessage}
					<div class="bg-red-50 border border-red-200 rounded-lg p-4">
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

				<!-- Developer Logs -->
				<div class="bg-white rounded-lg border border-gray-200 overflow-hidden">
					<button
						on:click={() => (showLogs = !showLogs)}
						class="w-full p-4 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
					>
						<div class="flex items-center gap-3">
							<div class="text-gray-600">
								<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
								</svg>
							</div>
							<div>
								<h3 class="text-base font-bold text-gray-900">Developer Logs</h3>
								<p class="text-xs text-gray-500">{logs.length} entries</p>
							</div>
						</div>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="h-5 w-5 text-gray-400 transition-transform {showLogs ? 'rotate-180' : ''}"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
						>
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
						</svg>
					</button>
					{#if showLogs}
						<div class="px-4 pb-4 border-t border-gray-100 space-y-2">
							{#if logs.length === 0}
								<p class="text-xs text-gray-500 py-2">No logs yet. Create an agreement to see API interactions.</p>
							{:else}
								{#each logs as log}
									<div class="bg-gray-50 rounded p-2 border border-gray-100">
										<div class="flex items-center justify-between mb-1">
											<span class="text-xs font-bold text-gray-700">{log.label}</span>
											<span class="text-xs text-gray-400">{log.timestamp.split("T")[1].split(".")[0]}</span>
										</div>
										<pre class="text-xs text-gray-600 overflow-x-auto whitespace-pre-wrap break-all">{log.data}</pre>
									</div>
								{/each}
							{/if}
						</div>
					{/if}
				</div>
			</div>
		</div>
	</div>

	<!-- Footer -->
	<div class="bg-white border-t border-gray-200 py-4 mt-4">
		<div class="container mx-auto px-4 sm:px-8 max-w-2xl">
			<div class="text-center">
				{#if !isProduction}
					<span class="inline-flex items-center gap-1 bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full text-xs font-semibold">
						Sandbox Mode
					</span>
				{:else}
					<span class="inline-flex items-center gap-1 bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-xs font-semibold">
						Production Mode
					</span>
				{/if}
			</div>
		</div>
	</div>
</div>
