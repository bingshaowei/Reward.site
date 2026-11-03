'use client';

import { useEffect, useRef, useState } from 'react';

const chestStyles = [
  { name: '旧木箱', minimum: 0 },
  { name: '描金木箱', minimum: 100 },
  { name: '宝石木箱', minimum: 500 },
  { name: '金冠宝箱', minimum: 1500 },
] as const;

export function WalletChest({ balance }: { balance: number }) {
  const tier = balance >= 1500 ? 3 : balance >= 500 ? 2 : balance >= 100 ? 1 : 0;
  const style = chestStyles[tier];
  const nextStyle = chestStyles[tier + 1];
  const host = useRef<HTMLDivElement>(null);
  const reactToClick = useRef<(() => void) | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const fallbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ready, setReady] = useState(false);
  const [happy, setHappy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let dispose = () => {};

    void import('three').then(THREE => {
      const element = host.current;
      if (cancelled || !element) return;
      let renderer;
      try {
        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      } catch {
        return;
      }
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      element.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 30);
      camera.position.set(3.25, 2.3, 6.4);
      camera.lookAt(0, 0.68, 0.08);
      scene.add(new THREE.HemisphereLight(0xfff8f2, 0xc9819a, 1.65));
      const key = new THREE.DirectionalLight(0xfff2e9, 2.3);
      key.position.set(-3, 5, 4);
      scene.add(key);
      const rim = new THREE.DirectionalLight(0xffe0ee, 1.4);
      rim.position.set(3, 2, -4);
      scene.add(rim);

      const chest = new THREE.Group();
      scene.add(chest);
      const material = (color: number, metalness = 0) =>
        new THREE.MeshStandardMaterial({ color, metalness, roughness: 0.48 });
      const wood = material(0x784936);
      const planks = [material(0x985f41), material(0xaa754c), material(0x865038)];
      const inside = material(0x4d3026);
      const brass = material(tier === 0 ? 0xb18a54 : 0xe8b362, 0.46);
      const edge = material(0x916438, 0.35);
      const patina = material(0x62705a, 0.16);
      const gold = material(0xffcd72, 0.57);

      const grain = document.createElement('canvas');
      grain.width = 512;
      grain.height = 256;
      const brush = grain.getContext('2d');
      let woodTexture: InstanceType<typeof THREE.CanvasTexture> | undefined;
      if (brush) {
        brush.fillStyle = '#f2dbc4';
        brush.fillRect(0, 0, grain.width, grain.height);
        for (let row = 0; row < 176; row++) {
          const base = row * 1.48;
          brush.strokeStyle = row % 7 === 0 ? '#79503c50' : row % 3 === 0 ? '#fff7e19c' : '#9d715852';
          brush.lineWidth = row % 7 === 0 ? 1.35 : 0.66;
          brush.beginPath();
          for (let x = 0; x <= grain.width; x += 4) {
            const bend = Math.sin(x / 53 + row * 0.18) * 2.6;
            const y = base + bend + Math.sin(x / 17 + row * 0.42) * 0.73;
            if (x === 0) brush.moveTo(x, y);
            else brush.lineTo(x, y);
          }
          brush.stroke();
        }
        for (const [x, y] of [[138, 72], [358, 174]]) {
          for (let ring = 1; ring <= 7; ring++) {
            brush.strokeStyle = ring % 2 ? '#67452d55' : '#b28b6260';
            brush.lineWidth = 1.1;
            brush.beginPath();
            brush.ellipse(x, y, 5 + ring * 3.1, 1 + ring * 1.3, -0.045, 0, Math.PI * 2);
            brush.stroke();
          }
        }
        for (let mark = 0; mark < 42; mark++) {
          const x = (mark * 113) % 501;
          const y = (mark * 47) % 249;
          brush.fillStyle = mark % 3 ? '#70432f42' : '#fff2cf9c';
          brush.fillRect(x, y, 3 + (mark % 9), mark % 4 === 0 ? 2 : 1);
        }
        woodTexture = new THREE.CanvasTexture(grain);
        woodTexture.colorSpace = THREE.SRGBColorSpace;
        woodTexture.wrapS = woodTexture.wrapT = THREE.RepeatWrapping;
        woodTexture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        for (const plank of planks) {
          plank.map = woodTexture;
          plank.bumpMap = woodTexture;
          plank.bumpScale = 0.026;
          plank.roughness = 0.64;
        }
      }

      const rivetGeometry = new THREE.SphereGeometry(0.034, 16, 10);
      function rivet(parent: typeof chest, x: number, y: number, z: number) {
        const cap = new THREE.Mesh(rivetGeometry, brass);
        cap.position.set(x, y, z);
        cap.scale.z = 0.46;
        parent.add(cap);
      }

      function box(parent: typeof chest, surface: typeof wood, size: [number, number, number], position: [number, number, number]) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), surface);
        mesh.position.set(...position);
        parent.add(mesh);
      }

      box(chest, inside, [2.10, 0.17, 1.34], [0, 0.025, 0]);
      for (const side of [-1, 1]) {
        for (let row = 0; row < planks.length; row++) {
          const y = 0.18 + row * 0.193;
          box(chest, planks[row], [2.08, 0.186, 0.12], [0, y, side * 0.616]);
          box(chest, planks[row], [0.12, 0.186, 1.23], [side * 0.982, y, 0]);
        }
        box(chest, brass, [0.15, 0.67, 0.045], [side * 0.79, 0.34, 0.688]);
        box(chest, brass, [0.15, 0.67, 0.045], [side * 0.79, 0.34, -0.688]);
        for (const y of [0.15, 0.36, 0.58]) rivet(chest, side * 0.79, y, 0.719);
        box(chest, edge, [0.10, 0.62, 0.095], [side * 1.015, 0.36, 0.643]);
        box(chest, patina, [0.040, 0.14, 0.009], [side * 0.841, 0.23, 0.715]);
        box(chest, patina, [0.026, 0.082, 0.009], [side * 1.025, 0.44, 0.696]);
      }
      box(chest, edge, [2.17, 0.075, 1.40], [0, 0.08, 0]);

      const lid = new THREE.Group();
      lid.position.set(0, 0.665, -0.69);
      chest.add(lid);
      const profile = new THREE.Shape();
      profile.moveTo(0, 0);
      profile.bezierCurveTo(0.02, 0.72, 1.37, 0.72, 1.39, 0);
      profile.closePath();
      function arch(surface: typeof wood, width: number, x: number, lift: number) {
        const geometry = new THREE.ExtrudeGeometry(profile, { depth: width, bevelSize: 0.025, bevelThickness: 0.025, bevelSegments: 3, curveSegments: 24 });
        const mesh = new THREE.Mesh(geometry, surface);
        mesh.rotation.y = -Math.PI / 2;
        mesh.position.set(x + width / 2, lift, 0);
        lid.add(mesh);
      }
      arch(planks[1], 2.10, 0, 0);
      for (const x of [-0.79, 0.79]) arch(brass, 0.15, x, 0.023);
      box(lid, edge, [2.17, 0.055, 1.41], [0, 0.015, 0.695]);
      box(lid, brass, [0.32, 0.31, 0.105], [0, -0.065, 1.42]);
      box(lid, edge, [0.23, 0.23, 0.028], [0, -0.065, 1.474]);
      const keyhole = new THREE.Mesh(rivetGeometry, inside);
      keyhole.position.set(0, -0.041, 1.491);
      keyhole.scale.z = 0.35;
      lid.add(keyhole);
      box(lid, inside, [0.033, 0.062, 0.014], [0, -0.084, 1.49]);
      for (const x of [-0.79, 0.79]) rivet(lid, x, 0.07, 1.401);

      if (tier >= 1) {
        for (const y of [0.15, 0.61]) box(chest, gold, [1.36, 0.035, 0.028], [0, y, 0.694]);
        for (const x of [-0.66, 0.66]) {
          box(chest, gold, [0.03, 0.46, 0.028], [x, 0.38, 0.694]);
          box(lid, gold, [0.18, 0.036, 0.037], [x, 0.10, 1.399]);
        }
      }

      if (tier >= 2) {
        const jade = new THREE.MeshStandardMaterial({ color: 0x268f7a, roughness: 0.24, metalness: 0.26, emissive: 0x0c3026, emissiveIntensity: 0.32 });
        for (const x of [-0.42, 0.42]) {
          box(chest, gold, [0.19, 0.19, 0.063], [x, 0.39, 0.72]);
          const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.109), jade);
          gem.position.set(x, 0.39, 0.768);
          gem.scale.z = 0.56;
          chest.add(gem);
        }
      }

      if (tier >= 3) {
        const crown = new THREE.Shape();
        const points = [[-0.22, 0], [-0.26, 0.27], [-0.10, 0.15], [0, 0.34], [0.10, 0.15], [0.26, 0.27], [0.22, 0]];
        crown.moveTo(points[0][0], points[0][1]);
        for (const [x, y] of points.slice(1)) crown.lineTo(x, y);
        crown.closePath();
        const emblem = new THREE.Mesh(new THREE.ExtrudeGeometry(crown, { depth: 0.023, bevelSize: 0.011, bevelThickness: 0.011, bevelSegments: 3 }), gold);
        emblem.position.set(0, 0.22, 0.706);
        chest.add(emblem);
        for (const x of [-1.015, 1.015]) arch(gold, 0.07, x, 0.031);
      }

      const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.075, 40), gold);
      coin.visible = false;
      scene.add(coin);
      const shine = new THREE.PointLight(0xffc66d, 0, 3);
      shine.position.set(0, 1.02, 0.2);
      scene.add(shine);

      const motion = matchMedia('(prefers-reduced-motion: reduce)');
      let frame = 0;
      const render = () => renderer.render(scene, camera);
      const resize = () => {
        const { clientWidth, clientHeight } = element;
        if (!clientWidth || !clientHeight) return;
        camera.aspect = clientWidth / clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(clientWidth, clientHeight, false);
        render();
      };
      const observer = new ResizeObserver(resize);
      observer.observe(element);
      resize();
      setReady(true);

      reactToClick.current = () => {
        cancelAnimationFrame(frame);
        const start = performance.now();
        const tick = (now: number) => {
          const progress = Math.min((now - start) / 1050, 1);
          const opening = Math.min(progress / 0.26, (1 - progress) / 0.23, 1);
          const open = Math.sin(Math.PI * opening / 2);
          lid.rotation.x = -(motion.matches ? (progress < 1 ? 0.65 : 0) : open * 1.25);
          shine.intensity = 4 * open;
          coin.visible = !motion.matches && progress >= 0.22 && progress < 0.76;
          if (coin.visible) {
            const fall = (progress - 0.22) / 0.54;
            coin.position.set(0.08, 2.16 - fall * fall * 1.68, 0.19);
            coin.rotation.set(1 + fall * 4.2, fall * 5, 0.28);
          }
          render();
          if (progress < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      };
      dispose = () => {
        observer.disconnect();
        cancelAnimationFrame(frame);
        reactToClick.current = null;
        const geometries = new Set<InstanceType<typeof THREE.BufferGeometry>>();
        const materials = new Set<typeof wood>();
        scene.traverse(object => {
          if (object instanceof THREE.Mesh) {
            geometries.add(object.geometry);
            materials.add(object.material);
          }
        });
        geometries.forEach(geometry => geometry.dispose());
        materials.forEach(surface => surface.dispose());
        woodTexture?.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
    }).catch(() => {});

    return () => {
      cancelled = true;
      dispose();
      if (fallbackTimer.current) clearTimeout(fallbackTimer.current);
      if (audio.current) void audio.current.close().catch(() => {});
      audio.current = null;
    };
  }, [tier]);

  async function playCoin() {
    try {
      const context = audio.current ?? new AudioContext();
      audio.current = context;
      if (context.state === 'suspended') await context.resume();
      const start = context.currentTime;
      const notes = [
        { frequency: 1568, delay: 0, volume: 0.09 },
        { frequency: 2490, delay: 0.016, volume: 0.06 },
        { frequency: 3136, delay: 0.055, volume: 0.05 },
      ];
      for (const { frequency, delay, volume } of notes) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const time = start + delay;
        oscillator.frequency.setValueAtTime(frequency, time);
        gain.gain.setValueAtTime(0.001, time);
        gain.gain.exponentialRampToValueAtTime(volume, time + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.25);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(time);
        oscillator.stop(time + 0.26);
      }
    } catch {
      // The visual feedback still responds if this browser cannot play audio.
    }
  }

  function tap() {
    reactToClick.current?.();
    void playCoin();
    if (fallbackTimer.current) clearTimeout(fallbackTimer.current);
    setHappy(true);
    fallbackTimer.current = setTimeout(() => setHappy(false), 1050);
  }

  return <button type="button" className="wallet-chest" onClick={tap} aria-label="打开藏宝箱，听金币响声">
    <div className="wallet-chest-stage" aria-hidden="true">
      <div ref={host} className="wallet-chest-canvas" />
      {!ready && <span className="wallet-chest-fallback">{happy ? '🪙✨' : '🎁'}</span>}
    </div>
    <span className="wallet-chest-caption">{happy ? '叮！' : `打开${style.name}`}</span>
    <span className="wallet-chest-progress">{nextStyle ? `可用积分 ${nextStyle.minimum.toLocaleString('zh-CN')} 解锁${nextStyle.name}` : '已解锁最高外观'}</span>
  </button>;
}
