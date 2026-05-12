import { json } from '@sveltejs/kit';
import { getPaymentMethodToken, setPaymentMethodToken, clearPaymentMethodToken } from '$lib/server/vaultSession.js';

export async function GET() {
    const token = getPaymentMethodToken();
    return json({ paymentMethodToken: token });
}

export async function POST({ request }) {
    const { paymentMethodToken } = await request.json();
    if (!paymentMethodToken) {
        return json({ error: 'paymentMethodToken is required' }, { status: 400 });
    }
    setPaymentMethodToken(paymentMethodToken);
    return json({ success: true });
}

export async function DELETE() {
    clearPaymentMethodToken();
    return json({ success: true });
}
