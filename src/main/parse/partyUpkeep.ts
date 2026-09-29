/**
 * The party's volunteered facts kept current across one block, read off the
 * transition at the tracker's commit point rather than in each case (upstream
 * daa7d34): a member's fight ends with its monster (`fightsStillHere`), and a
 * member seen acting is no longer resting (`upFromRest`). The Party card said
 * Durnan was resting and fighting a fierce decayed guard after the guard fell
 * and Durnan had cast, swung and walked on.
 */
import type { Block } from '../../shared/blocks';
import type { CharacterState } from '../../shared/character';
import { mobKey } from '../../shared/world';
import { upFromRest } from './presence';

export function keepPartyCurrent(
  before: CharacterState,
  after: CharacterState,
  block: Block,
  moved: boolean
): CharacterState {
  const fights =
    !moved && after.room.occupants === before.room.occupants
      ? after
      : fightsStillHere(before, after, moved);
  const acting = actors(before, after, block);
  return acting.length === 0 ? fights : (upFromRest(fights, acting) ?? fights);
}

/**
 * Drops a member's fight once its monster is gone from the room. Nothing on
 * the wire says a member's fight has ended, but the monster dying or walking
 * out takes it off `room.occupants`, which is what `AutoCombat` already reads
 * as no fight. A monster `Also here:` never named is kept, since somebody
 * walking in says nothing about it; a move ends every fight, since a monster
 * in the new room says nothing about the one left behind under the same name;
 * and two monsters under one name keep the entry until neither is listed.
 */
function fightsStillHere(
  before: CharacterState,
  s: CharacterState,
  moved: boolean
): CharacterState {
  const was = listedMobs(before);
  const now = listedMobs(s);
  const over = (target: string): boolean =>
    moved || (!now.has(mobKey(target)) && was.has(mobKey(target)));
  const engaged = kept(s.party.engaged, (fight) => !over(fight.target));
  const threatened = kept(s.party.threatened, (seen) => !over(seen.target));
  if (engaged === s.party.engaged && threatened === s.party.threatened) return s;
  return { ...s, party: { ...s.party, engaged, threatened } };
}

function listedMobs(s: CharacterState): Set<string> {
  return new Set(
    s.room.occupants.filter((there) => there.kind === 'mob').map((there) => mobKey(there.name))
  );
}

/** `record` without the entries `keep` refuses; the same object when it refuses none. */
function kept<T>(record: Record<string, T>, keep: (entry: T) => boolean): Record<string, T> {
  const entries = Object.entries(record);
  const left = entries.filter(([, entry]) => keep(entry));
  return left.length === entries.length ? record : Object.fromEntries(left);
}

/** Who this block showed doing something that stands a player up. */
function actors(before: CharacterState, after: CharacterState, block: Block): string[] {
  const seen = [
    ...changed(before.party.engaged, after.party.engaged),
    ...changed(before.party.threatened, after.party.threatened)
  ];
  const named =
    block.type === 'player-leaves-room'
      ? block.groups['player']
      : block.type === 'spell-cast'
        ? block.groups['caster']
        : undefined;
  return named === undefined ? seen : [...seen, named];
}

/** The keys whose entry this block wrote. */
function changed<T>(was: Record<string, T>, now: Record<string, T>): string[] {
  if (was === now) return [];
  return Object.keys(now).filter((name) => now[name] !== was[name]);
}
