import React, { useEffect, useRef } from "react";
import * as THREE from "three";

// ampRef: a mutable ref ({ current: 0..1 }) the parent updates every frame
// (from mic amplitude while listening, or a synthetic pulse while speaking)
// without triggering React re-renders.
export default function Orb3D({ ampRef }) {
  const mountRef = useRef(null);

  useEffect(() => {
    const mount = mountRef.current;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, mount.clientWidth / mount.clientHeight, 0.1, 100);
    camera.position.z = 6;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    const group = new THREE.Group();
    scene.add(group);

    const coreGeo = new THREE.IcosahedronGeometry(1.6, 3);
    const coreMat = new THREE.MeshBasicMaterial({ color: 0x00d4ff, wireframe: true, transparent: true, opacity: 0.55 });
    const core = new THREE.Mesh(coreGeo, coreMat);
    group.add(core);

    const glowGeo = new THREE.IcosahedronGeometry(1.62, 1);
    const glowMat = new THREE.MeshBasicMaterial({ color: 0x0a5f75, wireframe: true, transparent: true, opacity: 0.25 });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    group.add(glow);

    const particleCount = 700;
    const positions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
      const r = 2.2 + Math.random() * 0.6;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
    }
    const particleGeo = new THREE.BufferGeometry();
    particleGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const particleMat = new THREE.PointsMaterial({ color: 0x00d4ff, size: 0.02, transparent: true, opacity: 0.6 });
    const particles = new THREE.Points(particleGeo, particleMat);
    group.add(particles);

    const basePositions = coreGeo.attributes.position.array.slice();

    let mouseX = 0;
    let mouseY = 0;
    const onMouseMove = (e) => {
      mouseX = (e.clientX / window.innerWidth) * 2 - 1;
      mouseY = -(e.clientY / window.innerHeight) * 2 + 1;
    };
    window.addEventListener("mousemove", onMouseMove);

    const onResize = () => {
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener("resize", onResize);

    let frameId;
    let t = 0;
    let smoothedAmp = 0;
    const clock = new THREE.Clock();

    function animate() {
      frameId = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.05); // clamp so a stalled tab doesn't jump

      // Reacts to both listening (mic) and speaking (TTS playback) amplitude -
      // ChatPanel/speech.js write into the same shared ampRef for both.
      // Raw analyser data is noisy frame to frame; smoothing it here (rather
      // than reacting to the raw value directly) is what turns "jitter" into
      // a graceful, springy breathing motion.
      const rawAmp = ampRef?.current || 0;
      smoothedAmp += (rawAmp - smoothedAmp) * Math.min(1, dt * 6);
      t += dt;

      // Slow float, like the orb has real inertia in zero gravity.
      group.position.y = Math.sin(t * 0.5) * 0.12;
      group.position.x = Math.sin(t * 0.33) * 0.04;

      // Idle rotation, heavily damped cursor influence for a graceful drift
      // rather than snapping to follow the mouse.
      group.rotation.y += dt * 0.12;
      group.rotation.x += (mouseY * 0.3 - group.rotation.x) * dt * 1.2;
      group.rotation.z += (mouseX * 0.15 - group.rotation.z) * dt * 1.2;

      // Coherent, direction-based "breathing" distortion - using each
      // vertex's own 3D direction (not its arbitrary buffer index) as the
      // noise phase keeps neighbouring vertices moving together instead of
      // flickering independently, which is what reads as "smooth" vs "cheap".
      const posAttr = core.geometry.attributes.position;
      const breathe = 1 + Math.sin(t * 0.7) * 0.02; // slow ambient breathing, always present
      for (let i = 0; i < posAttr.count; i++) {
        const ix = i * 3;
        const bx = basePositions[ix];
        const by = basePositions[ix + 1];
        const bz = basePositions[ix + 2];
        const len = Math.sqrt(bx * bx + by * by + bz * bz) || 1;
        const nx = bx / len;
        const ny = by / len;
        const nz = bz / len;
        const wave =
          Math.sin(nx * 3 + t * 0.6) * Math.sin(ny * 3 + t * 0.5) * Math.sin(nz * 3 + t * 0.4);
        const scale = breathe * (1 + wave * 0.035 * (0.4 + smoothedAmp)) + smoothedAmp * 0.1;
        posAttr.array[ix] = nx * len * scale;
        posAttr.array[ix + 1] = ny * len * scale;
        posAttr.array[ix + 2] = nz * len * scale;
      }
      posAttr.needsUpdate = true;

      const s = breathe * (1 + smoothedAmp * 0.1);
      glow.scale.setScalar(s);
      glow.rotation.y -= dt * 0.04;
      particles.rotation.y -= dt * 0.05;
      particles.scale.setScalar(1 + smoothedAmp * 0.04);

      renderer.render(scene, camera);
    }
    animate();

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      coreGeo.dispose();
      glowGeo.dispose();
      particleGeo.dispose();
      coreMat.dispose();
      glowMat.dispose();
      particleMat.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [ampRef]);

  return <div className="orb-canvas" ref={mountRef} />;
}
