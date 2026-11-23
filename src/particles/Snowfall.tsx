import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { makeRng } from '../lib/rng';

interface Props {
  count?: number;
}

/**
 * Slow drifting snow behind the formation. It gives the scene a sense of depth
 * and constant motion — without it the dark background reads as an empty void
 * whenever the shape is at rest.
 *
 * Rendered as its own tiny point cloud with a cheap shader, so it costs almost
 * nothing next to the 110k formation particles.
 */
export function Snowfall({ count = 900 }: Props) {
  const pointsRef = useRef<THREE.Points>(null);
  const { size } = useThree();

  const { geometry, material } = useMemo(() => {
    const rng = makeRng(777);
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    const scale = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      // spread wider than the shape so flakes drift past its edges
      pos[i * 3] = (rng() - 0.5) * 14;
      pos[i * 3 + 1] = (rng() - 0.5) * 10;
      pos[i * 3 + 2] = -1.2 - rng() * 5;
      seed[i] = rng();
      scale[i] = 0.5 + rng() * 1.1;
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
      uniforms: {
        uTime: { value: 0 },
        uViewportH: { value: 900 },
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uViewportH;
        attribute float aSeed;
        attribute float aScale;
        varying float vAlpha;

        void main() {
          vec3 pos = position;

          // slow fall with a gentle sideways sway, wrapping at the bottom
          float fall = mod(pos.y - uTime * (0.16 + aSeed * 0.22) + 5.0, 10.0) - 5.0;
          pos.y = fall;
          pos.x += sin(uTime * 0.5 + aSeed * 31.0) * 0.35;

          vec4 mv = modelViewMatrix * vec4(pos, 1.0);
          gl_Position = projectionMatrix * mv;

          float dist = max(0.2, -mv.z);
          gl_PointSize = aScale * 0.004 * uViewportH / dist;
          gl_PointSize = clamp(gl_PointSize, 1.0, 9.0);

          // fade at the top and bottom edges so flakes appear and vanish softly
          float edge = smoothstep(5.0, 3.4, abs(fall));
          vAlpha = edge * (0.25 + aSeed * 0.5);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float d = length(uv);
          if (d > 0.5) discard;
          float core = smoothstep(0.5, 0.0, d);
          vec3 col = mix(vec3(0.62, 0.84, 1.0), vec3(1.0), core);
          gl_FragColor = vec4(col, core * vAlpha);
        }
      `,
    });

    return { geometry: g, material: m };
  }, [count]);

  useFrame((state) => {
    material.uniforms.uTime.value += Math.min(state.clock.getDelta(), 0.05);
    material.uniforms.uViewportH.value = size.height * Math.min(state.gl.getPixelRatio(), 2);
  });

  return <points ref={pointsRef} geometry={geometry} material={material} frustumCulled={false} />;
}
