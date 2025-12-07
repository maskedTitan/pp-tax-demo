import { json } from '@sveltejs/kit';
import { getPayPalOrder } from '$lib/paypal.js';

/**
 * GET /api/paypal/get-order/[orderId]
 * Retrieves order details from PayPal Orders v2 API
 */
export async function GET({ params, url }) {
    try {
        const { orderId } = params;
        const isProduction = url.searchParams.get('isProduction') === 'true';

        const orderData = await getPayPalOrder(orderId, isProduction);

        return json(orderData, { status: 200 });
    } catch (error) {
        console.error('Error fetching PayPal order:', error);
        return json(
            {
                error: error.message || 'Failed to fetch order details'
            },
            { status: 500 }
        );
    }
}
