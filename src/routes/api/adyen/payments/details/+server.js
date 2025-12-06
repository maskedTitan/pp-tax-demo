import { json } from '@sveltejs/kit';
import { adyenRequest } from '$lib/server/adyen.js';

/**
 * POST /api/adyen/payments/details
 * Submits payment details (from 3DS, PayPal, etc.) to Adyen
 */
export async function POST({ request }) {
    try {
        const body = await request.json();
        const { data } = body; // state.data from frontend onAdditionalDetails

        const response = await adyenRequest('/payments/details', data);

        return json(response);
    } catch (error) {
        console.error('Adyen Payment Details Error:', error);
        return json(
            {
                error: error.message || 'Payment details submission failed'
            },
            { status: 500 }
        );
    }
}
