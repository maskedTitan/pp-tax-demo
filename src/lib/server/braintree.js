import braintree from 'braintree';
import { env } from '$env/dynamic/private';

export const gateway = new braintree.BraintreeGateway({
    environment: braintree.Environment.Sandbox,
    merchantId: env.BRAINTREE_MERCHANT_ID,
    publicKey: env.BRAINTREE_PUBLIC_KEY,
    privateKey: env.BRAINTREE_PRIVATE_KEY
});
