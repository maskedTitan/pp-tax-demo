let storedPaymentMethodToken = null;

export function getPaymentMethodToken() {
    return storedPaymentMethodToken;
}

export function setPaymentMethodToken(token) {
    storedPaymentMethodToken = token;
}

export function clearPaymentMethodToken() {
    storedPaymentMethodToken = null;
}
