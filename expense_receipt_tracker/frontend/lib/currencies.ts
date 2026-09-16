/** Currencies offered in the expense forms' currency picker. USD/KRW/INR/CNY
 *  lead the list; a value that isn't here (e.g. one an AI scan detected) is
 *  still shown by CurrencySelect so it's never lost. */
export interface Currency {
  code: string
  name: string
}

export const CURRENCIES: Currency[] = [
  { code: "USD", name: "US Dollar" },
  { code: "KRW", name: "South Korean Won" },
  { code: "INR", name: "Indian Rupee" },
  { code: "CNY", name: "Chinese Yuan" },
  { code: "EUR", name: "Euro" },
  { code: "GBP", name: "British Pound" },
  { code: "JPY", name: "Japanese Yen" },
  { code: "AUD", name: "Australian Dollar" },
  { code: "CAD", name: "Canadian Dollar" },
  { code: "SGD", name: "Singapore Dollar" },
  { code: "HKD", name: "Hong Kong Dollar" },
  { code: "AED", name: "UAE Dirham" },
  { code: "CHF", name: "Swiss Franc" },
]
