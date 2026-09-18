const MAD_FORMATTER = new Intl.NumberFormat("fr-MA", {
  style: "currency",
  currency: "MAD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const PERCENT_FORMATTER = new Intl.NumberFormat("fr-MA", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2
});

export function formatMad(value: number | string): string {
  const amount = Number(value);
  return Number.isFinite(amount) ? MAD_FORMATTER.format(amount) : "-";
}

export function formatPercentage(value: number | string): string {
  const percentage = Number(value);
  return Number.isFinite(percentage) ? `${PERCENT_FORMATTER.format(percentage)} %` : "-";
}
