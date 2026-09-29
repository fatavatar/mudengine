import { describe, expect, it } from 'vitest';

import {
  asMegaMudPaths,
  MEGAMUD_PATH_LIMITS,
  megaMudLoops,
  readMegaMudLoop,
  readMegaMudRooms
} from '../megamudPaths';

/* `Acryloop.mp` from MegaMUD's MudRev `Default` folder, cut short. */
const LOOP = [
  '[Ancient Crypt-1 1943][]',
  '[ACRY:Island:Ancient Crypt]',
  '3C900060:3C900060:32:-1:0:::',
  '3C900060:0000:w',
  '3C900015:0000:s',
  '3C900011:0000:hide 500 gold',
  ''
].join('\r\n');

/* A goto path names two rooms, and its two codes differ. */
const GOTO = [
  '[][]',
  '[1CGC:Sewers:Carved Granite Cavern]',
  '[3CGC:Sewers:Carved Granite Cavern]',
  '11111111:22222222:4:-1:0:::',
  '11111111:0000:n'
].join('\r\n');

const ROOMS = [
  '3C900060:00000000:0:0:0:ACRY:Island:Ancient Crypt-1 1943',
  '9BC00400:00000000:0:0:0:5HAR:Ancient Ruin:5-Headed Serpent'
].join('\r\n');

describe("reading MegaMUD's recorded paths", () => {
  it('reads a loop: its title, area, start and every step', () => {
    expect(readMegaMudLoop('Acryloop.mp', LOOP)).toEqual({
      file: 'Acryloop.mp',
      title: 'Ancient Crypt-1 1943',
      area: 'Island',
      start: 'Ancient Crypt',
      startRow: null,
      steps: ['w', 's', 'hide 500 gold']
    });
  });

  /* How MegaMUD itself tells them apart: the start room's code and the end's. */
  it('is not a loop when the path ends somewhere else', () => {
    expect(readMegaMudLoop('1CGC3CGC.mp', GOTO)).toBeNull();
  });

  /* `Dhelloop.mp` repeats its title on a second line, before the room. */
  it('finds the start room past a second title line', () => {
    const text = LOOP.replace('[ACRY:', '[Dhelvanen, Trade Loop][Kitty & Wulfman]\r\n[ACRY:');
    expect(readMegaMudLoop('Dhelloop.mp', text)?.start).toBe('Ancient Crypt');
  });

  it("takes Rooms.md's name for the start room, which carries its coordinates", () => {
    const rooms = readMegaMudRooms(ROOMS);
    expect(rooms.get('3C900060')).toBe('Ancient Crypt-1 1943');
    expect(readMegaMudLoop('Acryloop.mp', LOOP, rooms)?.startRow).toBe('Ancient Crypt-1 1943');
  });

  it('keeps only the loops from a folder, with Rooms.md found among the files', () => {
    const paths = megaMudLoops([
      { name: 'Acryloop.mp', text: LOOP },
      { name: '1CGC3CGC.mp', text: GOTO },
      { name: 'ROOMS.MD', text: ROOMS },
      { name: 'Messages.md', text: LOOP }
    ]);
    expect(paths.map((path) => [path.file, path.startRow])).toEqual([
      ['Acryloop.mp', 'Ancient Crypt-1 1943']
    ]);
  });
});

describe('MegaMUD paths that crossed the wire', () => {
  it('drops what is not a path, and a path with no start or no steps', () => {
    const good = readMegaMudLoop('Acryloop.mp', LOOP)!;
    expect(
      asMegaMudPaths([good, null, 'x', { ...good, start: '' }, { ...good, steps: [] }])
    ).toEqual([good]);
    expect(asMegaMudPaths('not a list')).toEqual([]);
  });

  it('holds a payload to its ceilings', () => {
    const good = readMegaMudLoop('Acryloop.mp', LOOP)!;
    const huge = { ...good, steps: Array(MEGAMUD_PATH_LIMITS.steps + 5).fill('n') };
    expect(asMegaMudPaths([huge])[0]?.steps).toHaveLength(MEGAMUD_PATH_LIMITS.steps);
    expect(asMegaMudPaths(Array(MEGAMUD_PATH_LIMITS.paths + 5).fill(good))).toHaveLength(
      MEGAMUD_PATH_LIMITS.paths
    );
  });
});
