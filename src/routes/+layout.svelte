<script>
	import favicon from "$lib/assets/favicon.svg";

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<nav class="bg-gray-800 text-white p-4 mb-4">
	<div class="container mx-auto flex justify-between items-center">
		<div class="text-xl font-bold">SpaceX PP</div>
		<div class="space-x-4">
			<a href="/" class="hover:text-gray-300">Direct PayPal</a>
			<a href="/adyen" class="hover:text-gray-300">Adyen PayPal</a>
		</div>
	</div>
</nav>

{@render children()}
