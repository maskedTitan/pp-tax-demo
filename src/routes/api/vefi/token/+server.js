import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

const CREATE_CLIENT_TOKEN = `
  mutation CreateClientToken($input: CreateClientTokenInput!) {
    createClientToken(input: $input) { clientToken }
  }`;

/**
 * GET /api/vefi/token?paymentMethodToken=<PMT>
 * Mints a client token scoped to a specific saved payment method (version: 3).
 * Required for Flow 2 (returning buyer) — the SavedPaymentMethods component
 * only renders the correct saved instrument when the token is PMT-scoped.
 */
export async function GET({ url }) {
    const paymentMethodToken = url.searchParams.get('paymentMethodToken');
    if (!paymentMethodToken) {
        return json({ error: 'paymentMethodToken query param is required' }, { status: 400 });
    }

    try {
        const basicAuth = Buffer
            .from(`${env.BRAINTREE_PUBLIC_KEY}:${env.BRAINTREE_PRIVATE_KEY}`)
            .toString('base64');

        const res = await fetch('https://payments.sandbox.braintree-api.com/graphql', {
            method: 'POST',
            headers: {
                Authorization: `Basic ${basicAuth}`,
                'Braintree-Version': '2019-01-01',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                query: CREATE_CLIENT_TOKEN,
                variables: {
                    input: {
                        clientToken: {
                            version: 3,
                            paymentMethodId: paymentMethodToken
                        }
                    }
                },
            }),
        });

        const data = await res.json();
        const clientToken = data.data?.createClientToken?.clientToken;

        if (!clientToken) {
            return json(
                { error: data.errors?.[0]?.message ?? 'Failed to generate PMT-scoped client token', details: data },
                { status: 400 }
            );
        }

        // Decode the client token to verify paymentMethodIdJwt is present.
        // This JWT is what drives the edit-FI pencil in SavedPaymentMethods.
        let tokenDebug = {};
        try {
            const decoded = JSON.parse(Buffer.from(clientToken, 'base64').toString('utf-8'));
            tokenDebug = {
                version: decoded.version ?? null,
                hasPaymentMethodIdJwt: !!decoded.paymentMethodIdJwt,
                hasAuthorizationFingerprint: !!decoded.authorizationFingerprint,
                paypalClientId: decoded.paypalClientId ?? null,
            };
        } catch { /* ignore decode errors */ }

        return json({ clientToken, tokenDebug });
    } catch (error) {
        return json({ error: error.message }, { status: 500 });
    }
}
