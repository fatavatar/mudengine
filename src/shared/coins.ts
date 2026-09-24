/**
 * The coin ladder, for comparing a quoted price to the purse.
 *
 * Measured, not assumed: `Wealth:` is a normalised total in copper, and eight
 * independent listings against their own totals put the rungs at
 * **1 / 10 / 100 / 10 000 / 1 000 000** — copper, silver, gold, platinum,
 * runic. Note the rungs are ×10, ×10, **×100, ×100**: an even ×10 ladder once
 * made platinum ten times and runic a hundred times too cheap.
 *
 *     51 gold, 7 copper                     ->     5 107   live (probe:play)
 *     12 platinum                           ->   120 000   captures/065
 *     94 platinum, 36 gold, 5 silver        ->   943 650   captures/087
 *     65 runic, 51 platinum, 118 gold       -> 65 521 800  captures/044
 *
 * The table came back for exactly one reason after being removed: a shop's
 * `list` quotes in coin (`20 gold crowns`) and the purse is known in copper
 * (`inventory.wealth`), and whether this character can pay is the question
 * a listing is read for. Nothing here converts for *display* — the counter's
 * words are shown as the counter said them, and this only answers "is that
 * more than I have".
 *
 * Only the first word of the noun is read (`gold` of `gold crowns`): the noun
 * is realm data, and captures/024's realm renames the runic coin outright. A
 * denomination this table does not name yields null — unknown, never zero.
 */
import { DENOMINATIONS, type Denomination } from './character';
import type { CurrencyEntity } from './entities';

export const COPPER_PER: Readonly<Record<Denomination, number>> = {
  copper: 1,
  silver: 10,
  gold: 100,
  platinum: 10_000,
  runic: 1_000_000
};

/**
 * A quoted price in copper, or null where the words are not a price this
 * client can read. `Free` is zero — the one place a word is a number, because
 * the realm prints it for a starter shop and it means exactly that.
 */
export function quotedInCopper(quoted: string): number | null {
  const text = quoted.trim();
  if (/^free$/i.test(text)) return 0;
  const match = /^(\d[\d,]*)\s+([a-z]+)\b/i.exec(text);
  if (!match) return null;
  const amount = Number(match[1]!.replace(/,/g, ''));
  const word = match[2]!.toLowerCase();
  const denomination = DENOMINATIONS.find((name) => name === word);
  if (denomination === undefined || !Number.isFinite(amount)) return null;
  return amount * COPPER_PER[denomination];
}

/**
 * What a realm calls its coins, where that is not the stock name — a
 * realm's `server.yaml` `coins:`, by denomination.
 *
 * The names are the realm's own text and a derivative renames them outright:
 * captures/024 calls the runic coin a `dime bag`, and Skinny Inc prints
 * `14 Krabby Patties` in the pack, on the floor, in a drop line, at the bank
 * and in every shop price, singular or plural (2026-09-24). Nothing on the
 * wire says which denomination that is — the purse total does, once — so
 * the realm is told, once, on the realm.
 */
export type CoinNames = Readonly<Partial<Record<Denomination, string>>>;

/** The stock nouns, as the pack lists them. What a renamed coin is read as. */
export const STOCK_COINS: Readonly<Record<Denomination, string>> = {
  copper: 'copper farthings',
  silver: 'silver nobles',
  gold: 'gold crowns',
  platinum: 'platinum pieces',
  runic: 'runic coins'
};

/** `coins:` as written, keeping only a name for a denomination. */
export function asCoinNames(value: unknown): CoinNames {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const names: Partial<Record<Denomination, string>> = {};
  for (const which of DENOMINATIONS) {
    const name = (value as Record<string, unknown>)[which];
    if (typeof name !== 'string') continue;
    const trimmed = name.trim().replace(/\s+/g, ' ').slice(0, 40);
    if (trimmed.length > 0) names[which] = trimmed;
  }
  return names;
}

/**
 * How a session reads and names the realm's coins.
 *
 * `stock` puts a renamed coin back as the stock noun before a line is
 * classified, so every reader of coins — the pack, the floor, a drop, a
 * pickup, a counter's price, the bank — goes on reading the one spelling it
 * was written against, and none of them has to be told about the realm.
 * `word` is the other direction: what a command calls the coin, the first
 * word of the realm's name, which the server matches as it matches any typed
 * name (`g k` took `1 Krabby Patties`).
 */
export interface CoinReader {
  stock(text: string): string;
  word(which: Denomination): string;
}

/**
 * The realm's name as a pattern that takes either number of the last word:
 * the realm prints `1 Krabby Patties`, and a player writing the setting may
 * as well write `Krabby Patty`.
 */
function spelledEitherWay(name: string): string {
  const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const words = name.toLowerCase().split(' ');
  const last = words.pop() ?? '';
  const either = last.endsWith('ies')
    ? `${escape(last.slice(0, -3))}(?:ies|y)`
    : last.endsWith('y')
      ? `${escape(last.slice(0, -1))}(?:y|ies)`
      : last.endsWith('s')
        ? `${escape(last.slice(0, -1))}s?`
        : `${escape(last)}s?`;
  return [...words.map(escape), either].join('\\s+');
}

export function coinReader(names: CoinNames): CoinReader {
  const renamed = DENOMINATIONS.flatMap((which) => {
    const name = names[which];
    if (name === undefined) return [];
    // Naming a coin what it is already called changes nothing.
    if (name.toLowerCase().split(' ')[0] === which) return [];
    return [{ which, pattern: new RegExp(`\\b${spelledEitherWay(name)}\\b`, 'gi') }];
  });
  return {
    stock: (text) =>
      renamed.reduce((line, { which, pattern }) => line.replace(pattern, STOCK_COINS[which]), text),
    word: (which) => names[which]?.split(' ')[0]?.toLowerCase() ?? which
  };
}

/** The stock realm's coins: nothing renamed. */
export const STOCK_COIN_READER: CoinReader = coinReader({});

/**
 * `Items.Currency` read as the coin an item's `Price` is counted in — the
 * server's own table (`BuyCommand.GetCopperValue`, `ListCommand.GetCurrencyName`):
 * 0 copper, 1 silver, 2 gold, 3 platinum, 4 runic. Anything else is unknown.
 */
export function currencyOfCode(code: number): Denomination | null {
  return (['copper', 'silver', 'gold', 'platinum', 'runic'] as const)[code] ?? null;
}

/**
 * What a counter charges for one, in copper, before the buyer's charm —
 * `BuyCommand.TryToBuy`'s `markedUpCost`: the base in copper times
 * `(100 + markup)`, divided by 100 in integers. Measured against the wire: a
 * waterskin (25 silver) at the General Store (100%) was quoted 50 silver
 * nobles, and a short-spear (2 gold) sold for 400 copper (2026-09-03).
 */
export function counterPriceInCopper(
  price: number,
  currency: Denomination,
  markup: number
): number {
  return Math.trunc((COPPER_PER[currency] * price * (100 + markup)) / 100);
}

/**
 * What the buyer is charged for one: the counter's price less
 * `ceil(price × trunc((charm − 50) ÷ 5) ÷ 100)` — the server knocks a fifth of
 * a percent per point of charm over 50 off, and adds it under 50.
 *
 * An unread charm is priced at the sheet's floor (0: ten percent more), since
 * this answers *is the purse enough* and unknown is never the reassuring answer.
 */
export function chargedInCopper(counterPrice: number, charm: number | null): number {
  const modifier = Math.trunc(((charm ?? 0) - 50) / 5);
  return counterPrice - Math.ceil((counterPrice * modifier) / 100);
}

/**
 * A `CurrencyEntity` from counts by denomination, with the total the ladder
 * above produces.
 *
 * One place, because the arithmetic was written wherever coins were counted
 * and `totalCopper` is what every threshold compares. An unnamed denomination
 * is **zero** here, deliberately: a `CurrencyEntity` is only ever built from
 * something that enumerated the coins — a listing, a drop line, a vault
 * statement — and absence of the entity itself is how "nobody has said" is
 * expressed. That is unlike `Inventory.coins`, which keeps nulls precisely so
 * it can tell an unlisted denomination from an empty one.
 */
export function currencyOf(
  counts: Partial<Record<Denomination, number>>,
  rawText?: string
): CurrencyEntity {
  const at = (which: Denomination): number => Math.max(0, Math.trunc(counts[which] ?? 0));
  const entity: CurrencyEntity = {
    runic: at('runic'),
    platinum: at('platinum'),
    gold: at('gold'),
    silver: at('silver'),
    copper: at('copper'),
    totalCopper: 0
  };
  entity.totalCopper = DENOMINATIONS.reduce(
    (total, which) => total + entity[which] * COPPER_PER[which],
    0
  );
  if (rawText !== undefined) entity.rawText = rawText;
  return entity;
}

/**
 * A copper total broken back down the ladder, largest denomination first.
 *
 * The inverse of what `currencyOf` computes, and the one place this module
 * converts *for display* — which the header above says nothing else does, and
 * still does not: this exists because a record can hold a total where no
 * listing survives to be quoted. A find's cash is written down as copper, so
 * one number compares against every denomination the realm prints; showing it
 * as `1250 copper` would be arithmetic the reader has to undo.
 *
 * Greedy from the top, which is exact rather than approximate: the rungs are
 * whole multiples of each other, so every total has one spelling.
 */
export function copperSpread(copper: number): CurrencyEntity {
  let left = Math.max(0, Math.trunc(copper));
  const counts: Partial<Record<Denomination, number>> = {};
  for (const which of [...DENOMINATIONS].sort((a, b) => COPPER_PER[b] - COPPER_PER[a])) {
    const each = COPPER_PER[which];
    counts[which] = Math.floor(left / each);
    left -= counts[which] * each;
  }
  return currencyOf(counts);
}

/** The same, with one denomination added to what is already counted. */
export function addCoins(
  cash: CurrencyEntity | null,
  which: Denomination,
  count: number
): CurrencyEntity {
  const counts: Partial<Record<Denomination, number>> = {};
  for (const name of DENOMINATIONS) counts[name] = cash?.[name] ?? 0;
  counts[which] = (counts[which] ?? 0) + Math.max(0, Math.trunc(count));
  return currencyOf(counts);
}
