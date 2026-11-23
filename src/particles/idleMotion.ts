import type { FormationId } from '../formations';

export type IdleKind =
  | 'sway' // snowman: gentle sway and bob
  | 'spin' // tree: slow turn so the layers read as a cone
  | 'pace' // reindeer: trot in place, small forward/back
  | 'present' // gift: tilt and lift, like being offered
  | 'orbit' // snowflake: tumble and turn, 3D
  | 'circle'; // santa: the whole sleigh circles the screen

export interface IdleMotion {
  kind: IdleKind;
  /** how fast the motion runs; 1 is the tuned default */
  speed: number;
}

export const IDLE_MOTION: Record<FormationId, IdleMotion> = {
  snowman: { kind: 'sway', speed: 1 },
  tree: { kind: 'spin', speed: 1 },
  reindeer: { kind: 'pace', speed: 1 },
  gift: { kind: 'present', speed: 1 },
  snowflake: { kind: 'orbit', speed: 1 },
  santa: { kind: 'circle', speed: 1 },
};

export interface Transform {
  rotX: number;
  rotY: number;
  rotZ: number;
  posX: number;
  posY: number;
  posZ: number;
  /** uniform scale multiplier */
  scale: number;
}

export const REST_TRANSFORM: Transform = {
  rotX: 0,
  rotY: 0,
  rotZ: 0,
  posX: 0,
  posY: 0,
  posZ: 0,
  scale: 1,
};

/**
 * Computes the idle pose for a formation at time `t` (seconds).
 *
 * `intensity` fades the whole thing in and out so it never fights the morph:
 * 0 while particles are still travelling, 1 once the shape is complete.
 *
 * Every motion is periodic and returns to rest at intensity 0, so entering and
 * leaving a formation is seamless.
 */
export function idleTransform(
  motion: IdleMotion,
  t: number,
  intensity: number,
  aspect: number,
): Transform {
  const k = intensity;
  const s = motion.speed;
  const out: Transform = { ...REST_TRANSFORM };
  if (k <= 0) return out;

  switch (motion.kind) {
    case 'sway': {
      // a snowman has weight: slow rocking plus a lazy bob. Amplitudes are
      // larger than they look in code because the smoothing below damps them.
      out.rotZ = Math.sin(t * 0.55 * s) * 0.22 * k;
      out.rotY = Math.sin(t * 0.32 * s) * 0.55 * k;
      out.posY = Math.sin(t * 0.75 * s) * 0.12 * k;
      out.posX = Math.sin(t * 0.4 * s) * 0.16 * k;
      break;
    }
    case 'spin': {
      // a tree reads as a solid cone only when it turns; add a slight lean
      out.rotY = t * 0.42 * s * k;
      out.rotZ = Math.sin(t * 0.5 * s) * 0.05 * k;
      out.posY = Math.sin(t * 0.9 * s) * 0.05 * k;
      break;
    }
    case 'pace': {
      // a reindeer trots: bob twice per stride and lean into the motion
      out.posY = Math.abs(Math.sin(t * 2.2 * s)) * 0.09 * k;
      out.rotZ = Math.sin(t * 2.2 * s) * 0.045 * k;
      out.rotY = Math.sin(t * 0.5 * s) * 0.3 * k;
      out.posX = Math.sin(t * 0.5 * s) * 0.06 * k;
      break;
    }
    case 'present': {
      // a gift being offered: lift, tilt, and turn to show the bow
      out.rotY = Math.sin(t * 0.45 * s) * 0.55 * k;
      out.rotZ = Math.sin(t * 0.6 * s) * 0.09 * k;
      out.posY = Math.sin(t * 0.8 * s) * 0.1 * k;
      out.scale = 1 + Math.sin(t * 0.8 * s) * 0.02 * k;
      break;
    }
    case 'orbit': {
      // the snowflake is meant to be a 3D object: tumble it on two axes so the
      // six arms sweep through depth, plus a slow roll
      out.rotY = t * 0.55 * s * k;
      out.rotX = Math.sin(t * 0.42 * s) * 0.65 * k;
      out.rotZ = Math.sin(t * 0.3 * s) * 0.3 * k;
      out.posY = Math.sin(t * 0.7 * s) * 0.06 * k;
      break;
    }
    case 'circle': {
      // the sleigh flies around the screen: a wide elliptical path that keeps it
      // inside the frame, with a banking turn and a gentle climb.
      // The shape is ~3.6 units tall, so the horizontal radius has to be much
      // wider than that to read as travelling around the screen rather than
      // shuffling in place.
      const a = t * 0.35 * s;
      const radiusX = Math.min(2.4, 1.5 * Math.max(1, aspect)) * k;
      out.posX = Math.cos(a) * radiusX;
      out.posY = Math.sin(a * 2) * 0.28 * k;
      out.posZ = Math.sin(a) * 1.4 * k;
      // bank into the turn: negative because the nose points along +x
      out.rotZ = -Math.cos(a) * 0.22 * k;
      out.rotY = Math.sin(a) * 0.45 * k;
      break;
    }
  }

  return out;
}
