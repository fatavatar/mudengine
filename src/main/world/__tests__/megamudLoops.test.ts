import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

import { WorldGraph } from '../WorldGraph';
import { loopsFromMegaMud } from '../megamudLoops';
import type { MegaMudPath } from '../../../shared/megamudPaths';

function makeWorld(rooms: Array<Record<string, unknown>>): WorldGraph {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mudengine-megaloops-'));
  const file = path.join(dir, 'rooms.jsonl.gz');
  const header = JSON.stringify({ v: 1, source: 'test', rooms: rooms.length, generatedAt: 'x' });
  fs.writeFileSync(
    file,
    zlib.gzipSync([header, ...rooms.map((r) => JSON.stringify(r))].join('\n') + '\n')
  );
  const graph = WorldGraph.load(file);
  fs.rmSync(dir, { recursive: true, force: true });
  return graph;
}

/*
 * Two squares of four rooms, every room of both called Forest, and a Crypt
 * off the second:
 *
 *   1/1 — 1/2      1/11 — 1/12
 *    |     |         |      |
 *   1/3 — 1/4      1/13 — 1/14 — 1/15 (Crypt)
 *
 * A loop that walks e, s, w, n closes on either square; one that also steps
 * into the Crypt and back closes only on the second.
 */
function world(): WorldGraph {
  const square = (base: number): Array<Record<string, unknown>> => [
    { m: 1, r: base + 1, n: 'Forest', x: { e: { m: 1, r: base + 2 }, s: { m: 1, r: base + 3 } } },
    { m: 1, r: base + 2, n: 'Forest', x: { w: { m: 1, r: base + 1 }, s: { m: 1, r: base + 4 } } },
    { m: 1, r: base + 3, n: 'Forest', x: { n: { m: 1, r: base + 1 }, e: { m: 1, r: base + 4 } } },
    {
      m: 1,
      r: base + 4,
      n: 'Forest',
      x: {
        n: { m: 1, r: base + 2 },
        w: { m: 1, r: base + 3 },
        ...(base === 10 ? { e: { m: 1, r: 15 } } : {})
      }
    }
  ];
  return makeWorld([
    ...square(0),
    ...square(10),
    { m: 1, r: 15, n: 'Crypt', x: { w: { m: 1, r: 14 } } }
  ]);
}

const path1 = (over: Partial<MegaMudPath>): MegaMudPath => ({
  file: 'LOOP.mp',
  title: '',
  area: 'Woods',
  start: 'Forest',
  startRow: null,
  steps: ['e', 's', 'w', 'n'],
  ...over
});

describe("MegaMUD's loops, placed on a realm", () => {
  it("starts from Rooms.md's coordinates, and names the loop by its title", async () => {
    const { loops } = await loopsFromMegaMud(world(), [
      path1({ title: 'Square Loop-1 11', startRow: 'Forest-1 11' })
    ]);
    expect(loops).toEqual([
      {
        name: 'Woods: Square Loop',
        category: 'Woods',
        // 1/14 is on the planner's own way from 1/12 to 1/13, so not a choice.
        stops: [{ room: 'Forest 1/11' }, { room: 'Forest 1/12' }, { room: 'Forest 1/13' }]
      }
    ]);
  });

  /*
   * A name the realm gives several rooms is settled by the recording: only
   * the room it was recorded from walks every step and comes back.
   */
  it('settles a start named by several rooms by the one the steps close on', async () => {
    const { loops, dropped } = await loopsFromMegaMud(world(), [
      path1({ steps: ['e', 's', 'e', 'w', 'w', 'n'] })
    ]);
    expect(dropped).toEqual({ start: 0, steps: 0, short: 0 });
    expect(loops[0]?.stops[0]).toEqual({ room: 'Forest 1/11' });
  });

  it('drops a start the steps close on from more than one room, rather than guess', async () => {
    expect((await loopsFromMegaMud(world(), [path1({})])).dropped).toEqual({
      start: 1,
      steps: 0,
      short: 0
    });
  });

  /* Coordinates are typed by hand; a typo names a room the steps do not fit. */
  it('falls back to the name when typed coordinates name a room the steps do not fit', async () => {
    const { loops } = await loopsFromMegaMud(world(), [
      path1({ startRow: 'Forest-1 12', steps: ['e', 's', 'e', 'w', 'w', 'n'] })
    ]);
    expect(loops[0]?.stops[0]).toEqual({ room: 'Forest 1/11' });
  });

  it('drops a loop whose recorded direction is not an exit, and counts why', async () => {
    const { loops, dropped } = await loopsFromMegaMud(world(), [
      path1({ startRow: 'Forest-1 1', steps: ['n'] }),
      path1({ start: 'Nowhere' })
    ]);
    expect(loops).toEqual([]);
    expect(dropped).toEqual({ start: 1, steps: 1, short: 0 });
  });

  /* A name is a loop's address, and MegaMUD reuses its labels across files. */
  it('numbers a label a second file reuses, the same way every run', async () => {
    const one = path1({ file: 'B.mp', title: 'Square', startRow: 'Forest-1 1' });
    const two = path1({ file: 'A.mp', title: 'Square', startRow: 'Forest-1 11' });
    const { loops, numbered } = await loopsFromMegaMud(world(), [one, two]);
    expect(loops.map((loop) => [loop.name, loop.stops[0]?.room])).toEqual([
      ['Woods: Square', 'Forest 1/11'],
      ['Woods: Square (2)', 'Forest 1/1']
    ]);
    expect(numbered).toBe(1);
  });
});
