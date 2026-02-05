import { json } from '@sveltejs/kit';
import { adyenRequest } from '$lib/server/adyen.js';

/**
 * POST /api/adyen/payments/details
 * Submits payment details (from 3DS, PayPal, etc.) to Adyen
 */
export async function POST({ request }) {
    try {
        const body = await request.json();
        const { data, checkoutStartTime, timeoutMinutes } = body;

        // Server-side session timeout validation
        if (checkoutStartTime && timeoutMinutes) {
            const elapsed = Date.now() - checkoutStartTime;
            const timeoutMs = timeoutMinutes * 60 * 1000;

            if (elapsed > timeoutMs) {
                const elapsedMinutes = Math.floor(elapsed / 60000);
                console.log(`[Session] Payment rejected - checkout session expired. Elapsed: ${elapsedMinutes} min, Timeout: ${timeoutMinutes} min`);

                return json(
                    {
                        error: 'Checkout session expired',
                        resultCode: 'SESSION_EXPIRED',
                        message: `Your checkout session has expired after ${timeoutMinutes} minutes. Please start a new checkout.`,
                        elapsedMinutes,
                        timeoutMinutes
                    },
                    { status: 400 }
                );
            }

            console.log(`[Session] Payment within timeout. Elapsed: ${Math.floor(elapsed / 60000)} min, Timeout: ${timeoutMinutes} min`);
        }

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
