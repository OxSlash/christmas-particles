import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { FORMATIONS, type FormationId } from '../formations';
import { toLinear } from '../lib/color';
import { makeRng } from '../lib/rng';
import { particleFragmentShader, particleVertexShader } from './shaders';
import { IDLE_MOTION, idleTransform } from './idleMotion';

interface Baked {
  pos: Float32Array;
  col: Float32Array;
}

interface Props {
  /** formation requested by React (keyboard, chips, manual override) */
  formation: FormationId;
  count: number;
  /**
   * formation committed by the gesture machine. Polled inside the render loop
   * so a hand gesture takes effect on the next frame instead of waiting for a
   * React state update to travel down the tree.
   */
  liveFormationRef?: React.RefObject<FormationId | null>;
  /** latest hand palm position, used for parallax like a physical object */
  handRef: React.RefObject<{ palm: { x: number; y: number }; present: boolean }>;
  onReady?: () => void;
}

/**
 * How long a full morph takes, in seconds.
 *
 * The previous design lerped toward the target every frame, which is
 * exponential: it never truly arrives. Even at 99% the last 1% of the distance
 * is still visible as a blur, so the shape stayed soft for well over a second
 * and a half after the gesture landed. A time-based tween with an eased curve
 * reaches exactly 0 distance at a known moment, so the shape snaps into focus
 * on schedule instead of trailing off asymptotically.
 */
const MORPH_SECONDS = 0.62;

/**
 * Spread of per-particle timing, so the cloud dissolves instead of sliding.
 * Kept small because the *slowest* particle sets when the shape is fully crisp:
 * the total settle time is MORPH_SECONDS * (1 + MORPH_JITTER / 2).
 */
const MORPH_JITTER = 0.28;

function cacheKey(id: FormationId, count: number): string {
  return `${id}:${count}`;
}

function bake(id: FormationId, count: number): Baked {
  const def = FORMATIONS.find((f) => f.id === id)!;
  const builder = def.build(count, makeRng(9001 + id.length * 7919 + id.charCodeAt(0) * 31));
  const n = builder.count;

  // Fit using only the solid shape; ambient dust would otherwise inflate the
  // bounds and shrink every formation differently.
  const fitCount = builder.coreEnd > 0 ? builder.coreEnd : n;
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < fitCount; i++) {
    const x = builder.pos[i * 3];
    const y = builder.pos[i * 3 + 1];
    const z = builder.pos[i * 3 + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  // Normalise to unit height and centre it. The on-screen scale is computed per
  // frame from the camera, so any aspect ratio keeps the shape in frame.
  const height = Math.max(0.001, maxY - minY);
  const k = 1 / height;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;

  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (builder.pos[i * 3] - cx) * k;
    pos[i * 3 + 1] = (builder.pos[i * 3 + 1] - cy) * k;
    pos[i * 3 + 2] = (builder.pos[i * 3 + 2] - cz) * k;
    const lin = toLinear([builder.col[i * 3], builder.col[i * 3 + 1], builder.col[i * 3 + 2]]);
    col[i * 3] = lin[0];
    col[i * 3 + 1] = lin[1];
    col[i * 3 + 2] = lin[2];
  }
  return { pos, col };
}

export function ParticleField({ formation, count, liveFormationRef, handRef, onReady }: Props) {
  const groupRef = useRef<THREE.Group>(null);
  const burstRef = useRef(0);
  const { size } = useThree();

  const cache = useRef(new Map<string, Baked>());
  const [buildVersion, setBuildVersion] = useState(0);

  // onReady is often an inline arrow, which would make the build effect rerun
  // (and reschedule its timeout) on every parent render. Keep it in a ref.
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uViewportH: { value: 900 },
      uWorldSize: { value: 0.0075 },
      uBurst: { value: 0 },
      uSwell: { value: 0 },
      uFit: { value: 4 },
      uIdle: { value: 0 },
      uBreath: { value: 0 },
      uWave: { value: 0 },
    }),
    [],
  );

  // stable per-particle identity (seed + size) so morphs keep the same dots
  const identity = useMemo(() => {
    const rng = makeRng(4242);
    const seed = new Float32Array(count);
    const sz = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      seed[i] = rng();
      sz[i] = 0.72 + rng() * 0.62;
    }
    return { seed, sz };
  }, [count]);

  /*
   * Buffers for the tween:
   *   current  — where each particle is right now (bound to the geometry)
   *   target   — where the active gesture wants it to be
   *   origin   — where it was when the target last changed
   *   elapsed  — seconds this particle has spent on the current tween
   *   duration — how long this particle's tween takes
   *
   * Storing origin/elapsed/duration per particle is what lets the motion be a
   * pure function of time: an interrupted morph can start a fresh tween from the
   * current position without any jump, and every particle still lands exactly on
   * its target.
   */
  const buffers = useMemo(() => {
    const current = new Float32Array(count * 3);
    const target = new Float32Array(count * 3);
    const currentCol = new Float32Array(count * 3);
    const targetCol = new Float32Array(count * 3);
    return { current, target, currentCol, targetCol };
  }, [count]);

  const originPos = useMemo(() => new Float32Array(count * 3), [count]);
  const originColArr = useMemo(() => new Float32Array(count * 3), [count]);
  const elapsedArr = useMemo(() => new Float32Array(count), [count]);
  const durationArr = useMemo(() => new Float32Array(count), [count]);

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(buffers.current, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(buffers.currentCol, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(identity.seed, 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(identity.sz, 1));
    g.setAttribute('aDepth', new THREE.BufferAttribute(new Float32Array(count), 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 9);
    return g;
  }, [buffers, identity]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  // Build the requested formation on the next tick (so the boot overlay can
  // paint first), then prefetch the rest during idle time.
  useEffect(() => {
    const key = cacheKey(formation, count);
    if (cache.current.has(key)) return;
    const t = window.setTimeout(() => {
      cache.current.set(key, bake(formation, count));
      setBuildVersion((v) => v + 1);
      onReadyRef.current?.();
    }, 0);
    return () => window.clearTimeout(t);
  }, [formation, count]);

  const prefetching = useRef(false);

  useEffect(() => {
    if (prefetching.current) return;
    prefetching.current = true;
    let cancelled = false;
    let handle: number | undefined;
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void) => number })
      .requestIdleCallback;
    const cancelRic = (window as unknown as { cancelIdleCallback?: (id: number) => void })
      .cancelIdleCallback;

    const idle = (cb: () => void) => {
      handle = ric ? ric(cb) : window.setTimeout(cb, 180);
    };

    const step = () => {
      if (cancelled) return;
      // re-read the live cache each step so a formation baked on demand is not
      // baked a second time here
      const next = FORMATIONS.find((f) => !cache.current.has(cacheKey(f.id, count)));
      if (!next) return;
      cache.current.set(cacheKey(next.id, count), bake(next.id, count));
      setBuildVersion((v) => v + 1);
      idle(step);
    };

    idle(step);
    return () => {
      cancelled = true;
      if (handle !== undefined) {
        if (ric && cancelRic) cancelRic(handle);
        else window.clearTimeout(handle);
      }
    };
  }, [count]);

  const appliedKey = useRef<string | null>(null);
  /** formation the render loop is currently showing */
  const activeFormation = useRef<FormationId>(formation);
  /** fingerprint of currentPositions captured just before/after a switch */
  const switchSnapshot = useRef<{ before: number; after: number } | null>(null);

  /**
   * Points the target buffers at a formation. currentPositions is deliberately
   * left alone, which is what keeps the transition continuous when the gesture
   * changes mid-flight.
   *
   * Called from the render loop (for gestures) and from an effect (for React
   * driven changes), so it must be idempotent.
   */
  const applyFormation = useCallback(
    (id: FormationId, instant = false) => {
      const key = cacheKey(id, count);
      const next = cache.current.get(key);
      if (!next) return false;
      if (appliedKey.current === key) return true;

      const { current, target, currentCol, targetCol } = buffers;

      // fingerprint currentPositions before touching anything, so a test can
      // prove the switch left them untouched
      let before = 0;
      const sample = Math.min(count, 4000);
      for (let i = 0; i < sample; i++) {
        before += current[i * 3] * 1.1 + current[i * 3 + 1] * 2.3 + current[i * 3 + 2] * 3.7;
      }

      if (instant || appliedKey.current === null) {
        // first paint: sit exactly on the shape, no animation
        current.set(next.pos);
        target.set(next.pos);
        currentCol.set(next.col);
        targetCol.set(next.col);
        originPos.set(next.pos);
        originColArr.set(next.col);
        elapsedArr.fill(0);
        durationArr.fill(0);
        geometry.getAttribute('position').needsUpdate = true;
        geometry.getAttribute('aColor').needsUpdate = true;
      } else {
        // Freeze wherever every particle is right now as the new origin, then
        // retarget. Particles mid-flight keep their current position, so the
        // switch is continuous, but each starts a fresh timed tween from here.
        originPos.set(current);
        originColArr.set(currentCol);
        target.set(next.pos);
        targetCol.set(next.col);
        elapsedArr.fill(0);
        for (let i = 0; i < count; i++) {
          // per-particle duration so the cloud dissolves instead of moving as
          // one rigid block; seeds[i] spreads it either side of the base time
          durationArr[i] =
            MORPH_SECONDS * (1 - MORPH_JITTER * 0.5 + identity.seed[i] * MORPH_JITTER);
        }
      }

      let after = 0;
      for (let i = 0; i < sample; i++) {
        after += current[i * 3] * 1.1 + current[i * 3 + 1] * 2.3 + current[i * 3 + 2] * 3.7;
      }
      switchSnapshot.current = { before, after };

      appliedKey.current = key;
      activeFormation.current = id;
      return true;
    },
    [buffers, count, geometry, identity.seed, originPos, originColArr, elapsedArr, durationArr],
  );

  // React-driven changes (keyboard, chips, manual override).
  useEffect(() => {
    applyFormation(formation);
  }, [formation, buildVersion, applyFormation]);

  useEffect(() => {
    (window as unknown as { __particleBurst?: () => void }).__particleBurst = () => {
      burstRef.current = 1;
    };
    (window as unknown as { __particleDebug?: () => unknown }).__particleDebug = () => {
      const { current, target } = buffers;
      // average remaining distance — 0 means the shape has landed
      let sum = 0;
      const sample = Math.min(count, 4000);
      for (let i = 0; i < sample; i++) {
        const j = i * 3;
        sum +=
          Math.abs(current[j] - target[j]) +
          Math.abs(current[j + 1] - target[j + 1]) +
          Math.abs(current[j + 2] - target[j + 2]);
      }
      // cheap fingerprint of where the particles actually are, so a test can
      // prove a formation switch does not move them
      let fingerprint = 0;
      for (let i = 0; i < sample; i++) {
        fingerprint += current[i * 3] * 1.1 + current[i * 3 + 1] * 2.3 + current[i * 3 + 2] * 3.7;
      }
      const pts = groupRef.current?.children[0] as THREE.Points | undefined;
      const mat = pts?.material as THREE.ShaderMaterial | undefined;
      return {
        remaining: sum / sample,
        fingerprint,
        swell: uniforms.uSwell.value,
        fit: uniforms.uFit.value,
        idle: uniforms.uIdle.value,
        time: uniforms.uTime.value,
        sameUniformsObject: mat ? mat.uniforms === uniforms : null,
        geomIsAttached: pts ? pts.geometry === geometry : null,
        currentIsGeometryPosition: pts
          ? (pts.geometry.getAttribute('position').array as Float32Array) === current
          : null,
      };
    };
    return () => {
      delete (window as unknown as { __particleBurst?: () => void }).__particleBurst;
      delete (window as unknown as { __particleDebug?: () => unknown }).__particleDebug;
    };
  }, [uniforms, buffers, geometry, count]);

  // Test hook: records the particle positions at the exact moment a formation
  // switch happens. Comparing two consecutive records proves the switch did not
  // reset currentPositions (a reset would move every particle at once), and it
  // is immune to the animation running between two JS reads.
  useEffect(() => {
    const w = window as unknown as {
      __switchSnapshot?: () => { before: number; after: number } | null;
    };
    w.__switchSnapshot = () => {
      const snap = switchSnapshot.current;
      if (!snap) return null;
      return { before: snap.before, after: snap.after };
    };
    return () => {
      delete (window as unknown as { __switchSnapshot?: () => unknown }).__switchSnapshot;
    };
  }, []);

  // The material is created explicitly rather than via <shaderMaterial>: R3F
  // hands the JSX `uniforms` object to the material constructor, which ends up
  // with its own copy. Every uniform we animate (uFit, uTime, uSwell…) would
  // then be written to an object the shader never reads.
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: particleVertexShader,
        fragmentShader: particleFragmentShader,
        uniforms,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      }),
    [uniforms],
  );

  useEffect(() => () => material.dispose(), [material]);

  const smooth = useRef({ x: 0, y: 0 });
  const fitSmooth = useRef<number | null>(null);
  /** 0 while morphing, 1 once settled; fades the idle motion in and out */
  const idleBlend = useRef(0);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    uniforms.uTime.value += dt;

    // Guard: the tween buffers are sized from `count`, so a stale render loop
    // from a previous module instance (HMR) or a mid-resize frame can arrive
    // before they exist. Bailing here keeps a transient mismatch from throwing
    // "cannot read properties of undefined" every frame.
    if (
      !elapsedArr ||
      !durationArr ||
      elapsedArr.length !== count ||
      durationArr.length !== count ||
      buffers.current.length !== count * 3
    ) {
      return;
    }

    // A gesture committed since the last frame takes effect immediately here,
    // without waiting for React to re-render. This is the whole point of the
    // live ref: it removes a full state-update round trip from the response.
    //
    // Compared against the *active* formation, not the prop: the prop is only
    // the React-side request (keyboard/manual), so using it here would let a
    // stale live value keep overriding keyboard input forever.
    const live = liveFormationRef?.current;
    if (live && live !== activeFormation.current) {
      applyFormation(live);
    }
    uniforms.uViewportH.value = size.height * Math.min(state.gl.getPixelRatio(), 2);

    // Fit the unit-height shape to the visible frustum at z=0. Uses the narrower
    // of height/width so portrait screens do not clip it.
    const cam = state.camera as THREE.PerspectiveCamera;
    const dist = Math.abs(cam.position.z);
    const visibleH = 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * dist;
    const visibleW = visibleH * cam.aspect;
    const def = FORMATIONS.find((f) => f.id === formation);
    const target = def?.fit ?? 0.66;
    const fitTarget = Math.min(visibleH * target, visibleW * target * 1.35);

    // Scale used to snap the instant the formation changed, which made the whole
    // cloud visibly jump size. Ease it instead so shapes grow/shrink into place.
    if (fitSmooth.current === null) {
      fitSmooth.current = fitTarget;
    } else {
      const k = Math.min(1, dt * 3.2);
      fitSmooth.current += (fitTarget - fitSmooth.current) * k;
    }
    uniforms.uFit.value = fitSmooth.current;

    // --- the per-frame tween -----------------------------------------------
    // Each particle remembers where it was when the target changed (`origin`),
    // how long its own transition takes, and how far along it is. Unlike an
    // exponential lerp this reaches the target exactly, so the shape becomes
    // crisp at a predictable moment instead of staying soft forever.
    const { current, target: targetPos, currentCol, targetCol } = buffers;
    const seeds = identity.seed;
    const origin = originPos;
    const originCol = originColArr;
    const elapsed = elapsedArr;
    const duration = durationArr;

    let remaining = 0;
    let maxProgress = 0;
    let anyMoving = false;

    for (let i = 0; i < count; i++) {
      const j = i * 3;

      // A particle whose duration has not been set yet is not "finished" — it
      // simply has not started. Treating it as done made maxProgress hit 1
      // immediately, so the shape was reported crisp while still in flight.
      const dur = duration[i];
      let raw: number;
      if (dur <= 0) {
        raw = 0;
      } else {
        let t = elapsed[i];
        if (t < dur) {
          t = Math.min(dur, t + dt);
          elapsed[i] = t;
        }
        raw = t / dur;
      }

      // per-particle easing: smooth departure, smooth arrival
      const e = raw * raw * (3 - 2 * raw);

      const dx = targetPos[j] - current[j];
      const dy = targetPos[j + 1] - current[j + 1];
      const dz = targetPos[j + 2] - current[j + 2];

      if (raw < 1) {
        // position is a pure function of progress, so an interrupted morph
        // never snaps: it simply starts a new tween from where it is
        current[j] = origin[j] + (targetPos[j] - origin[j]) * e;
        current[j + 1] = origin[j + 1] + (targetPos[j + 1] - origin[j + 1]) * e;
        current[j + 2] = origin[j + 2] + (targetPos[j + 2] - origin[j + 2]) * e;

        currentCol[j] = originCol[j] + (targetCol[j] - originCol[j]) * e;
        currentCol[j + 1] = originCol[j + 1] + (targetCol[j + 1] - originCol[j + 1]) * e;
        currentCol[j + 2] = originCol[j + 2] + (targetCol[j + 2] - originCol[j + 2]) * e;

        // measure what is actually left *after* this frame's move
        remaining +=
          Math.abs(targetPos[j] - current[j]) +
          Math.abs(targetPos[j + 1] - current[j + 1]) +
          Math.abs(targetPos[j + 2] - current[j + 2]);
      } else {
        // landed: write the exact target once, then leave it alone
        if (current[j] !== targetPos[j] || current[j + 1] !== targetPos[j + 1]) {
          current[j] = targetPos[j];
          current[j + 1] = targetPos[j + 1];
          current[j + 2] = targetPos[j + 2];
          currentCol[j] = targetCol[j];
          currentCol[j + 1] = targetCol[j + 1];
          currentCol[j + 2] = targetCol[j + 2];
        }
      }

      if (raw > maxProgress) maxProgress = raw;
      // A particle still in flight means the shape is not crisp yet. Particles
      // with duration 0 have already landed (their position was set directly),
      // so they must not count as moving — otherwise `anyMoving` stayed true
      // forever after the first paint and the idle animation never started.
      if (dur > 0 && raw < 1) anyMoving = true;
    }

    // If every particle has landed, snap the counters so the shape is reported
    // (and rendered) as exactly crisp rather than "almost".
    if (!anyMoving) {
      // Guarantee the buffers are exactly on target. A particle whose tween was
      // never started (duration 0) could otherwise linger a hair off the mark.
      for (let i = 0; i < count; i++) {
        const j = i * 3;
        if (current[j] !== targetPos[j]) current[j] = targetPos[j];
        if (current[j + 1] !== targetPos[j + 1]) current[j + 1] = targetPos[j + 1];
        if (current[j + 2] !== targetPos[j + 2]) current[j + 2] = targetPos[j + 2];
      }
      remaining = 0;
    }

    geometry.getAttribute('position').needsUpdate = true;
    geometry.getAttribute('aColor').needsUpdate = true;

    // Depth of field: particles far from the focal plane get bigger and dimmer,
    // which reads as a camera lens and gives the flat point cloud some depth.
    const depth = geometry.getAttribute('aDepth') as THREE.BufferAttribute;
    const dArr = depth.array as Float32Array;
    for (let i = 0; i < count; i++) {
      const j = i * 3;
      // distance from the focal plane (z = 0), normalised
      dArr[i] = Math.min(1, Math.abs(current[j + 2]) * 1.6);
    }
    depth.needsUpdate = true;

    // swirl only while the cloud is still travelling: uSwell tracks how much
    // distance is left, so a landed shape is calm and a moving one is turbulent
    const avgRemaining = remaining / count;
    uniforms.uSwell.value = Math.min(0.5, avgRemaining * 0.55);

    // --- idle life ---------------------------------------------------------
    // Once the shape has landed there is nothing to move it, which used to make
    // a held gesture look frozen. These uniforms keep the formed shape alive:
    // a slow orbiting drift, a breathing pulse and a travelling wave.
    //
    // uIdle is 1 only when *every* particle has finished its tween, so the
    // decorative motion never fights the morph itself.
    uniforms.uIdle.value = anyMoving ? 0 : 1;
    uniforms.uBreath.value = Math.sin(uniforms.uTime.value * 0.9) * 0.5 + 0.5;
    uniforms.uWave.value = uniforms.uTime.value * 1.6;

    if (burstRef.current > 0) {
      burstRef.current = Math.max(0, burstRef.current - dt * 1.1);
      uniforms.uBurst.value = Math.sin(burstRef.current * Math.PI) * 1.15;
    } else if (uniforms.uBurst.value !== 0) {
      uniforms.uBurst.value = 0;
    }

    const g = groupRef.current;
    if (!g) return;

    const hand = handRef.current;
    // pointer fallback, then blend in the hand when it is visible
    let tx = smooth.current.x;
    let ty = smooth.current.y;
    if (hand?.present) {
      tx = (hand.palm.x - 0.5) * 2;
      ty = (hand.palm.y - 0.5) * 2;
    }
    smooth.current.x += (tx - smooth.current.x) * Math.min(1, dt * 2.2);
    smooth.current.y += (ty - smooth.current.y) * Math.min(1, dt * 2.2);

    // --- idle animation ----------------------------------------------------
    // Each formation gets its own motion so a held gesture never looks frozen:
    // the snowflake tumbles in 3D, the sleigh circles the screen, and so on.
    // It fades in only once the morph has finished, so it never fights the
    // transition, and fades out again when the next gesture arrives.
    const idleTarget = anyMoving ? 0 : 1;
    idleBlend.current += (idleTarget - idleBlend.current) * Math.min(1, dt * 2.4);
    const motion = IDLE_MOTION[activeFormation.current] ?? IDLE_MOTION.snowman;
    const pose = idleTransform(motion, uniforms.uTime.value, idleBlend.current, cam.aspect);

    // Parallax from the hand still applies, layered under the idle motion.
    const parallaxY = smooth.current.x * 0.45;
    const parallaxX = smooth.current.y * 0.18;

    // Rotation is applied directly, not smoothed. Smoothing the target every
    // frame turned the idle animation into a low-pass filter: the pose chased a
    // moving goal and arrived at roughly half amplitude, which made the snowman
    // look frozen. Parallax is already smoothed upstream via `smooth`.
    g.rotation.y = parallaxY + pose.rotY;
    g.rotation.x = parallaxX + pose.rotX;
    g.rotation.z = pose.rotZ;

    g.position.x = pose.posX;
    g.position.y = Math.sin(uniforms.uTime.value * 0.5) * 0.04 + pose.posY;
    g.position.z = pose.posZ;
    g.scale.setScalar(pose.scale);

    // exposed for check-idle-animations.mjs, which verifies each formation has
    // its own motion rather than one shared wobble
    (window as unknown as { __idlePose?: () => unknown }).__idlePose = () => ({
      formation: activeFormation.current,
      rotX: g.rotation.x,
      rotY: g.rotation.y,
      rotZ: g.rotation.z,
      posX: g.position.x,
      posY: g.position.y,
      posZ: g.position.z,
      blend: idleBlend.current,
    });
  });

  return (
    <group ref={groupRef}>
      <points geometry={geometry} material={material} frustumCulled={false} />
    </group>
  );
}
