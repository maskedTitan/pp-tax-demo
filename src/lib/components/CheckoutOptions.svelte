<script>
    export let showCheckoutOptions = true;
    export let disableShipping = false;
    export let isRecurring = false;
    export let zeroDollarAuth = false;
    export let showZeroDollarAuth = true;
    export let useServiceAddress = true;
    export let lockAddress = false;
    export let enableSessionTimeout = false;
    export let TIMEOUT_SECONDS = 30;
    export let providerName = "config";
</script>

<div class="bg-white rounded-lg border border-gray-200 overflow-hidden">
    <button onclick={() => (showCheckoutOptions = !showCheckoutOptions)} class="w-full p-4 flex items-center justify-between text-left hover:bg-gray-50 transition-colors">
        <div class="flex items-center gap-3">
            <div class="text-blue-600">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                </svg>
            </div>
            <h3 class="font-bold text-gray-900 text-sm">Checkout Options ({providerName})</h3>
        </div>
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-400 transition-transform {showCheckoutOptions ? 'rotate-180' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
    </button>

    {#if showCheckoutOptions}
        <div class="px-4 pb-4 border-t border-gray-100 pt-2 space-y-2">
            <label class="flex items-center p-2 rounded hover:bg-gray-50 cursor-pointer">
                <input type="checkbox" bind:checked={disableShipping} class="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 border-gray-300" />
                <div class="ml-3">
                    <span class="block text-sm font-medium text-gray-900">Disable Shipping Address</span>
                    <p class="text-xs text-gray-500">Hide address in checkout</p>
                </div>
            </label>
            
            <label class="flex items-center p-2 rounded hover:bg-gray-50 cursor-pointer">
                <input type="checkbox" bind:checked={isRecurring} class="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 border-gray-300" />
                <div class="ml-3">
                    <span class="block text-sm font-medium text-gray-900">Subscribe (Recurring / Vault)</span>
                    <p class="text-xs text-gray-500">Save payment for future</p>
                </div>
            </label>

            {#if showZeroDollarAuth}
            <label class="flex items-center p-2 rounded hover:bg-gray-50 cursor-pointer pl-6">
                <input type="checkbox" bind:checked={zeroDollarAuth} class="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 border-gray-300" />
                <div class="ml-3">
                    <span class="block text-sm font-medium text-gray-900">$0 Auth (Vault Only)</span>
                    <p class="text-xs text-gray-500">Save without charging up front</p>
                </div>
            </label>
            {/if}

            <label class="flex items-center p-2 rounded hover:bg-gray-50 cursor-pointer">
                <input type="checkbox" bind:checked={useServiceAddress} class="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 border-gray-300" />
                <div class="ml-3">
                    <span class="block text-sm font-medium text-gray-900">Include Service Address</span>
                    <p class="text-xs text-gray-500">Prefill address in PayPal</p>
                </div>
            </label>

            {#if useServiceAddress}
                <label class="flex items-center p-2 rounded hover:bg-gray-50 cursor-pointer pl-6">
                    <input type="checkbox" bind:checked={lockAddress} class="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 border-gray-300" />
                    <div class="ml-3">
                        <span class="block text-sm font-medium text-gray-900">Lock Address</span>
                        <p class="text-xs text-gray-500">Prevent editing in popup</p>
                    </div>
                </label>
            {/if}

            <div class="border-t border-gray-200 my-3 pt-3">
                <p class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Session Timeout</p>
            </div>

            <label class="flex items-center p-2 rounded hover:bg-gray-50 cursor-pointer">
                <input type="checkbox" bind:checked={enableSessionTimeout} class="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 border-gray-300" />
                <div class="ml-3">
                    <span class="block text-sm font-medium text-gray-900">Enable Session Timeout</span>
                    <p class="text-xs text-gray-500">Expire checkout after {TIMEOUT_SECONDS} seconds</p>
                </div>
            </label>
        </div>
    {/if}
</div>
