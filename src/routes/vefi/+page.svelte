<script>
	import { onMount } from 'svelte';
	import DeveloperLogs from '$lib/components/DeveloperLogs.svelte';

	const BETA_BASE = 'https://js.braintreegateway.com/web/3.142.0-beta-editfi.1/js';

	// Flow state — determined on mount from sessionStorage
	let flowMode = 'flow1'; // 'flow1' | 'flow2'
	let amount = '49.99';

	// Saved payment method (persisted in sessionStorage)
	let savedToken = null;
	let customerId = null;

	// UI state
	let sdkReady = false;
	let sdkError = '';
	let renderLoading = false;
	let reorderLoading = false;
	let errorMessage = '';
	let lastResult = null;

	// Developer logs
	let logs = [];

	function addLog(label, data, type = 'info') {
		logs = [
			...logs,
			{
				timestamp: new Date().toISOString(),
				label,
				data: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
				type,
			},
		];
	}

	function loadScript(src) {
		return new Promise((resolve, reject) => {
			const existing = document.querySelector(`script[src="${src}"]`);
			if (existing) { resolve(); return; }
			const s = document.createElement('script');
			s.src = src;
			s.onload = resolve;
			s.onerror = () => reject(new Error(`Failed to load: ${src}`));
			document.head.appendChild(s);
		});
	}

	onMount(async () => {
		const storedToken = sessionStorage.getItem('vefi_pmt');
		const storedCustomer = sessionStorage.getItem('vefi_customer_id');
		if (storedToken) {
			savedToken = storedToken;
			customerId = storedCustomer || null;
			flowMode = 'flow2';
		}

		try {
			await loadScript(`${BETA_BASE}/client.min.js`);
			await loadScript(`${BETA_BASE}/paypal-checkout.min.js`);
			sdkReady = true;
			addLog('SDK ready', 'braintree-web 3.142.0-beta-editfi.1 loaded from CDN', 'info');
			await initFlow();
		} catch (err) {
			sdkError = err.message;
			addLog('SDK load failed', err.message, 'error');
		}
	});

	async function initFlow() {
		const container = document.getElementById('bt-container');
		if (container) container.innerHTML = '';
		renderLoading = true;
		errorMessage = '';
		lastResult = null;

		try {
			if (flowMode === 'flow1') {
				await initFlow1();
			} else {
				await initFlow2();
			}
		} catch (err) {
			errorMessage = err.message;
			addLog('Init error', err.message, 'error');
		} finally {
			renderLoading = false;
		}
	}

	async function initFlow1() {
		addLog('GET /api/vefi/client-token', {}, 'request');
		const res = await fetch('/api/vefi/client-token');
		const tokenData = await res.json();
		addLog('Response /api/vefi/client-token', { clientToken: tokenData.clientToken ? '[token]' : null, error: tokenData.error }, 'response');
		if (tokenData.error) throw new Error(tokenData.error);

		const bt = window.braintree;
		const clientInstance = await bt.client.create({ authorization: tokenData.clientToken });
		const paypalCheckout = await bt.paypalCheckout.create({
			client: clientInstance,
			autoSetDataUserIdToken: true,
		});
		await paypalCheckout.loadPayPalSDK({
			vault: true,
			currency: 'USD',
			components: 'buttons,messages,saved-payment-methods',
			env: 'sandbox',
		});
		addLog('loadPayPalSDK', 'Flow 1 — Buttons ready', 'info');

		window.paypal.Buttons({
			fundingSource: window.paypal.FUNDING.PAYPAL,
			createBillingAgreement: () => paypalCheckout.createPayment({
				flow: 'vault',
				enableShippingAddress: false,
				billingAgreementDescription: 'Save PayPal for future payments',
			}),
			onApprove: async (data) => {
				try {
					const tokenized = await paypalCheckout.tokenizePayment(data);
					const { nonce, details } = tokenized;
					addLog('tokenizePayment', { type: tokenized.type, details }, 'info');
					const body = { nonce, amount, billingAgreementId: details?.billingAgreementId ?? null };
					addLog('POST /api/vefi/billing-with-purchase', { amount, billingAgreementId: body.billingAgreementId }, 'request');
					const result = await fetch('/api/vefi/billing-with-purchase', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify(body),
					}).then(r => r.json());
					addLog('Response /api/vefi/billing-with-purchase', result, result.error ? 'error' : 'response');

					if (result.error) { errorMessage = result.error; return; }

					lastResult = result;

					if (result.savedPaymentMethodToken) {
						savedToken = result.savedPaymentMethodToken;
						customerId = result.customerId;
						sessionStorage.setItem('vefi_pmt', savedToken);
						if (customerId) sessionStorage.setItem('vefi_customer_id', customerId);
					}
				} catch (err) {
					errorMessage = err.message;
					addLog('onApprove error', err.message, 'error');
				}
			},
			onCancel: () => addLog('Cancelled', 'Buyer dismissed the paysheet', 'info'),
			onError: (err) => {
				errorMessage = err?.message ?? String(err);
				addLog('Buttons error', errorMessage, 'error');
			},
		}).render('#bt-container');
	}

	async function initFlow2() {
		if (!savedToken) throw new Error('No saved payment method. Complete Flow 1 first.');

		addLog('GET /api/vefi/token', { paymentMethodToken: savedToken }, 'request');
		const res = await fetch(`/api/vefi/token?paymentMethodToken=${encodeURIComponent(savedToken)}`);
		const tokenData = await res.json();
		addLog('Response /api/vefi/token', { clientToken: tokenData.clientToken ? '[token]' : null, error: tokenData.error }, 'response');
		if (tokenData.error) throw new Error(tokenData.error);

		const bt = window.braintree;
		const clientInstance = await bt.client.create({ authorization: tokenData.clientToken });
		const paypalCheckout = await bt.paypalCheckout.create({
			client: clientInstance,
			autoSetDataUserIdToken: true,
		});
		await paypalCheckout.loadPayPalSDK({
			vault: true,
			currency: 'USD',
			intent: 'capture',
			components: 'buttons,messages,saved-payment-methods',
			env: 'sandbox',
		});
		addLog('loadPayPalSDK', 'Flow 2 — SavedPaymentMethods ready', 'info');

		window.paypal.SavedPaymentMethods({
			fundingSource: window.paypal.FUNDING.PAYPAL,
			createOrder: () => paypalCheckout.createPayment({
				flow: 'checkout',
				amount,
				currency: 'USD',
				intent: 'capture',
				editBillingAgreement: true,
			}),
			onApprove: async (data) => {
				try {
					const { nonce } = await paypalCheckout.tokenizePayment(data);
					const body = { paymentMethodNonce: nonce, amount };
					addLog('POST /api/vefi/charge-nonce (Path A)', { amount }, 'request');
					const result = await fetch('/api/vefi/charge-nonce', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify(body),
					}).then(r => r.json());
					addLog('Response /api/vefi/charge-nonce', result, result.error ? 'error' : 'response');
					if (result.error) errorMessage = result.error;
					else lastResult = result;
				} catch (err) {
					errorMessage = err.message;
					addLog('Path A error', err.message, 'error');
				}
			},
		}).render('#bt-container');
	}

	async function reorder() {
		reorderLoading = true;
		errorMessage = '';
		lastResult = null;
		try {
			const body = { paymentMethodToken: savedToken, amount };
			addLog('POST /api/vefi/charge-token (Path B)', { amount }, 'request');
			const result = await fetch('/api/vefi/charge-token', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			}).then(r => r.json());
			addLog('Response /api/vefi/charge-token', result, result.error ? 'error' : 'response');
			if (result.error) errorMessage = result.error;
			else lastResult = result;
		} catch (err) {
			errorMessage = err.message;
			addLog('Path B error', err.message, 'error');
		} finally {
			reorderLoading = false;
		}
	}

	function simulateReturn() {
		window.location.reload();
	}

	function reset() {
		sessionStorage.removeItem('vefi_pmt');
		sessionStorage.removeItem('vefi_customer_id');
		window.location.reload();
	}
</script>

<div class="min-h-screen bg-gray-50 p-6">
	<div class="max-w-5xl mx-auto">

		<!-- Header -->
		<div class="mb-6">
			<h1 class="text-2xl font-bold text-gray-900">Saved Payment Method (VEFI)</h1>
			<p class="text-sm text-gray-500 mt-1">
				Braintree beta SDK <code class="bg-gray-100 px-1 rounded text-xs font-mono">3.142.0-beta-editfi.1</code>
				&nbsp;·&nbsp;
				{#if flowMode === 'flow1'}
					<span class="text-blue-600 font-medium">Flow 1 — First-time buyer</span>
				{:else}
					<span class="text-emerald-600 font-medium">Flow 2 — Returning buyer</span>
				{/if}
			</p>
		</div>

		<!-- SDK error banner -->
		{#if sdkError}
			<div class="mb-4 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
				<strong>SDK failed to load:</strong> {sdkError}
			</div>
		{/if}

		<div class="grid grid-cols-1 md:grid-cols-2 gap-6">

			<!-- Left column: info + controls -->
			<div class="space-y-4">

				<!-- SDK status -->
				<div class="bg-white rounded-lg border border-gray-200 p-4">
					<h2 class="text-sm font-semibold text-gray-700 mb-2">SDK Status</h2>
					<div class="flex items-center gap-2 text-sm">
						<span class={`h-2 w-2 rounded-full ${sdkReady ? 'bg-emerald-500' : sdkError ? 'bg-red-500' : 'bg-amber-400'}`}></span>
						<span class="text-gray-600">
							{sdkReady ? 'Ready' : sdkError ? 'Failed' : 'Loading CDN scripts…'}
						</span>
					</div>
				</div>

				<!-- Flow info -->
				<div class="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
					<h2 class="text-sm font-semibold text-gray-700">Current Flow</h2>
					{#if flowMode === 'flow1'}
						<div class="text-sm text-gray-600 space-y-1">
							<p>1. Buyer approves PayPal payment + billing agreement in one paysheet.</p>
							<p>2. Server calls <code class="bg-gray-100 px-1 rounded font-mono text-xs">transaction.sale</code> with <code class="bg-gray-100 px-1 rounded font-mono text-xs">storeInVaultOnSuccess</code>.</p>
							<p>3. PMT is saved to sessionStorage for Flow 2.</p>
						</div>
					{:else}
						<div class="text-sm text-gray-600 space-y-1">
							<p><strong>Path A</strong> — tap the pencil to change funding instrument. SDK calls <code class="bg-gray-100 px-1 rounded font-mono text-xs">/charge-nonce</code>.</p>
							<p><strong>Path B</strong> — reorder with saved FI. No paysheet. Charges the stored PMT directly via <code class="bg-gray-100 px-1 rounded font-mono text-xs">/charge-token</code>.</p>
						</div>
					{/if}
				</div>

				<!-- Amount -->
				<div class="bg-white rounded-lg border border-gray-200 p-4">
					<label for="amountInput" class="block text-sm font-semibold text-gray-700 mb-1">Amount (USD)</label>
					<input
						id="amountInput"
						type="text"
						bind:value={amount}
						class="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
						placeholder="49.99"
					/>
				</div>

				<!-- Saved payment info (Flow 2) -->
				{#if savedToken}
					<div class="bg-emerald-50 rounded-lg border border-emerald-200 p-4">
						<h2 class="text-sm font-semibold text-emerald-800 mb-2">Saved Payment Method</h2>
						<div class="space-y-1 text-xs font-mono text-emerald-700 break-all">
							<div><span class="text-emerald-500">PMT</span> {savedToken}</div>
							{#if customerId}
								<div><span class="text-emerald-500">Customer</span> {customerId}</div>
							{/if}
						</div>
						<button
							onclick={reset}
							class="mt-3 text-xs text-red-600 hover:text-red-800 underline"
						>
							Clear saved payment (reset to Flow 1)
						</button>
					</div>
				{/if}

				<!-- Path B reorder button (Flow 2 only) -->
				{#if flowMode === 'flow2' && savedToken}
					<div class="bg-white rounded-lg border border-gray-200 p-4">
						<h2 class="text-sm font-semibold text-gray-700 mb-1">Path B — Reorder</h2>
						<p class="text-xs text-gray-500 mb-3">Charge the saved PMT directly. No PayPal paysheet.</p>
						<button
							onclick={reorder}
							disabled={reorderLoading}
							class="w-full py-2 px-4 bg-emerald-600 text-white text-sm font-medium rounded hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
						>
							{reorderLoading ? 'Charging…' : `Reorder $${amount}`}
						</button>
					</div>
				{/if}

				<!-- Post-Flow-1 shortcut -->
				{#if flowMode === 'flow1' && lastResult?.success}
					<div class="bg-blue-50 rounded-lg border border-blue-200 p-4">
						<p class="text-sm text-blue-800 font-medium mb-2">PMT saved. Simulate a return visit?</p>
						<button
							onclick={simulateReturn}
							class="w-full py-2 px-4 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700"
						>
							Reload as returning buyer (Flow 2)
						</button>
					</div>
				{/if}

			</div>

			<!-- Right column: PayPal container + result -->
			<div class="space-y-4">

				<!-- PayPal render area -->
				<div class="bg-white rounded-lg border border-gray-200 p-4">
					<h2 class="text-sm font-semibold text-gray-700 mb-3">
						{flowMode === 'flow1' ? 'PayPal Button' : 'Saved Payment Method (Path A)'}
					</h2>

					{#if renderLoading}
						<div class="flex items-center gap-2 text-sm text-gray-400 py-4">
							<svg class="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
								<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
								<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
							</svg>
							Initializing SDK…
						</div>
					{/if}

					<div id="bt-container"></div>

					{#if errorMessage}
						<div class="mt-3 rounded bg-red-50 border border-red-200 p-3 text-sm text-red-700">
							{errorMessage}
						</div>
					{/if}
				</div>

				<!-- Transaction result -->
				{#if lastResult}
					<div class="bg-white rounded-lg border border-gray-200 p-4">
						<h2 class="text-sm font-semibold text-gray-700 mb-2">Result</h2>
						<dl class="text-sm space-y-1">
							<div class="flex gap-2">
								<dt class="text-gray-500 w-32 shrink-0">Transaction ID</dt>
								<dd class="font-mono text-xs text-gray-800 break-all">{lastResult.transactionId}</dd>
							</div>
							<div class="flex gap-2">
								<dt class="text-gray-500 w-32 shrink-0">Status</dt>
								<dd class="font-medium text-emerald-700">{lastResult.status}</dd>
							</div>
							{#if lastResult.savedPaymentMethodToken}
								<div class="flex gap-2">
									<dt class="text-gray-500 w-32 shrink-0">PMT</dt>
									<dd class="font-mono text-xs text-gray-800 break-all">{lastResult.savedPaymentMethodToken}</dd>
								</div>
							{/if}
							{#if lastResult.customerId}
								<div class="flex gap-2">
									<dt class="text-gray-500 w-32 shrink-0">Customer ID</dt>
									<dd class="font-mono text-xs text-gray-800">{lastResult.customerId}</dd>
								</div>
							{/if}
							{#if lastResult.path}
								<div class="flex gap-2">
									<dt class="text-gray-500 w-32 shrink-0">Path</dt>
									<dd class="font-medium">{lastResult.path === 'A' ? 'A (edited FI)' : 'B (saved FI)'}</dd>
								</div>
							{/if}
						</dl>
					</div>
				{/if}

			</div>
		</div>

		<!-- Developer Logs -->
		<div class="mt-6">
			<DeveloperLogs {logs} title="VEFI Developer Logs" />
		</div>

	</div>
</div>
