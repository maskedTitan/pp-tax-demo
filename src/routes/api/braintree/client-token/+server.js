import { json } from '@sveltejs/kit';
import { gateway } from '$lib/server/braintree.js';

export async function GET({ url }) {
    try {
        const paymentMethodToken = url.searchParams.get('paymentMethodToken');
        const options = paymentMethodToken ? { paymentMethodToken } : {};
        const response = await gateway.clientToken.generate(options);
        return json({ clientToken: response.clientToken });
    } catch (error) {
        console.error('Error generating client token:', error.message, error.type);
        return json({ error: error.message || 'Failed to generate client token' }, { status: 500 });
    }
}
