<script>
    export let logs = [];
    export let title = "Developer Logs";

    let showLogs = false;
    let expandedIndices = new Set();

    function toggleExpand(index) {
        if (expandedIndices.has(index)) {
            expandedIndices.delete(index);
        } else {
            expandedIndices.add(index);
        }
        expandedIndices = expandedIndices; // trigger reactivity
    }

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
        if (ts.includes('T')) return ts.split('T')[1].split('.')[0];
        return ts;
    }

    function copyLog(log) {
        const text = log.data
            ? `${log.label}\n${log.data}`
            : log.label;
        navigator.clipboard.writeText(text);
    }

    function copyAllLogs() {
        const text = logs.map((log, i) => {
            const badge = getTypeBadge(log.type);
            const ts = formatTimestamp(log.timestamp);
            let line = `[${i + 1}] ${badge} ${log.label} (${ts})`;
            if (log.data) line += `\n${log.data}`;
            return line;
        }).join('\n\n');
        navigator.clipboard.writeText(text);
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
                    class="text-xs text-blue-500 hover:text-blue-700 transition-colors font-medium"
                    on:click|stopPropagation={copyAllLogs}
                >Copy All</span>
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <span
                    role="button"
                    tabindex="0"
                    class="text-xs text-gray-400 hover:text-gray-700 transition-colors"
                    on:click|stopPropagation={() => { logs = []; expandedIndices = new Set(); }}
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
        <div class="px-4 pb-4 border-t border-gray-100 space-y-1">
            {#if logs.length === 0}
                <p class="text-xs text-gray-500 py-2">No logs yet. Interact with the page to see API activity.</p>
            {:else}
                {#each logs as log, i}
                    {@const hasData = !!log.data}
                    {@const isExpanded = expandedIndices.has(i)}
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <div
                        role="button"
                        tabindex="0"
                        class="rounded border {getBgClass(log.type)} {hasData ? 'cursor-pointer' : ''}"
                        on:click={() => hasData && toggleExpand(i)}
                    >
                        <div class="flex items-center justify-between px-2.5 py-1.5">
                            <div class="flex items-center gap-2 min-w-0">
                                <span class="text-[10px] font-mono text-gray-400 w-5 shrink-0 text-right">{i + 1}</span>
                                <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide shrink-0 {getBadgeClass(log.type)}">
                                    {getTypeBadge(log.type)}
                                </span>
                                <span class="text-xs font-semibold truncate {getLabelClass(log.type)}">{log.label}</span>
                            </div>
                            <div class="flex items-center gap-2 shrink-0 ml-2">
                                <span class="text-[10px] text-gray-400 font-mono">{formatTimestamp(log.timestamp)}</span>
                                {#if hasData}
                                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                                    <span
                                        role="button"
                                        tabindex="0"
                                        class="text-[10px] text-gray-400 hover:text-gray-700"
                                        on:click|stopPropagation={() => copyLog(log)}
                                    >copy</span>
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 text-gray-400 transition-transform {isExpanded ? 'rotate-180' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                                    </svg>
                                {/if}
                            </div>
                        </div>
                        {#if hasData && isExpanded}
                            <div class="px-2.5 pb-2 pt-0">
                                <pre class="text-[11px] overflow-x-auto whitespace-pre-wrap break-all leading-relaxed {getDataClass(log.type)} max-h-80 overflow-y-auto">{log.data}</pre>
                            </div>
                        {/if}
                    </div>
                {/each}
            {/if}
        </div>
    {/if}
</div>
