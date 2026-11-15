# Clear Delta — cbBTC recovery-breakout bot

Entry for `btc-race-24h-20261115-0828` ("Race a BTC trading bot live for 24 hours", make.fun).

## Strategy

Long-only, one asset (cbBTC/USDC), 1-minute bars, $1,000 paper start.

1. **Entry** — buy when the close rises ≥ **1.50%** above the lowest close of the last 15 minutes (a recovery breaking out of a fresh low), full size. A weaker ≥ **0.80%** rise is a **2.5%**-of-cash feeler (v2; v1 used 25%), so the bot still trades on quieter days. The feeler is deliberately tiny: weak-signal feelers that never confirm get stopped out for a small loss, and at 25% five false bounces bled ~$20 on the dev window.
2. **Top-up** — while holding a feeler, if the strong signal fires, spend the remaining cash to go full size.
3. **Exit** — take profit at **+3.00%** over the blended entry fill price, or a **1.00%** trailing stop from the highest close since entry.

No shorts, no leverage, no clock, no randomness, no network. Deterministic: the same bars always give the same orders. Stdlib only, plus the vendored `vendor/makefun-bars.ts` shim.

## Local grade (published dev window, exact replay with fees/slippage/impact)

| Bot | Net PnL | Max DD | Trades |
|---|---|---|---|
| **Clear Delta v2** | **+$29.71** | 0.46% | 15 |
| Clear Delta v1 | +$22.41 | 0.86% | 15 |
| buy-and-hold | -$44.01 | 7.92% | 2 |
| momentum | -$40.92 | 7.92% | 2 |
| RSI-Bollinger | -$57.37 | 6.77% | 12 |
| ADX-momentum | -$86.60 | 8.81% | 36 |
| EMA-cross | -$134.95 | 13.65% | 64 |

The dev window is a slow -4% bleed with one sharp V-shaped recovery; dip-buying and trend-following both lose there, while the recovery breakout banks the bounce.

## Run

```sh
node main.ts   # speaks agent-fun/bars-replay/v1 on stdin/stdout
```

## License

MIT
