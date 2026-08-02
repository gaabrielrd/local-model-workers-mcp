import unittest

from src.pricing import discounted_price


class PricingSmokeTest(unittest.TestCase):
    def test_existing_infrastructure_is_executable(self) -> None:
        self.assertEqual(discounted_price(100, 10), 90)


if __name__ == "__main__":
    unittest.main()
