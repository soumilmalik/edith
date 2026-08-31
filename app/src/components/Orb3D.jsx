import React, { useEffect, useRef } from "react";
import * as THREE from "three";

// ampRef: a mutable ref ({ current: 0..1 }) the parent updates every frame
// (from mic amplitude while listening, or a synthetic pulse while speaking)
// without triggering React re-renders.
// typeRef: a mutable ref ({ current: <count> }) incremented once per
// keystroke in the chat input - each new count gives the orb a tiny random
// spring "nudge" so it visibly reacts as you type, without a re-render.
export default function Orb3D({ ampRef, typeRef }) {
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
    const particleMat = new THREE.PointsMaterial({ color: 0x00d4ff, size: 0.022, transparent: true, opacity: 0.55 });
    const particles = new THREE.Points(particleGeo, particleMat);
    group.add(particles);

    const basePositions = coreGeo.attributes.position.array.slice();
    const particleBase = positions.slice();

    let mouseX = 0;
    let mouseY = 0;
    const onPointerMove = (e) => {
      const x = e.touches ? e.touches[0].clientX : e.clientX;
      const y = e.touches ? e.touches[0].clientY : e.clientY;
      mouseX = (x / window.innerWidth) * 2 - 1;
      mouseY = -(y / window.innerHeight) * 2 + 1;
    };
    window.addEventListener("mousemove", onPointerMove);
    window.addEventListener("touchmove", onPointerMove, { passive: true });

    // A tap/click anywhere sends a quick ripple of light through the orb -
    // small, so it reads as "aware of you" rather than a fireworks show.
    let clickEnergy = 0;
    const onPointerDown = () => {
      clickEnergy = 1;
    };
    window.addEventListener("pointerdown", onPointerDown);

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

    // Per-keystroke nudge: a tiny damped spring, kicked with a small random
    // velocity on each new keystroke, that settles back to rest on its own.
    let lastTypeCount = typeRef?.current || 0;
    let jitterX = 0;
    let jitterY = 0;
    let jitterVX = 0;
    let jitterVY = 0;

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

      // Decays smoothly regardless of frame rate - a quick flash of light
      // rather than a lingering glow.
      clickEnergy *= Math.exp(-dt * 3.2);

      // Very small critically-damped spring, kicked once per keystroke -
      // settles back to center in well under half a second.
      if (typeRef && typeRef.current !== lastTypeCount) {
        lastTypeCount = typeRef.current;
        jitterVX += (Math.random() - 0.5) * 0.5;
        jitterVY += (Math.random() - 0.5) * 0.5;
      }
      const springK = 90;
      const springDamping = 11;
      jitterVX += (-springK * jitterX - springDamping * jitterVX) * dt;
      jitterVY += (-springK * jitterY - springDamping * jitterVY) * dt;
      jitterX += jitterVX * dt;
      jitterY += jitterVY * dt;

      // Slow float, like the orb has real inertia in zero gravity.
      group.position.y = Math.sin(t * 0.5) * 0.12 + jitterY;
      group.position.x = Math.sin(t * 0.33) * 0.04 + jitterX;

      // Idle rotation, with a snappier-but-still-smooth cursor tilt layered
      // on top - noticeably "looks toward" the pointer rather than barely
      // reacting, without ever snapping instantly to it.
      group.rotation.y += dt * 0.12;
      group.rotation.x += (mouseY * 0.4 - group.rotation.x) * dt * 2.4;
      group.rotation.z += (mouseX * 0.22 - group.rotation.z) * dt * 2.4;

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
        // Two layered frequencies instead of one, so the motion never quite
        // repeats itself - reads as organic "flow" rather than a mechanical
        // pulse.
        const wave =
          Math.sin(nx * 3 + t * 0.6) * Math.sin(ny * 3 + t * 0.5) * Math.sin(nz * 3 + t * 0.4) +
          0.4 * Math.sin(nx * 5 - t * 0.35) * Math.sin(nz * 5 + t * 0.28);
        const scale = breathe * (1 + wave * 0.035 * (0.4 + smoothedAmp)) + smoothedAmp * 0.1 + clickEnergy * 0.07;
        posAttr.array[ix] = nx * len * scale;
        posAttr.array[ix + 1] = ny * len * scale;
        posAttr.array[ix + 2] = nz * len * scale;
      }
      posAttr.needsUpdate = true;

      const s = breathe * (1 + smoothedAmp * 0.1 + clickEnergy * 0.05);
      glow.scale.setScalar(s);
      glow.rotation.y -= dt * 0.04;

      // Particles drift outward/inward along their own radius in a slow flow
      // field (not just spinning as a rigid shell), plus a light-speckle
      // reaction to clicks.
      const pPos = particles.geometry.attributes.position;
      for (let i = 0; i < particleCount; i++) {
        const ix = i * 3;
        const bx = particleBase[ix];
        const by = particleBase[ix + 1];
        const bz = particleBase[ix + 2];
        const flow = 1 + Math.sin(bx * 1.3 + t * 0.25) * Math.cos(by * 1.1 - t * 0.2) * 0.08;
        pPos.array[ix] = bx * flow;
        pPos.array[ix + 1] = by * flow;
        pPos.array[ix + 2] = bz * flow;
      }
      pPos.needsUpdate = true;
      particles.rotation.y -= dt * 0.05;
      particles.scale.setScalar(1 + smoothedAmp * 0.04 + clickEnergy * 0.08);
      particleMat.opacity = 0.55 + clickEnergy * 0.35;

      // Slow, subtle hue drift around cyan - keeps the orb feeling alive
      // without drifting far enough to clash with the UI's blue theme.
      const hue = (0.52 + Math.sin(t * 0.08) * 0.02) % 1;
      coreMat.color.setHSL(hue, 1, 0.5 + clickEnergy * 0.15);
      particleMat.color.setHSL(hue, 1, 0.5 + clickEnergy * 0.2);

      renderer.render(scene, camera);
    }
    animate();

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("mousemove", onPointerMove);
      window.removeEventListener("touchmove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerDown);
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
  }, [ampRef, typeRef]);

  return <div className="orb-canvas" ref={mountRef} />;
}
