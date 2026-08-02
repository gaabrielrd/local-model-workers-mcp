export function discountedPrice(price, percentage) {
  if (!Number.isFinite(price) || price < 0) {
    throw new TypeError("price must be a non-negative finite number");
  }
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
    throw new TypeError("percentage must be between zero and one hundred");
  }
  return price * (1 - percentage / 100);
}
