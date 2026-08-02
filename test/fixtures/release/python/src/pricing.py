def discounted_price(price: float, percentage: float) -> float:
    if price < 0:
        raise ValueError("price must be non-negative")
    if percentage < 0 or percentage > 100:
        raise ValueError("percentage must be between zero and one hundred")
    return price * (1 - percentage / 100)
