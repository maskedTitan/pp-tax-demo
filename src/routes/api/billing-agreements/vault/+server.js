import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getBillingAgreement } from '$lib/billingAgreements.js';
import { PUBLIC_PAYPAL_CLIENT_ID, PUBLIC_PAYPAL_PROD_CLIENT_ID } from '$env/static/public';

const CREATE_CUSTOMER_MUTATION = `
mutation CreateCustomer($input: CreateCustomerInput!) {
  createCustomer(input: $input) {
    customer {
      id
      legacyId
      firstName
      lastName
      email
      company
      phoneNumber
      customFields {
        name
        value
      }
    }
  }
}`;

const VAULT_MUTATION = `
mutation VaultPayPalBillingAgreement($input: VaultPayPalBillingAgreementInput!) {
  vaultPayPalBillingAgreement(input: $input) {
    paymentMethod {
      id
      legacyId
      usage
      details {
        ... on PayPalAccountDetails {
          email
          firstName
          lastName
          payerId
          billingAgreementId
        }
      }
    }
  }
}`;

const DELETE_CUSTOMER_MUTATION = `
mutation DeleteCustomer($input: DeleteCustomerInput!) {
  deleteCustomer(input: $input) {
    clientMutationId
  }
}`;

/**
 * Braintree resolves a billing agreement by calling PayPal as the PayPal account
 * linked to the gateway. When that lookup comes back empty it reports legacy code
 * 92921 regardless of the underlying reason, so pair it with the PayPal preflight
 * result to say which side is actually at fault.
 */
function explainVaultError(errors, preflight, isProduction, merchantAccountId) {
    const has92921 = errors.some((e) => e.extensions?.legacyCode === '92921');
    if (!has92921) return null;

    const envName = isProduction ? 'production' : 'sandbox';
    const envVar = `BRAINTREE${isProduction ? '_PROD' : ''}_MERCHANT_ACCOUNT_ID`;
    const maNote = merchantAccountId
        ? `The import targeted merchant account "${merchantAccountId}" - confirm that is the one holding the PayPal link.`
        : `No merchant account was supplied and ${envVar} is not set, so the import used the gateway's default merchant account. This gateway's PayPal link lives on a different merchant account: enter it in the Merchant Account ID field, or set ${envVar} to it.`;

    if (preflight?.found === false) {
        return `PayPal (${envName}) does not recognize this billing agreement id under the REST app in PUBLIC_PAYPAL${isProduction ? '_PROD' : ''}_CLIENT_ID. Re-create the agreement, and confirm the environment toggle matches the one it was approved in.`;
    }

    // PayPal has returned this both as "Active" and "ACTIVE" - compare case-insensitively.
    const state = (preflight?.state || '').toUpperCase();

    if (preflight?.found === true && state && state !== 'ACTIVE') {
        return `The billing agreement exists but its state is "${preflight.state}", not active. Braintree can only import active agreements.`;
    }

    if (preflight?.found === true) {
        return `The billing agreement is active and visible to your PayPal REST app, so the id is fine — Braintree could not read it. Braintree looks the agreement up as the PayPal account linked to the merchant account it imports against, so this is a merchant account mismatch. ${maNote}`;
    }

    return `Braintree could not retrieve the agreement from PayPal on the ${envName} gateway. ${maNote}`;
}

export async function POST({ request }) {
    try {
        const body = await request.json();
        const { billingAgreementId, isProduction, customer, shippingAddress } = body;

        if (!billingAgreementId) {
            return json({ error: 'billingAgreementId is required' }, { status: 400 });
        }

        // Braintree resolves the agreement as the PayPal account linked to the merchant
        // account it imports against, so the import has to target the one holding that
        // link. Supplied per request, falling back to the configured default.
        const merchantAccountId =
            body.merchantAccountId ||
            (isProduction ? env.BRAINTREE_PROD_MERCHANT_ACCOUNT_ID : env.BRAINTREE_MERCHANT_ACCOUNT_ID) ||
            null;

        const publicKey = isProduction ? env.BRAINTREE_PROD_PUBLIC_KEY : env.BRAINTREE_PUBLIC_KEY;
        const privateKey = isProduction ? env.BRAINTREE_PROD_PRIVATE_KEY : env.BRAINTREE_PRIVATE_KEY;

        if (!publicKey || !privateKey) {
            return json({ error: 'Braintree credentials not configured for this environment' }, { status: 500 });
        }

        const graphqlUrl = isProduction
            ? 'https://payments.braintree-api.com/graphql'
            : 'https://payments.sandbox.braintree-api.com/graphql';

        const credentials = Buffer.from(`${publicKey}:${privateKey}`).toString('base64');
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${credentials}`,
            'Braintree-Version': '2024-08-01'
        };

        const mutations = [];
        let customerId = null;
        let createdCustomer = null;

        // Step 0: Ask PayPal directly whether this agreement exists and is active.
        // Braintree's import failure message is identical for "bad id", "wrong
        // environment" and "gateway linked to a different PayPal account", so this
        // lookup is what tells them apart.
        let preflight = null;
        try {
            const lookup = await getBillingAgreement(billingAgreementId, isProduction);
            preflight = {
                found: lookup.ok,
                state: lookup.body?.state || null,
                payerEmail: lookup.body?.payer?.payer_info?.email || null
            };
            mutations.push({
                mutation: 'GET /v1/billing-agreements/agreements (PayPal preflight)',
                request: {
                    billingAgreementId,
                    environment: isProduction ? 'production' : 'sandbox',
                    // Which PayPal app owns the agreement, and which merchant account
                    // Braintree imports as - the pair that has to line up.
                    paypalClientId: isProduction ? PUBLIC_PAYPAL_PROD_CLIENT_ID : PUBLIC_PAYPAL_CLIENT_ID,
                    merchantAccountId: merchantAccountId || '(gateway default)'
                },
                response: lookup.ok
                    ? { httpStatus: lookup.status, id: lookup.body?.id, state: lookup.body?.state, payer: lookup.body?.payer }
                    : { httpStatus: lookup.status, ...lookup.body }
            });
        } catch (preflightError) {
            // A failed preflight must not block the import - it is diagnostic only.
            mutations.push({
                mutation: 'GET /v1/billing-agreements/agreements (PayPal preflight)',
                request: { billingAgreementId, environment: isProduction ? 'production' : 'sandbox' },
                response: { error: preflightError.message }
            });
        }

        // Step 1: Create customer via GraphQL with address in custom fields
        if (customer && (customer.firstName || customer.lastName || customer.email)) {
            const customerInput = {};
            if (customer.firstName) customerInput.firstName = customer.firstName;
            if (customer.lastName) customerInput.lastName = customer.lastName;
            if (customer.email) customerInput.email = customer.email;
            if (customer.company) customerInput.company = customer.company;
            if (customer.phoneNumber) customerInput.phoneNumber = customer.phoneNumber || 9999999999;
            if (customer.website) customerInput.website = customer.website;
            if (customer.fax) customerInput.fax = customer.fax;

            // Store address info as custom fields
            if (shippingAddress) {
                const customFields = [];
                if (shippingAddress.line1) customFields.push({ name: 'street_address', value: shippingAddress.line1 });
                if (shippingAddress.line2) customFields.push({ name: 'extended_address', value: shippingAddress.line2 });
                if (shippingAddress.city) customFields.push({ name: 'locality', value: shippingAddress.city });
                if (shippingAddress.state) customFields.push({ name: 'region', value: shippingAddress.state });
                if (shippingAddress.postal_code) customFields.push({ name: 'postal_code', value: shippingAddress.postal_code });
                if (shippingAddress.country_code) customFields.push({ name: 'country_code', value: shippingAddress.country_code });
                if (customFields.length > 0) {
                    customerInput.customFields = customFields;
                }
            }

            const customerResponse = await fetch(graphqlUrl, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    query: CREATE_CUSTOMER_MUTATION,
                    variables: { input: { customer: customerInput } }
                })
            });

            const customerData = await customerResponse.json();
            mutations.push({ mutation: 'createCustomer', request: { customer: customerInput }, response: customerData });

            if (customerData.errors && customerData.errors.length > 0) {
                const errorMessage = customerData.errors.map(e => e.message).join('; ');
                return json({ error: errorMessage, details: customerData.errors, mutations }, { status: 400 });
            }

            createdCustomer = customerData.data?.createCustomer?.customer;
            customerId = createdCustomer?.id;
        }

        // Step 2: Vault the billing agreement via GraphQL
        const vaultInput = { billingAgreementId };
        if (customerId) {
            vaultInput.customerId = customerId;
        }
        if (merchantAccountId) {
            vaultInput.merchantAccountId = merchantAccountId;
        }

        const response = await fetch(graphqlUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                query: VAULT_MUTATION,
                variables: { input: vaultInput }
            })
        });

        const data = await response.json();
        mutations.push({ mutation: 'vaultPayPalBillingAgreement', request: vaultInput, response: data });

        // The customer only exists to hang the payment method off. If the import
        // fails, drop it again so retries don't litter the vault with empty customers.
        const rollbackCustomer = async () => {
            if (!customerId) return;
            try {
                const deleteResponse = await fetch(graphqlUrl, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        query: DELETE_CUSTOMER_MUTATION,
                        variables: { input: { customerId } }
                    })
                });
                mutations.push({
                    mutation: 'deleteCustomer (rollback)',
                    request: { customerId },
                    response: await deleteResponse.json()
                });
            } catch (rollbackError) {
                mutations.push({
                    mutation: 'deleteCustomer (rollback)',
                    request: { customerId },
                    response: { error: rollbackError.message }
                });
            }
        };

        if (data.errors && data.errors.length > 0) {
            const errorMessage = data.errors.map(e => e.message).join('; ');
            const hint = explainVaultError(data.errors, preflight, isProduction, merchantAccountId);
            await rollbackCustomer();
            return json({ error: errorMessage, hint, details: data.errors, mutations }, { status: 400 });
        }

        const paymentMethod = data.data?.vaultPayPalBillingAgreement?.paymentMethod;

        if (!paymentMethod) {
            await rollbackCustomer();
            return json({ error: 'No payment method returned from Braintree', mutations }, { status: 400 });
        }

        return json({
            success: true,
            mutations,
            customer: createdCustomer || null,
            paymentMethod: {
                id: paymentMethod.id,
                legacyId: paymentMethod.legacyId,
                usage: paymentMethod.usage,
                ...paymentMethod.details
            }
        });
    } catch (error) {
        console.error('Vault billing agreement error:', error);
        return json({ error: 'Failed to vault billing agreement' }, { status: 500 });
    }
}
