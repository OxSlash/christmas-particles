import type { Rng } from '../lib/rng';
import type { Builder } from '../lib/formations/shapes';
import { buildSnowman } from './snowman';
import { buildTree } from './tree';
import { buildReindeer } from './reindeer';
import { buildGift } from './gift';
import { buildSnowflake } from './snowflake';
import { buildSanta } from './santa';

export type FormationId = 'snowman' | 'tree' | 'reindeer' | 'gift' | 'snowflake' | 'santa';

export interface FormationDef {
  id: FormationId;
  label: string;
  hint: string;
  /**
   * How much of the viewport height the shape should fill. Shapes are baked at
   * unit height and scaled per frame, so portrait and landscape both fit.
   */
  fit: number;
  build: (count: number, rng: Rng) => Builder;
}

export const FORMATIONS: FormationDef[] = [
  { id: 'snowman', label: 'Snowman', hint: '1 jari', fit: 0.66, build: buildSnowman },
  { id: 'tree', label: 'Christmas Tree', hint: '2 jari', fit: 0.62, build: buildTree },
  { id: 'reindeer', label: 'Reindeer', hint: '3 jari', fit: 0.64, build: buildReindeer },
  { id: 'gift', label: 'Gift Box', hint: '4 jari', fit: 0.6, build: buildGift },
  { id: 'snowflake', label: 'Snowflake', hint: '5 jari', fit: 0.66, build: buildSnowflake },
  { id: 'santa', label: 'Santa + Sleigh', hint: 'mengepal', fit: 0.7, build: buildSanta },
];

export const FORMATION_BY_ID = new Map(FORMATIONS.map((f) => [f.id, f]));
