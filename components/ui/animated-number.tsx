"use client";

// Statistics are shown at their exact value as soon as they arrive. Keeping the
// historical exports lets analytical views share formatting without replaying
// a count from zero on navigation or account changes.
export const COUNT_UP_MS = 0;
export const countUpAllowed = () => false;
export function useCountUp(value: number | undefined, _duration = COUNT_UP_MS) {
  return value;
}

const format = (value: number, decimals: number, fixedDecimals = false) =>
  decimals === 0
    ? Math.round(value).toLocaleString("zh-CN", { maximumFractionDigits: 0 })
    : value.toLocaleString("zh-CN", {
        minimumFractionDigits: fixedDecimals ? decimals : 0,
        maximumFractionDigits: decimals,
      });

/**
 * Renders only the formatted number so page typography stays with the caller.
 * While loading (or before data), renders the provided fallback.
 */
export function AnimatedNumber({
  value,
  decimals = 0,
  fixedDecimals = false,
  loading = false,
  fallback = null,
}: {
  value?: number;
  decimals?: number;
  /** Keep trailing zeros (72.90) when the column needs a stable decimal width. */
  fixedDecimals?: boolean;
  loading?: boolean;
  fallback?: React.ReactNode;
}) {
  const display = useCountUp(loading ? undefined : value);
  if (loading) return <>{fallback}</>;
  if (value === undefined) return <>{fallback}</>;
  return <>{format(display ?? value, decimals, fixedDecimals)}</>;
}
