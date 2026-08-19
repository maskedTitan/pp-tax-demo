<script>
    export let developerLogs = [];
    export let showJson = false;
</script>

<div class="mt-6 bg-gray-900 rounded-lg overflow-hidden border border-gray-800 shadow-xl">
    <div class="p-4 border-b border-gray-800 flex justify-between items-center bg-gray-950">
        <h3 class="font-mono text-sm font-bold text-green-400 flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Developer Logs
        </h3>
        <div class="flex items-center gap-3">
            <label class="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                <input type="checkbox" bind:checked={showJson} class="rounded bg-gray-800 border-gray-700 text-green-500 focus:ring-green-500 focus:ring-offset-gray-900">
                Show JSON
            </label>
            <button onclick={() => developerLogs = []} class="text-xs text-gray-500 hover:text-white transition-colors flex items-center gap-1">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Clear
            </button>
        </div>
    </div>
    <div class="bg-black p-4 h-[400px] overflow-y-auto font-mono text-xs">
        {#if developerLogs.length === 0}
            <div class="text-gray-600 italic text-center mt-10">No logs yet. Interact with the checkout to see events.</div>
        {:else}
            <div class="space-y-3">
                {#each developerLogs as log}
                    <div class="border-l-2 border-green-500 pl-3 py-1">
                        <div class="text-gray-500 text-[10px] mb-1">{log.timestamp}</div>
                        <div class="text-green-300 font-bold mb-1">> {log.step || log.message}</div>
                        {#if log.data}
                            {#if showJson}
                                <pre class="text-gray-400 bg-gray-900 p-2 rounded mt-1 overflow-x-auto border border-gray-800">{JSON.stringify(log.data, null, 2)}</pre>
                            {:else}
                                <div class="text-gray-400 truncate w-full hover:text-clip hover:whitespace-normal transition-all">{JSON.stringify(log.data)}</div>
                            {/if}
                        {/if}
                    </div>
                {/each}
            </div>
        {/if}
    </div>
</div>
