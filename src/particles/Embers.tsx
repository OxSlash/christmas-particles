import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { makeRng } from '../lib/rng';

interface Props {
  count?: number;
}

/**
 * Warm sparks rising around the formation, like embers from a fireplace.
 *
 * These move on their own, independent of the gesture, so the scene is never
 * still even when the user holds one gesture for a long time. Kept in front of
 * and behind the shape so they add depth rather than sitting on one plane.
 */
export function Embers({ count = 320 }: Props) {
  const { size } = useThree();

  const { geometry, material } = useMemo(() => {
    const rng = makeRng(9137);
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    const scale = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      // scattered in a loose column around the shape
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * 4.5;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = (rng() - 0.5) * 9;
      pos[i * 3 + 2] = Math.sin(a) * r * 0.55 + (rng() - 0.5) * 1.2;
      seed[i] = rng();
      scale[i] = 0.35 + rng() * 0.9;
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    g.setAttribute('aScale', new THREE.BufferAttribute(scale, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 12);

    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uViewportH: { value: 900 } },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uViewportH;
        attribute float aSeed;
        attribute float aScale;
        varying float vAlpha;
        varying float vHeat;

        void main() {
          vec3 pos = position;

          // rise, then wrap from the bottom; each ember at its own speed
          float speed = 0.25 + aSeed * 0.45;
          float rise = mod(pos.y + uTime * speed + 4.5, 9.0) - 4.5;
          pos.y = rise;

          // drift sideways as they climb, and swirl a little
          pos.x += sin(uTime * (0.5 + aSeed * 0.6) + aSeed * 24.0) * 0.45;
          pos.z += cos(uTime * (0.4 + aSeed * 0.5) + aSeed * 17.0) * 0.3;

          vec4 mv = modelViewMatrix * vec4(pos, 1.0);
          gl_Position = projectionMatrix * mv;

          float dist = max(0.2, -mv.z);
          gl_PointSize = aScale * 0.006 * uViewportH / dist;
          gl_PointSize = clamp(gl_PointSize, 1.0, 14.0);

          // fade in at the bottom, out at the top, plus a slow pulse
          float edge = smoothstep(4.5, 3.0, abs(rise));
          float pulse = 0.55 + 0.45 * sin(uTime * (2.0 + aSeed * 3.0) + aSeed * 40.0);
          vAlpha = edge * pulse * (0.35 + aSeed * 0.5);
          vHeat = aSeed;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        varying float vHeat;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float d = length(uv);
          if (d > 0.5) discard;
          float core = smoothstep(0.5, 0.0, d);
          // warm gold through to a pale ember tip
          vec3 warm = mix(vec3(1.0, 0.62, 0.22), vec3(1.0, 0.92, 0.72), vHeat);
          gl_FragColor = vec4(warm, core * vAlpha);
        }
      `,
    });

    return { geometry: g, material: m };
  }, [count]);

  const pointsRef = useRef<THREE.Points>(null);

  useFrame((state) => {
    material.uniforms.uTime.value += Math.min(state.clock.getDelta(), 0.05);
    material.uniforms.uViewportH.value = size.height * Math.min(state.gl.getPixelRatio(), 2);
  });

  return <points ref={pointsRef} geometry={geometry} material={material} frustumCulled={false} />;
}
