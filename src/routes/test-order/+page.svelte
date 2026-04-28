<script>
    let orderId = '0TL69747NJ567472R';
    let orderData = null;
    let loading = false;
    let error = null;
    let hasSearched = false;

    async function fetchOrder() {
        if (!orderId.trim()) {
            error = { error: 'Please enter an Order ID' };
            return;
        }

        loading = true;
        error = null;
        orderData = null;
        hasSearched = true;

        try {
            const response = await fetch(`/api/paypal/get-order/${orderId.trim()}`);
            const data = await response.json();

            if (!response.ok) {
                error = data;
            } else {
                orderData = data;
            }
        } catch (err) {
            error = { error: err.message };
        } finally {
            loading = false;
        }
    }

    function handleKeypress(event) {
        if (event.key === 'Enter') {
            fetchOrder();
        }
    }
</script>

<div class="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 py-8">
    <div class="container mx-auto px-8 max-w-5xl">
        <!-- Header -->
        <div class="mb-8">
            <h1 class="text-4xl font-bold text-slate-800 mb-2">PayPal Order Lookup</h1>
            <p class="text-slate-600">Retrieve order details from PayPal Orders v2 API</p>
        </div>

        <!-- Input Card -->
        <div class="bg-white shadow-xl rounded-2xl p-6 mb-6 border border-slate-200/50">
            <div class="flex items-center gap-3 mb-4">
                <div class="bg-gradient-to-br from-blue-500 to-indigo-600 text-white rounded-lg p-2">
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
                            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                        />
                    </svg>
                </div>
                <h2 class="text-2xl font-bold text-slate-800">Search Order</h2>
            </div>

            <div class="space-y-4">
                <div>
                    <label for="orderId" class="block text-sm font-semibold text-slate-700 mb-2">
                        Order ID
                    </label>
                    <input
                        id="orderId"
                        type="text"
                        bind:value={orderId}
                        on:keypress={handleKeypress}
                        placeholder="Enter PayPal Order ID (e.g., 0TL69747NJ567472R)"
                        class="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all bg-slate-50 hover:bg-white font-mono"
                    />
                </div>

                <button
                    on:click={fetchOrder}
                    disabled={loading}
                    class="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:from-slate-400 disabled:to-slate-500 text-white font-bold py-3 px-6 rounded-xl transition-all shadow-md hover:shadow-lg disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                    {#if loading}
                        <svg class="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span>Fetching Order...</span>
                    {:else}
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
                                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                            />
                        </svg>
                        <span>Fetch Order Details</span>
                    {/if}
                </button>
            </div>
        </div>

        <!-- Results -->
        {#if hasSearched}
            {#if error}
                <div class="bg-gradient-to-r from-red-50 to-rose-50 border-2 border-red-400 rounded-2xl p-6 shadow-lg">
                    <div class="flex items-center gap-3 mb-4">
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
                                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                                />
                            </svg>
                        </div>
                        <h2 class="text-xl font-bold text-red-800">Error Fetching Order</h2>
                    </div>
                    <div class="bg-white/80 rounded-xl p-4 shadow-inner">
                        <pre class="text-sm text-red-700 whitespace-pre-wrap overflow-x-auto font-mono">{JSON.stringify(error, null, 2)}</pre>
                    </div>
                </div>
            {:else if orderData}
                <div class="bg-gradient-to-r from-emerald-50 to-teal-50 border-2 border-emerald-400 rounded-2xl p-6 shadow-lg">
                    <div class="flex items-center gap-3 mb-4">
                        <div class="bg-emerald-500 text-white rounded-full p-2">
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
                                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                                />
                            </svg>
                        </div>
                        <div>
                            <h2 class="text-xl font-bold text-emerald-800">Order Retrieved Successfully</h2>
                            <p class="text-sm text-emerald-700">Order ID: {orderId}</p>
                        </div>
                    </div>

                    <!-- Key Info -->
                    {#if orderData.status || orderData.intent || orderData.id}
                        <div class="bg-white/80 rounded-xl p-5 shadow-inner mb-4 border border-emerald-200">
                            <h3 class="font-bold text-slate-800 mb-3 flex items-center gap-2">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                Order Summary
                            </h3>
                            <div class="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                                {#if orderData.id}
                                    <div>
                                        <span class="font-semibold text-slate-700">Order ID:</span>
                                        <p class="font-mono text-slate-600 mt-1">{orderData.id}</p>
                                    </div>
                                {/if}
                                {#if orderData.status}
                                    <div>
                                        <span class="font-semibold text-slate-700">Status:</span>
                                        <p class="mt-1">
                                            <span class="inline-block px-3 py-1 rounded-full text-xs font-semibold {orderData.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700' : orderData.status === 'APPROVED' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}">
                                                {orderData.status}
                                            </span>
                                        </p>
                                    </div>
                                {/if}
                                {#if orderData.intent}
                                    <div>
                                        <span class="font-semibold text-slate-700">Intent:</span>
                                        <p class="mt-1">
                                            <span class="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-purple-100 text-purple-700">
                                                {orderData.intent}
                                            </span>
                                        </p>
                                    </div>
                                {/if}
                            </div>
                        </div>
                    {/if}

                    <!-- Full JSON Response -->
                    <div class="bg-white/80 rounded-xl p-5 shadow-inner border border-emerald-200">
                        <h3 class="font-bold text-slate-800 mb-3 flex items-center gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                            </svg>
                            Full Response
                        </h3>
                        <div class="bg-slate-900 rounded-lg p-4 overflow-x-auto">
                            <pre class="text-xs font-mono text-emerald-400">{JSON.stringify(orderData, null, 2)}</pre>
                        </div>
                    </div>
                </div>
            {/if}
        {/if}
    </div>
</div>
