import { describe, expect, it } from 'vitest';

import { EMPTY_CHARACTER, type CharacterState } from '../../../shared/character';
import { wireItem, type ItemEntity } from '../../../shared/entities';
import { withJoinedItems } from '../inventory';

/*
 * A staff bought and worn between two `i` listings fought as a bare hand: the
 * pack held a wire-only entry until the next listing (upstream 0252d77,
 * 2026-09-30).
 */
describe('an item gained between listings', () => {
  const world = {
    buildItemEntity: (
      name: string,
      observed: { slot?: string | null; equipped?: boolean } = {}
    ): ItemEntity =>
      name === 'quarterstaff'
        ? ({
            ...wireItem(name, observed),
            source: 'hybrid',
            kind: 'weapon',
            weapon: { min: 2, max: 8, speed: 1100 }
          } as ItemEntity)
        : wireItem(name, observed)
  };
  const carrying = (...items: ItemEntity[]): CharacterState => ({
    ...EMPTY_CHARACTER,
    inventory: { ...EMPTY_CHARACTER.inventory, items }
  });

  it('carries the realm row once the realm names it, keeping what the wire said', () => {
    const joined = withJoinedItems(
      carrying(wireItem('quarterstaff', { slot: 'Weapon Hand', equipped: true })),
      world
    );
    const [staff] = joined.inventory.items;
    expect(staff?.source).toBe('hybrid');
    expect(staff?.weapon).toEqual({ min: 2, max: 8, speed: 1100 });
    expect(staff?.equipped).toBe(true);
    expect(staff?.slot).toBe('Weapon Hand');
  });

  it('hands back the same state when the realm names nothing new', () => {
    const s = carrying(wireItem('pebble'));
    expect(withJoinedItems(s, world)).toBe(s);
    expect(withJoinedItems(s, undefined)).toBe(s);
  });
});
