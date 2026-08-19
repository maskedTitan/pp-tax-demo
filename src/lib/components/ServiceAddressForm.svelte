<script>
    export let serviceAddress;
    export let showServiceAddress = false;

    const demoAddresses = [
        {
            label: "California HQ",
            tax: "8.5%",
            address: { firstName: "Elon", lastName: "Musk", houseNumberOrName: "1", street: "Rocket Rd", city: "Hawthorne", stateOrProvince: "CA", postalCode: "90250", country: "US" }
        },
        {
            label: "Texas Starbase",
            tax: "8.0%",
            address: { firstName: "Star", lastName: "Base", houseNumberOrName: "1", street: "Memories Way", city: "Boca Chica", stateOrProvince: "TX", postalCode: "78521", country: "US" }
        },
        {
            label: "Florida Pad",
            tax: "7.0%",
            address: { firstName: "Launch", lastName: "Complex", houseNumberOrName: "39A", street: "Space Center", city: "Merritt Island", stateOrProvince: "FL", postalCode: "32899", country: "US" }
        },
        {
            label: "Delaware Office",
            tax: "0%",
            address: { firstName: "John", lastName: "Doe", houseNumberOrName: "1209", street: "Orange St", city: "Wilmington", stateOrProvince: "DE", postalCode: "19801", country: "US" }
        }
    ];
</script>

<div class="bg-white rounded-lg border border-gray-200 overflow-hidden">
    <button onclick={() => (showServiceAddress = !showServiceAddress)} class="w-full p-4 flex items-center justify-between text-left hover:bg-gray-50 transition-colors">
        <div class="flex items-center gap-3">
            <div class="text-orange-600">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
            </div>
            <h4 class="font-bold text-gray-900 text-sm">Service Address</h4>
        </div>
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-400 transition-transform {showServiceAddress ? 'rotate-180' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
    </button>

    {#if showServiceAddress}
        <div class="px-4 pb-4 border-t border-gray-100 pt-3">
            <div class="mb-4">
                <p class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Quick Fill Demos</p>
                <div class="grid grid-cols-2 gap-2">
                    {#each demoAddresses as demo}
                        <button 
                            type="button" 
                            class="text-left p-3 border {serviceAddress.stateOrProvince === demo.address.stateOrProvince ? 'border-orange-400 bg-orange-50' : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'} rounded-lg transition-colors"
                            onclick={() => serviceAddress = { ...demo.address }}
                        >
                            <div class="flex justify-between items-center mb-1">
                                <span class="font-bold text-gray-900 text-xs">{demo.label}</span>
                                <span class="text-[10px] font-bold px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">{demo.tax} Tax</span>
                            </div>
                            <div class="text-xs text-gray-500 truncate">{demo.address.city}, {demo.address.stateOrProvince}</div>
                        </button>
                    {/each}
                </div>
            </div>
            <div class="grid grid-cols-1 gap-3">
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label for="firstName" class="block text-xs font-semibold text-gray-700 mb-1">First Name</label>
                        <input id="firstName" class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm" type="text" bind:value={serviceAddress.firstName} />
                    </div>
                    <div>
                        <label for="lastName" class="block text-xs font-semibold text-gray-700 mb-1">Last Name</label>
                        <input id="lastName" class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm" type="text" bind:value={serviceAddress.lastName} />
                    </div>
                </div>
                <div class="grid grid-cols-4 gap-3">
                    <div>
                        <label for="houseNumber" class="block text-xs font-semibold text-gray-700 mb-1">Number</label>
                        <input id="houseNumber" class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm" type="text" bind:value={serviceAddress.houseNumberOrName} />
                    </div>
                    <div class="col-span-3">
                        <label for="street" class="block text-xs font-semibold text-gray-700 mb-1">Street</label>
                        <input id="street" class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm" type="text" bind:value={serviceAddress.street} />
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label for="city" class="block text-xs font-semibold text-gray-700 mb-1">City</label>
                        <input id="city" class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm" type="text" bind:value={serviceAddress.city} />
                    </div>
                    <div>
                        <label for="postalCode" class="block text-xs font-semibold text-gray-700 mb-1">Postal Code</label>
                        <input id="postalCode" class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm" type="text" bind:value={serviceAddress.postalCode} />
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label for="state" class="block text-xs font-semibold text-gray-700 mb-1">State</label>
                        <input id="state" class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm uppercase" type="text" bind:value={serviceAddress.stateOrProvince} maxlength="2" />
                    </div>
                    <div>
                        <label for="country" class="block text-xs font-semibold text-gray-700 mb-1">Country</label>
                        <input id="country" class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm uppercase" type="text" bind:value={serviceAddress.country} maxlength="2" />
                    </div>
                </div>
            </div>
        </div>
    {/if}
</div>
