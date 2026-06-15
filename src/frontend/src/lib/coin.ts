// Coin-related shared types and derived values.

export type Coin = 'bitcoin' | 'dogecoin';

/** Display symbol for a coin id. */
export function coinSymbol(coin: Coin): 'BTC' | 'DOGE' {
  return coin === 'bitcoin' ? 'BTC' : 'DOGE';
}

/** Price decimal places appropriate for a coin (BTC: 2, DOGE: 6). */
export function coinDecimals(coin: Coin): number {
  return coin === 'bitcoin' ? 2 : 6;
}
