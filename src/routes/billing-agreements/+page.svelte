<script>
	import { onMount } from "svelte";
	import { page } from "$app/stores";

	let isProduction = false;
	let paypalAccount = "default";
	let loading = false;
	let errorMessage = "";
	let errorHint = "";
	let successMessage = "";
	let billingAgreementId = "";
	let agreementDetails = null;
	// Environment the agreement was actually approved in. Vaulting must target the
	// same one - a Braintree gateway can only import agreements from the PayPal
	// account it is linked to, so a flipped toggle looks like an invalid agreement.
	let agreementEnv = null;

	// Vault state
	let vaultLoading = false;
	let vaultResult = null;
	// The merchant account whose linked PayPal account owns the agreement.
	let merchantAccountId = "paypal";
	// Lets an agreement id be vaulted on its own, without re-running the PayPal flow.
	let manualAgreementId = "";

	// The flow's agreement wins; otherwise vault whatever id was pasted in.
	$: vaultTargetId = billingAgreementId || manualAgreementId.trim();

	// Developer logs
	let logs = [];
	let showLogs = false;

	function addLog(label, data, type = 'info') {
		logs = [
			...logs,
			{
				timestamp: new Date().toISOString(),
				label,
				data: typeof data === "string" ? data : JSON.stringify(data, null, 2),
				type, // 'request', 'response', 'error', 'info'
			},
		];
	}

	async function createAgreement() {
		loading = true;
		errorMessage = "";
		successMessage = "";

		try {
			const requestBody = {
				isProduction,
				paypalAccount: paypalAccount !== 'default' ? paypalAccount : undefined,
			};

			addLog("POST /api/billing-agreements/create-token", requestBody, 'request');

			const response = await fetch("/api/billing-agreements/create-token", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(requestBody),
			});

			const data = await response.json();
			addLog("Response /api/billing-agreements/create-token", data, 'response');

			if (!response.ok) {
				throw new Error(data.error || "Failed to create agreement token");
			}

			if (data.approval_url) {
				addLog("Redirecting to PayPal", data.approval_url, 'info');
				// Store token_id, environment, and account preference before redirect
				sessionStorage.setItem("ba_token_id", data.token_id);
				sessionStorage.setItem("ba_isProduction", isProduction.toString());
				sessionStorage.setItem("ba_paypalAccount", paypalAccount);
				window.location.href = data.approval_url;
			} else {
				throw new Error("No approval URL received from PayPal");
			}
		} catch (error) {
			console.error("Error creating agreement:", error);
			errorMessage = error.message;
			addLog("Error", error.message, 'error');
		} finally {
			loading = false;
		}
	}

	async function executeAgreement(token) {
		loading = true;
		errorMessage = "";

		try {
			// Restore environment and account preference from before redirect
			const savedEnv = sessionStorage.getItem("ba_isProduction");
			if (savedEnv !== null) {
				isProduction = savedEnv === "true";
				sessionStorage.removeItem("ba_isProduction");
			}
			const savedAccount = sessionStorage.getItem("ba_paypalAccount");
			if (savedAccount !== null) {
				paypalAccount = savedAccount;
				sessionStorage.removeItem("ba_paypalAccount");
			}

			const requestBody = {
				token,
				isProduction,
				paypalAccount: paypalAccount !== 'default' ? paypalAccount : undefined,
			};
			addLog("POST /api/billing-agreements/execute", requestBody, 'request');

			const response = await fetch("/api/billing-agreements/execute", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(requestBody),
			});

			const data = await response.json();
			addLog("Response /api/billing-agreements/execute", data, 'response');

			if (!response.ok) {
				throw new Error(data.error || "Failed to execute agreement");
			}

			billingAgreementId = data.id;
			agreementDetails = data;
			agreementEnv = isProduction;
			successMessage = `Billing Agreement created: ${billingAgreementId}`;

		} catch (error) {
			console.error("Error executing agreement:", error);
			errorMessage = error.message;
			addLog("Error", error.message, 'error');
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
			addLog("Agreement Cancelled", "User cancelled on PayPal", 'error');
		} else if (approved === "true") {
			// Use the BA- token stored before redirect, not the EC- token from the URL
			const baToken = sessionStorage.getItem("ba_token_id");
			if (baToken) {
				sessionStorage.removeItem("ba_token_id");
				addLog("Return from PayPal", { token: baToken, approved }, 'info');
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
		errorMessage = "";
		errorHint = "";

		try {
			// A pasted id carries no known environment, so fall back to the toggle.
			const vaultEnv = billingAgreementId ? (agreementEnv ?? isProduction) : isProduction;
			const requestBody = {
				billingAgreementId: vaultTargetId,
				isProduction: vaultEnv,
				paypalAccount: paypalAccount !== 'default' ? paypalAccount : undefined,
			};
			if (merchantAccountId.trim()) {
				requestBody.merchantAccountId = merchantAccountId.trim();
			}
			addLog("GraphQL: createCustomer + vaultPayPalBillingAgreement", requestBody, 'request');

			const response = await fetch("/api/billing-agreements/vault", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(requestBody),
			});

			const data = await response.json();

			// Log each GraphQL mutation separately
			if (data.mutations) {
				data.mutations.forEach((m) => {
					addLog(`GraphQL: ${m.mutation}`, m.request, 'request');
					addLog(`GraphQL: ${m.mutation}`, m.response, 'response');
				});
			} else {
				addLog("GraphQL: vaultPayPalBillingAgreement", data, 'response');
			}

			if (!response.ok) {
				errorHint = data.hint || "";
				if (errorHint) addLog("Diagnosis", errorHint, 'error');
				throw new Error(data.error || "Failed to vault billing agreement");
			}

			vaultResult = {
				...data.paymentMethod,
			};

			// Pre-fill charge token fields from vault result
			if (vaultResult.id) {
				chargeTokenId = vaultResult.id;
			}
			if (merchantAccountId.trim()) {
				chargeMerchantAccountId = merchantAccountId.trim();
			}
		} catch (error) {
			console.error("Error vaulting agreement:", error);
			errorMessage = error.message;
			addLog("Error (vault)", error.message, 'error');
		} finally {
			vaultLoading = false;
		}
	}

	// Charge Token State
	let chargeTokenId = '';
	let chargeAmount = '1.00';
	let chargeMerchantAccountId = '';
	let chargeResult = null;
	let chargeError = '';
	let chargingToken = false;

	async function chargeStoredToken() {
		chargingToken = true;
		chargeResult = null;
		chargeError = '';

		try {
			const requestBody = {
				paymentMethodId: chargeTokenId,
				amount: chargeAmount,
				isProduction,
			};
			if (chargeMerchantAccountId.trim()) {
				requestBody.merchantAccountId = chargeMerchantAccountId.trim();
			}
			addLog("GraphQL: chargePaymentMethod", requestBody, 'request');

			const response = await fetch('/api/billing-agreements/charge-token', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(requestBody)
			});

			const data = await response.json();
			addLog("GraphQL: chargePaymentMethod", data, 'response');

			if (!response.ok) {
				throw new Error(data.error || 'Charge failed');
			}

			chargeResult = data;
		} catch (error) {
			chargeError = error.message;
			addLog("Error (charge)", error.message, 'error');
		} finally {
			chargingToken = false;
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

				<!-- PayPal Account Selector -->
				<div class="bg-white rounded-md p-3 border border-gray-200">
					<label for="paypalAccountSelect" class="block text-sm font-semibold text-gray-700 mb-1">PayPal Account</label>
					<select
						id="paypalAccountSelect"
						bind:value={paypalAccount}
						class="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
					>
						<option value="default">Default (USD)</option>
						<option value="jpy">JPY</option>
					</select>
					<p class="text-xs text-gray-500 mt-1">Selects which PayPal REST app credentials to use for billing agreement APIs.</p>
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

					</div>
				{/if}

				<!-- Vault in Braintree -->
				<div class="bg-white rounded-lg border border-gray-200 p-4">
					<div class="flex items-center gap-3 mb-4">
						<div class="text-indigo-600">
							<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
							</svg>
						</div>
						<div>
							<h3 class="text-base font-bold text-gray-900">Vault in Braintree</h3>
							<p class="text-xs text-gray-500">Imports the agreement via vaultPayPalBillingAgreement</p>
						</div>
					</div>

					<div class="space-y-3">
						<div>
							<label for="vaultAgreementId" class="block text-xs font-semibold text-gray-700 mb-1">Billing Agreement ID</label>
							{#if billingAgreementId}
								<div class="w-full px-3 py-2 text-sm border border-gray-200 rounded bg-gray-50">
									<code class="font-mono text-xs">{billingAgreementId}</code>
								</div>
							{:else}
								<input
									id="vaultAgreementId"
									type="text"
									bind:value={manualAgreementId}
									placeholder="B-XXXXXXXXXXXXXXXXX"
									class="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white font-mono"
								/>
								<p class="text-xs text-gray-500 mt-1">Paste an existing agreement to vault it without re-running the PayPal flow.</p>
							{/if}
						</div>

						<div>
							<label for="vaultMerchantAccount" class="block text-xs font-semibold text-gray-700 mb-1">Merchant Account ID</label>
							<input
								id="vaultMerchantAccount"
								type="text"
								bind:value={merchantAccountId}
								placeholder="Gateway default"
								class="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white font-mono"
							/>
							<p class="text-xs text-gray-500 mt-1">The merchant account whose PayPal link owns the agreement. Required if the gateway default doesn't have the right PayPal link.</p>
						</div>

						{#if billingAgreementId && agreementEnv !== null && agreementEnv !== isProduction}
							<p class="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
								This agreement was approved in <strong>{agreementEnv ? "PRODUCTION" : "SANDBOX"}</strong>, so it will be vaulted against
								the {agreementEnv ? "production" : "sandbox"} Braintree gateway regardless of the toggle above.
							</p>
						{/if}

						<button
							on:click={vaultInBraintree}
							disabled={vaultLoading || !vaultTargetId}
							class="w-full px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-semibold rounded-lg transition-colors text-sm"
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

						<!-- Vault Result -->
						{#if vaultResult}
							<div class="pt-3 border-t border-gray-100">
								<p class="text-xs font-bold text-indigo-800 mb-2">Braintree Vault Result</p>
								<div class="bg-white border border-indigo-100 rounded p-2 space-y-1">
									<p class="text-xs">
										<span class="font-semibold text-gray-700">Payment Method ID:</span>
										<code class="bg-indigo-50 px-1.5 py-0.5 rounded font-mono text-xs ml-1">{vaultResult.id}</code>
									</p>
									{#if vaultResult.legacyId}
										<p class="text-xs">
											<span class="font-semibold text-gray-700">Payment Method Token:</span>
											<code class="bg-indigo-50 px-1.5 py-0.5 rounded font-mono text-xs ml-1">{vaultResult.legacyId}</code>
										</p>
									{/if}
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

							</div>
						{/if}
					</div>
				</div>

				<!-- Charge Stored Token -->
				{#if vaultResult?.id}
					<div class="bg-white rounded-lg border border-purple-200 p-4">
						<div class="flex items-center gap-3 mb-4">
							<div class="text-purple-600">
								<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
								</svg>
							</div>
							<div>
								<h3 class="text-base font-bold text-gray-900">Charge Stored Token</h3>
								<p class="text-xs text-gray-500">Merchant-initiated transaction using the vaulted payment method</p>
							</div>
						</div>

						<div class="space-y-3">
							<div>
								<label for="chargeToken" class="block text-xs font-semibold text-gray-600 mb-1">Payment Method ID (GraphQL)</label>
								<input
									id="chargeToken"
									type="text"
									bind:value={chargeTokenId}
									class="w-full px-3 py-2 border border-gray-300 rounded text-sm font-mono bg-gray-50"
								/>
							</div>
							<div class="grid grid-cols-2 gap-3">
								<div>
									<label for="chargeAmount" class="block text-xs font-semibold text-gray-600 mb-1">Amount (USD)</label>
									<input
										id="chargeAmount"
										type="text"
										bind:value={chargeAmount}
										class="w-full px-3 py-2 border border-gray-300 rounded text-sm"
									/>
								</div>
								<div>
									<label for="chargeMerchantAccount" class="block text-xs font-semibold text-gray-600 mb-1">Merchant Account ID</label>
									<input
										id="chargeMerchantAccount"
										type="text"
										bind:value={chargeMerchantAccountId}
										placeholder="Gateway default"
										class="w-full px-3 py-2 border border-gray-300 rounded text-sm font-mono"
									/>
								</div>
							</div>

							<button
								on:click={chargeStoredToken}
								disabled={chargingToken || !chargeTokenId}
								class="w-full px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300 text-white font-semibold rounded-lg transition-colors text-sm"
							>
								{#if chargingToken}
									<span class="flex items-center justify-center gap-2">
										<svg class="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
											<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
											<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
										</svg>
										Charging...
									</span>
								{:else}
									Charge Token
								{/if}
							</button>

							{#if chargeResult}
								<div class="p-3 bg-green-50 border border-green-200 rounded text-sm space-y-1">
									<div class="flex justify-between items-center">
										<span class="font-semibold text-gray-700">Status:</span>
										<span class="bg-green-100 text-green-800 px-2 py-0.5 rounded text-xs font-semibold">{chargeResult.status}</span>
									</div>
									<div class="flex justify-between items-center">
										<span class="font-semibold text-gray-700">Transaction ID:</span>
										<code class="bg-gray-100 px-2 py-0.5 rounded font-mono text-xs">{chargeResult.transactionId}</code>
									</div>
									<div class="flex justify-between items-center">
										<span class="font-semibold text-gray-700">Amount:</span>
										<span class="text-xs">${chargeResult.amount}</span>
									</div>
									{#if chargeResult.merchantAccountId}
										<div class="flex justify-between items-center">
											<span class="font-semibold text-gray-700">Merchant Account:</span>
											<code class="bg-gray-100 px-2 py-0.5 rounded font-mono text-xs">{chargeResult.merchantAccountId}</code>
										</div>
									{/if}
								</div>
							{/if}

							{#if chargeError}
								<div class="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
									{chargeError}
								</div>
							{/if}
						</div>
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
						{#if errorHint}
							<div class="mt-3 pt-3 border-t border-red-200">
								<p class="text-xs font-bold text-red-800 mb-1">Likely cause</p>
								<p class="text-xs text-red-700 leading-relaxed">{errorHint}</p>
							</div>
						{/if}
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
						<div class="px-4 pb-4 border-t border-gray-100 space-y-1.5">
							{#if logs.length === 0}
								<p class="text-xs text-gray-500 py-2">No logs yet. Create an agreement to see API interactions.</p>
							{:else}
								{#each logs as log}
									<div class="rounded p-2.5 border {
										log.type === 'request' ? 'bg-blue-50 border-blue-200' :
										log.type === 'response' ? 'bg-emerald-50 border-emerald-200' :
										log.type === 'error' ? 'bg-red-50 border-red-200' :
										'bg-gray-50 border-gray-200'
									}">
										<div class="flex items-center justify-between mb-1.5">
											<div class="flex items-center gap-2">
												<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide {
													log.type === 'request' ? 'bg-blue-200 text-blue-800' :
													log.type === 'response' ? 'bg-emerald-200 text-emerald-800' :
													log.type === 'error' ? 'bg-red-200 text-red-800' :
													'bg-gray-200 text-gray-700'
												}">
													{log.type === 'request' ? 'REQ' : log.type === 'response' ? 'RES' : log.type === 'error' ? 'ERR' : 'INFO'}
												</span>
												<span class="text-xs font-semibold {
													log.type === 'error' ? 'text-red-800' : 'text-gray-800'
												}">{log.label}</span>
											</div>
											<span class="text-[10px] text-gray-400 font-mono">{log.timestamp.split("T")[1].split(".")[0]}</span>
										</div>
										<pre class="text-xs overflow-x-auto whitespace-pre-wrap break-all leading-relaxed {
											log.type === 'request' ? 'text-blue-900' :
											log.type === 'response' ? 'text-emerald-900' :
											log.type === 'error' ? 'text-red-700' :
											'text-gray-600'
										}">{log.data}</pre>
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
