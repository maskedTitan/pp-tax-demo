import { json } from '@sveltejs/kit';
import { gateway } from '$lib/server/braintree.js';

export async function GET() {
    try {
        const response = await gateway.clientToken.generate({});
        return json({ clientToken: response.clientToken });
    } catch (error) {
        console.error('Error generating client token:', error);
        return json({ error: 'Failed to generate client token' }, { status: 500 });
    }
}
