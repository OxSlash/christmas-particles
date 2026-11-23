import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * Soft drifting colour behind the formation.
 *
 * The scene is a single bright shape on pure black, which left most of the
 * screen dead. This paints very faint nebula-like patches so the space reads as
 * a place rather than a void. Intensity is deliberately low (a few percent) —
 * the particles must stay the subject, this is only the room they sit in.
 */
export function Aurora() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 } },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          varying vec2 vUv;

          // soft round falloff
          float blob(vec2 p, vec2 c, float r) {
            return smoothstep(r, 0.0, length(p - c));
          }

          void main() {
            vec2 uv = vUv;
            // keep the centre darker so the shape always reads against it
            float vignette = smoothstep(0.10, 0.80, length(uv - 0.5));

            vec3 col = vec3(0.0);

            // three slow drifting patches, each a different festive hue
            vec2 c1 = vec2(0.28 + sin(uTime * 0.07) * 0.10, 0.62 + cos(uTime * 0.05) * 0.08);
            vec2 c2 = vec2(0.74 + cos(uTime * 0.06) * 0.10, 0.38 + sin(uTime * 0.08) * 0.09);
            vec2 c3 = vec2(0.52 + sin(uTime * 0.04) * 0.14, 0.22 + cos(uTime * 0.06) * 0.07);

            col += vec3(0.16, 0.44, 0.60) * blob(uv, c1, 0.62);  // cool teal
            col += vec3(0.44, 0.16, 0.38) * blob(uv, c2, 0.56);  // deep plum
            col += vec3(0.44, 0.32, 0.12) * blob(uv, c3, 0.50);  // warm gold

            // fade toward the edges, and keep it faint overall
            col *= vignette * 0.85;

            // additive blending: alpha stays 1, colour carries the light
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      }),
    [],
  );

  const meshRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    material.uniforms.uTime.value += Math.min(state.clock.getDelta(), 0.05);
  });

  return (
    <mesh ref={meshRef} position={[0, 0, -9]} material={material} frustumCulled={false} renderOrder={-1000}>
      <planeGeometry args={[40, 26]} />
    </mesh>
  );
}
