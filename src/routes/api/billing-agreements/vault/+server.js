import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

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

export async function POST({ request }) {
    try {
        const { billingAgreementId, isProduction, customer, shippingAddress } = await request.json();

        if (!billingAgreementId) {
            return json({ error: 'billingAgreementId is required' }, { status: 400 });
        }

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

        if (data.errors && data.errors.length > 0) {
            const errorMessage = data.errors.map(e => e.message).join('; ');
            return json({ error: errorMessage, details: data.errors, mutations }, { status: 400 });
        }

        const paymentMethod = data.data?.vaultPayPalBillingAgreement?.paymentMethod;

        if (!paymentMethod) {
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
