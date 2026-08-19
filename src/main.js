import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import WebGPU from 'three/addons/capabilities/WebGPU.js';
import './styles.css';

import { createParameters } from './simulation/parameters.js';
import { createSimulation } from './simulation/createSimulation.js';
import { createLabPanel } from './ui/labPanel.js';

const PARTICLE_COUNT = 131072;

const PERFORMANCE_SCENES = {
  1: {
    name: 'NUBE EN REPOSO',
    radialEnabled: 0, radialStrength: 0,
    vortexEnabled: 0, vortexStrength: 0,
    dragEnabled: 1, dragCoefficient: 0.18,
    maxSpeed: 0.9, timeScale: 0.65,
    windEnabled: 0, wind: new THREE.Vector3(0, 0, 0)
  },
  2: {
    name: 'FORMACIÓN',
    radialEnabled: 1, radialStrength: 3.5,
    vortexEnabled: 0, vortexStrength: 0,
    dragEnabled: 1, dragCoefficient: 0.12,
    maxSpeed: 2.5, timeScale: 0.85,
    windEnabled: 0, wind: new THREE.Vector3(0, 0, 0)
  },
  3: {
    name: 'DISCO DE ACRECIÓN',
    radialEnabled: 1, radialStrength: 1.6,
    vortexEnabled: 1, vortexStrength: 2.8,
    dragEnabled: 1, dragCoefficient: 0.1,
    maxSpeed: 3.5, timeScale: 1,
    windEnabled: 0, wind: new THREE.Vector3(0, 0, 0)
  },
  4: {
    name: 'COLAPSO ACELERADO',
    radialEnabled: 1, radialStrength: 6,
    vortexEnabled: 1, vortexStrength: 0.4,
    dragEnabled: 1, dragCoefficient: 0.03,
    maxSpeed: 8, timeScale: 1.25,
    windEnabled: 0, wind: new THREE.Vector3(0, 0, 0)
  },
  5: {
    name: 'SUPERNOVA',
    radialEnabled: 1, radialStrength: -10,
    vortexEnabled: 1, vortexStrength: 1.2,
    dragEnabled: 1, dragCoefficient: 0.02,
    maxSpeed: 10, timeScale: 1.4,
    windEnabled: 0, wind: new THREE.Vector3(0, 0, 0)
  }
};

async function main() {
  const mount = document.querySelector('#app');

  if (!WebGPU.isAvailable()) {
    mount.appendChild(WebGPU.getErrorMessage());
    throw new Error('Este proyecto requiere WebGPU para ejecutar compute shaders.');
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#03050a');

  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.05, 100);
  camera.position.set(0, 0, 11);

  const renderer = new THREE.WebGPURenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  mount.appendChild(renderer.domElement);
  await renderer.init();

  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.06;
  orbit.target.set(0, 0, 0);

  const params = createParameters();
  const simulation = createSimulation({ renderer, scene, params, count: PARTICLE_COUNT });

  const attractorHelper = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 16, 12),
    new THREE.MeshBasicMaterial({ color: '#ffffff' })
  );
  scene.add(attractorHelper);
  const axes = new THREE.AxesHelper(1.5);
  scene.add(axes);

  const pointerNdc = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  const interactionPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const hit = new THREE.Vector3();

  addEventListener('pointermove', (event) => {
    if (mode === 'PERFORMANCE') return;
    pointerNdc.x = (event.clientX / innerWidth) * 2 - 1;
    pointerNdc.y = -(event.clientY / innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointerNdc, camera);
    if (raycaster.ray.intersectPlane(interactionPlane, hit)) {
      params.attractor.value.copy(hit);
      attractorHelper.position.copy(hit);
    }
  });

  let paused = false;
  let mode = 'LAB';
  let panel;
  let performanceScene = 1;
  let transitionSpeed = 2.8;
  let supernovaTimer = 0;
  let performanceTarget = PERFORMANCE_SCENES[1];

  const applyPreset = (id) => {
    params.windEnabled.value = 0;
    params.radialEnabled.value = 0;
    params.vortexEnabled.value = 0;
    params.dragEnabled.value = 0;
    params.wind.value.set(0, 0, 0);
    params.initialSpeed.value = 0;

    if (id === 'inertia') params.initialSpeed.value = 0.8;
    else if (id === 'wind') { params.windEnabled.value = 1; params.wind.value.set(1.5, 0, 0); }
    else if (id === 'attract') { params.radialEnabled.value = 1; params.radialStrength.value = 3.0; }
    else if (id === 'repel') { params.radialEnabled.value = 1; params.radialStrength.value = -3.0; }
    else if (id === 'vortex') {
      params.radialEnabled.value = 1; params.radialStrength.value = 1.0;
      params.vortexEnabled.value = 1; params.vortexStrength.value = 3.0;
      params.dragEnabled.value = 1; params.dragCoefficient.value = 0.08;
    }
    simulation.reset();
    panel?.refresh();
  };

  const startPerformanceScene = (id) => {
    if (mode !== 'PERFORMANCE') return;
    performanceScene = id;
    performanceTarget = PERFORMANCE_SCENES[id];
    supernovaTimer = (id === 5) ? 0.9 : 0;
    hud.innerHTML = `<strong>PERFORMANCE</strong> · ${performanceTarget.name} · 1–5: escenas · R: reset`;
  };

  const setMode = (next) => {
    mode = next;
    const lab = mode === 'LAB';
    panel.setVisible(lab);
    axes.visible = lab;
    attractorHelper.visible = lab;
    document.body.classList.toggle('performance-mode', !lab);

    if (!lab) {
      params.attractor.value.set(0, 0, 0);
      attractorHelper.position.set(0, 0, 0);
      startPerformanceScene(1);
    } else {
      hud.innerHTML = '<strong>LAB</strong> · P: performance · R: reset · 1–5: pruebas';
    }
  };

  const updatePerformanceTransition = (deltaSeconds) => {
    if (mode !== 'PERFORMANCE') return;

    if (supernovaTimer > 0) {
      supernovaTimer -= deltaSeconds;
      if (supernovaTimer <= 0) startPerformanceScene(1);
    }

    const target = performanceTarget;
    const t = 1 - Math.exp(-transitionSpeed * deltaSeconds);

    params.radialEnabled.value = THREE.MathUtils.lerp(params.radialEnabled.value, target.radialEnabled, t);
    params.radialStrength.value = THREE.MathUtils.lerp(params.radialStrength.value, target.radialStrength, t);
    params.vortexEnabled.value = THREE.MathUtils.lerp(params.vortexEnabled.value, target.vortexEnabled, t);
    params.vortexStrength.value = THREE.MathUtils.lerp(params.vortexStrength.value, target.vortexStrength, t);
    params.dragEnabled.value = THREE.MathUtils.lerp(params.dragEnabled.value, target.dragEnabled, t);
    params.dragCoefficient.value = THREE.MathUtils.lerp(params.dragCoefficient.value, target.dragCoefficient, t);
    params.maxSpeed.value = THREE.MathUtils.lerp(params.maxSpeed.value, target.maxSpeed, t);
    params.timeScale.value = THREE.MathUtils.lerp(params.timeScale.value, target.timeScale, t);
    params.windEnabled.value = THREE.MathUtils.lerp(params.windEnabled.value, target.windEnabled, t);
    params.wind.value.lerp(target.wind, t);
  };

  panel = createLabPanel({
    params,
    onReset: () => simulation.reset(),
    onPreset: applyPreset,
    onModeChange: () => setMode(mode === 'LAB' ? 'PERFORMANCE' : 'LAB'),
    onPauseChange: () => paused = !paused
  });

  const hud = document.createElement('div');
  hud.className = 'hud';
  document.body.append(hud);
  setMode('LAB');

  addEventListener('keydown', (event) => {
    if (event.repeat) return;
    if (event.code === 'KeyP') { setMode(mode === 'LAB' ? 'PERFORMANCE' : 'LAB'); return; }
    if (event.code === 'KeyR') {
      simulation.reset();
      if (mode === 'PERFORMANCE') startPerformanceScene(1);
      return;
    }

    const digit = Number(event.code.replace('Digit', ''));
    if (digit >= 1 && digit <= 5) {
      if (mode === 'PERFORMANCE') {
        startPerformanceScene(digit);
      } else {
        const ids = ['inertia', 'wind', 'attract', 'repel', 'vortex'];
        applyPreset(ids[digit - 1]);
      }
    }
  });

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  simulation.reset();

  let lastTime = performance.now();
  
  renderer.setAnimationLoop((time) => {
    const deltaSeconds = Math.min((time - lastTime) / 1000, 0.05);
    lastTime = time;

    updatePerformanceTransition(deltaSeconds);

    if (!paused) simulation.stepSimulation();
    orbit.update();
    renderer.render(scene, camera);
  });
}

main().catch((error) => {
  console.error(error);
  const pre = document.createElement('pre');
  pre.style.cssText = 'position:fixed;inset:16px;white-space:pre-wrap;color:#fff;z-index:50';
  pre.textContent = String(error?.stack || error);
  document.body.append(pre);
});