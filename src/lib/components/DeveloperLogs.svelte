<script>
    export let logs = [];
    export let title = "Developer Logs";

    let showLogs = false;

    function getTypeBadge(type) {
        switch (type) {
            case 'request': return 'REQ';
            case 'response': return 'RES';
            case 'error': return 'ERR';
            default: return 'INFO';
        }
    }

    function getBgClass(type) {
        switch (type) {
            case 'request': return 'bg-blue-50 border-blue-200';
            case 'response': return 'bg-emerald-50 border-emerald-200';
            case 'error': return 'bg-red-50 border-red-200';
            default: return 'bg-gray-50 border-gray-200';
        }
    }

    function getBadgeClass(type) {
        switch (type) {
            case 'request': return 'bg-blue-200 text-blue-800';
            case 'response': return 'bg-emerald-200 text-emerald-800';
            case 'error': return 'bg-red-200 text-red-800';
            default: return 'bg-gray-200 text-gray-700';
        }
    }

    function getLabelClass(type) {
        return type === 'error' ? 'text-red-800' : 'text-gray-800';
    }

    function getDataClass(type) {
        switch (type) {
            case 'request': return 'text-blue-900';
            case 'response': return 'text-emerald-900';
            case 'error': return 'text-red-700';
            default: return 'text-gray-600';
        }
    }

    function formatTimestamp(ts) {
        if (!ts) return '';
        // Handle ISO strings (2024-01-01T12:34:56.789Z)
        if (ts.includes('T')) return ts.split('T')[1].split('.')[0];
        // Handle locale time strings (12:34:56 PM or 12:34:56)
        return ts;
    }
</script>

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
                <h3 class="text-base font-bold text-gray-900">{title}</h3>
                <p class="text-xs text-gray-500">{logs.length} entries</p>
            </div>
        </div>
        <div class="flex items-center gap-3">
            {#if showLogs && logs.length > 0}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <span
                    role="button"
                    tabindex="0"
                    class="text-xs text-gray-400 hover:text-gray-700 transition-colors"
                    on:click|stopPropagation={() => (logs = [])}
                >Clear</span>
            {/if}
            <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-5 w-5 text-gray-400 transition-transform {showLogs ? 'rotate-180' : ''}"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
            >
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
            </svg>
        </div>
    </button>
    {#if showLogs}
        <div class="px-4 pb-4 border-t border-gray-100 space-y-1.5">
            {#if logs.length === 0}
                <p class="text-xs text-gray-500 py-2">No logs yet. Interact with the page to see API activity.</p>
            {:else}
                {#each logs as log}
                    <div class="rounded p-2.5 border {getBgClass(log.type)}">
                        <div class="flex items-center justify-between mb-1.5">
                            <div class="flex items-center gap-2">
                                <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide {getBadgeClass(log.type)}">
                                    {getTypeBadge(log.type)}
                                </span>
                                <span class="text-xs font-semibold {getLabelClass(log.type)}">{log.label}</span>
                            </div>
                            <span class="text-[10px] text-gray-400 font-mono">{formatTimestamp(log.timestamp)}</span>
                        </div>
                        {#if log.data}
                            <pre class="text-xs overflow-x-auto whitespace-pre-wrap break-all leading-relaxed {getDataClass(log.type)}">{log.data}</pre>
                        {/if}
                    </div>
                {/each}
            {/if}
        </div>
    {/if}
</div>
