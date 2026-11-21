// PRESENTATION HELPER, shared by adapters only.
// How money is DISPLAYED ("$30.00", "30,00 €") is a presentation concern that
// varies by channel and locale. The domain only ever deals in integer cents.

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function formatMoney(cents: number): string {
  return usd.format(cents / 100);
}
