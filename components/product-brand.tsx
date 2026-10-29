/** Shared identity for the sign-in page and the learning workspace: a short
    ruler whose tallest tick carries the accent point. */
export function ProductBrand() {
  return (
    <>
      <svg className="product-brand-mark" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 20h18" />
        <path d="M5 20v-6M9 20v-10M13 20v-14M17 20v-8" />
        <circle cx="13" cy="4" r="1.6" />
      </svg>
      <span className="product-brand-wordmark">学析台</span>
    </>
  );
}
