<script>
	import favicon from "$lib/assets/favicon.svg";
	import { page } from "$app/stores";

	let { children } = $props();

	const currentPath = $derived($page.url.pathname);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<nav class="bg-white border-b border-gray-200 sticky top-0 z-50">
	<div class="container mx-auto px-6 py-4">
		<div class="flex justify-between items-center">
			<!-- Logo/Brand -->
			<div class="flex items-center gap-3">
				<div class="text-blue-600">
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
							d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"
						/>
					</svg>
				</div>
			</div>

			<!-- Navigation Links -->
			<div class="flex items-center gap-2">
				<a
					href="/"
					class="flex items-center gap-2 px-4 py-2 rounded-md transition-all duration-200 {currentPath ===
					'/'
						? 'bg-blue-50 text-blue-700'
						: 'text-gray-600 hover:bg-gray-50'}"
				>
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
							d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
						/>
					</svg>
					<span class="font-semibold">Direct PayPal</span>
				</a>
				<a
					href="/adyen"
					class="flex items-center gap-2 px-4 py-2 rounded-md transition-all duration-200 {currentPath ===
					'/adyen'
						? 'bg-blue-50 text-blue-700'
						: 'text-gray-600 hover:bg-gray-50'}"
				>
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
							d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
						/>
					</svg>
					<span class="font-semibold">Adyen PayPal</span>
				</a>
			</div>
		</div>
	</div>
</nav>

{@render children()}
