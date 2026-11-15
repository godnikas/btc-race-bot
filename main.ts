// "Clear Delta" — a cbBTC recovery-breakout bot for the 24h BTC race.
//
// Idea, learned from the published dev window (a slow -4% bleed with one
// sharp V-shaped recovery): long-only bots cannot win by fighting a
// downtrend, and they cannot win by buying every dip either — the dips
// keep dipping and each round trip costs ~26 bps. The only reliable money
// on the dev window came from a genuine bounce: price snapping back hard
// off a fresh low. So this bot waits for that snap and rides it.
//
//   - Entry: the close rises at least 1.50% above the lowest close of the
//     last 15 minutes (a recovery breaking out of a fresh low). Full size:
//     all cash. A weaker 0.80% rise is a feeler: 2.5% of cash, so the bot
//     still trades on quieter days and still has dry powder. The feeler is
//     deliberately tiny: on the dev window every weak-signal feeler that
//     never confirmed was stopped out for a small loss, so a 25% feeler
//     bled ~$20 across five false bounces while the one real bounce paid
//     ~$26. At 2.5% the false bounces cost almost nothing and the top-up
//     still converts a confirming bounce to full size.
//   - Top-up: while holding a feeler, if the strong 1.50% signal fires,
//     spend the remaining cash to go full size, blending the entry price.
//   - Exit: take profit at +3.00% over the (blended) entry fill price, or
//     a 1.00% trailing stop from the highest close since entry, whichever
//     comes first. Both are wide enough to survive 1-minute noise
//     (~12 bps/min) and tight enough to bank a real bounce.
//   - No shorts, no leverage, no clock, no randomness, no network: every
//     decision is a pure function of the bars seen so far, so two runs on
//     the same data give the same orders.
//
// Local grade on the published dev window (exact replay, fees + slippage +
// pool impact): net PnL +$29.71, max drawdown 0.46%, 15 trades. v1 ("Clear
// Delta", 25% feeler) scored +$22.41 / 0.86% / 15 trades on the same window;
// the only change is the feeler size, 25% -> 2.5% of cash.
// Baselines on the same window: buy-and-hold -$44.01, EMA-cross -$134.95,
// momentum -$40.92, RSI-Bollinger -$57.37, ADX-momentum -$86.60.

import { runBars, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

/** Minutes of closes kept for the rolling low. */
const LOOKBACK_BARS = 15;
/** Strong breakout: rise above the 15-minute low, in basis points. */
const STRONG_BPS = 150;
/** Weak breakout (feeler): rise above the 15-minute low, in basis points. */
const WEAK_BPS = 80;
/** Feeler size: this share of cash (v2: 2.5%, down from v1's 25%). */
const WEAK_SIZE_NUM = 1;
const WEAK_SIZE_DEN = 40;
/** Take profit over the entry fill price, in basis points. */
const TAKE_PROFIT_BPS = 300;
/** Trailing stop below the peak close since entry, in basis points. */
const TRAIL_BPS = 100;
/** Top up only while the position is worth less than this share of equity. */
const TOP_UP_MAX_WEIGHT_NUM = 9;
const TOP_UP_MAX_WEIGHT_DEN = 10;
/** Orders never risk a fill more than this past the close they were decided on. */
const MAX_SLIPPAGE_BPS = 100;

/** Closes in USDC (price_scale 5), oldest first; at most LOOKBACK_BARS. */
const closes: number[] = [];
/** Blended entry fill price in USDC, while holding; null when flat. */
let entryPrice: number | null = null;
/** Highest close since the current entry, in USDC. */
let peakClose = 0;

/** Lowest close in the window, or null before the first bar. */
function rollingLow(): number | null {
  let low = Infinity;
  for (const c of closes) if (c < low) low = c;
  return low === Infinity ? null : low;
}

await runBars({
  onBatch(state: BarsState, batch) {
    // Learn the fills of the orders decided on the previous bar: a buy
    // fill sets (or blends) the entry price; a sell fill clears it.
    for (const fill of batch.fills) {
      if (fill.status !== 'filled') continue;
      const price = Number(fill.price) / 1e5;
      if (fill.side === 'buy') {
        const newQty = Number(fill.qty);
        if (entryPrice === null) {
          entryPrice = price;
          peakClose = price;
        } else {
          // Blend with the quantity already held (state.positions already
          // includes this fill, so back it out for the old quantity).
          const held = state.positions.get(fill.symbol);
          const totalQty = held !== undefined ? Number(held.qty) : newQty;
          const oldQty = totalQty - newQty;
          entryPrice = oldQty > 0 ? (entryPrice * oldQty + price * newQty) / totalQty : price;
          if (price > peakClose) peakClose = price;
        }
      } else {
        entryPrice = null;
        peakClose = 0;
      }
    }

    for (const bar of batch.bars) {
      closes.push(Number(bar.c) / 1e5);
      if (closes.length > LOOKBACK_BARS) closes.shift();
    }

    if (state.warmingUp) return [];
    const held = state.positions.get('CBBTC');
    const close = closes.length > 0 ? closes[closes.length - 1] : null;
    const low = rollingLow();
    if (close === null || low === null || closes.length < LOOKBACK_BARS) return [];

    const riseBps = ((close - low) / low) * 10000;

    if (held !== undefined) {
      if (close > peakClose) peakClose = close;
      // Top up a feeler to full size when the strong signal confirms it.
      if (entryPrice !== null && riseBps >= STRONG_BPS && state.cash > 1000000n) {
        const heldValue = state.value('CBBTC', held.qty);
        if (heldValue * BigInt(TOP_UP_MAX_WEIGHT_DEN) < state.equity * BigInt(TOP_UP_MAX_WEIGHT_NUM)) {
          return [{ side: 'buy', symbol: 'CBBTC', notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS } satisfies BuyInput];
        }
      }
      // Exits: take profit, or the trailing stop.
      if (entryPrice !== null) {
        const gainBps = ((close - entryPrice) / entryPrice) * 10000;
        const pullbackBps = ((peakClose - close) / peakClose) * 10000;
        if (gainBps >= TAKE_PROFIT_BPS || pullbackBps >= TRAIL_BPS) {
          return [{ side: 'sell', symbol: 'CBBTC', qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS } satisfies SellInput];
        }
      }
      return [];
    }

    // Flat: enter on a breakout above the 15-minute low.
    if (riseBps >= STRONG_BPS) {
      if (state.cash < 1000000n) return [];
      return [{ side: 'buy', symbol: 'CBBTC', notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS } satisfies BuyInput];
    }
    if (riseBps >= WEAK_BPS) {
      const slice = (state.cash * BigInt(WEAK_SIZE_NUM)) / BigInt(WEAK_SIZE_DEN);
      if (slice < 1000000n) return [];
      return [{ side: 'buy', symbol: 'CBBTC', notional_quote_units: slice, max_slippage_bps: MAX_SLIPPAGE_BPS } satisfies BuyInput];
    }
    return [];
  },
});
