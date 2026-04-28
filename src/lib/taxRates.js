/**
 * US State Tax Rates (Sample percentages for demo purposes)
 * Simplified rates for easier calculations
 */
export const US_STATE_TAX_RATES = {
	AL: 9.0, // Alabama
	AK: 2.0, // Alaska
	AZ: 8.0, // Arizona
	AR: 9.5, // Arkansas
	CA: 8.5, // California
	CO: 8.0, // Colorado
	CT: 6.5, // Connecticut
	DE: 0.0, // Delaware
	FL: 7.0, // Florida
	GA: 7.5, // Georgia
	HI: 4.5, // Hawaii
	ID: 6.0, // Idaho
	IL: 9.0, // Illinois
	IN: 7.0, // Indiana
	IA: 7.0, // Iowa
	KS: 8.5, // Kansas
	KY: 6.0, // Kentucky
	LA: 9.5, // Louisiana
	ME: 5.5, // Maine
	MD: 6.0, // Maryland
	MA: 6.25, // Massachusetts
	MI: 6.0, // Michigan
	MN: 7.5, // Minnesota
	MS: 7.0, // Mississippi
	MO: 8.0, // Missouri
	MT: 0.0, // Montana
	NE: 7.0, // Nebraska
	NV: 8.0, // Nevada
	NH: 0.0, // New Hampshire
	NJ: 6.5, // New Jersey
	NM: 8.0, // New Mexico
	NY: 8.5, // New York
	NC: 7.0, // North Carolina
	ND: 7.0, // North Dakota
	OH: 7.0, // Ohio
	OK: 9.0, // Oklahoma
	OR: 0.0, // Oregon
	PA: 6.5, // Pennsylvania
	RI: 7.0, // Rhode Island
	SC: 7.5, // South Carolina
	SD: 6.5, // South Dakota
	TN: 9.5, // Tennessee
	TX: 8.0, // Texas
	UT: 7.0, // Utah
	VT: 6.0, // Vermont
	VA: 5.5, // Virginia
	WA: 9.0, // Washington
	WV: 6.5, // West Virginia
	WI: 5.5, // Wisconsin
	WY: 5.5 // Wyoming
};

/**
 * Get tax rate for a given state code
 */
export function getTaxRate(stateCode) {
	return US_STATE_TAX_RATES[stateCode?.toUpperCase()] || 0;
}

/**
 * Calculate tax amount
 */
export function calculateTax(subtotal, stateCode) {
	const rate = getTaxRate(stateCode);
	const taxAmount = (parseFloat(subtotal) * rate) / 100;
	return taxAmount.toFixed(2);
}

/**
 * Calculate total with tax
 */
export function calculateTotal(subtotal, stateCode) {
	const subtotalNum = parseFloat(subtotal);
	const taxAmount = parseFloat(calculateTax(subtotal, stateCode));
	return (subtotalNum + taxAmount).toFixed(2);
}
