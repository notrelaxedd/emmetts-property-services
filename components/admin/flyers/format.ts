/** Pay per flyer: "$0.10", or "$0.125" when it has a tenth of a cent. */
export function perFlyer(rate: number): string {
  const cents3 = Math.round(rate * 1000)
  return `$${(cents3 / 1000).toFixed(cents3 % 10 ? 3 : 2)}`
}
