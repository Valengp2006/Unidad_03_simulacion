import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import WebGPU from 'three/addons/capabilities/WebGPU.js';
import './styles.css';

import { createParameters } from './simulation/parameters.js';
import { createSimulation } from './simulation/createSimulation.js';
import { createLabPanel } from './ui/labPanel.js'; // Traemos de vuelta tu panel

const PARTICLE_COUNT = 131072;

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
    if (mode !== 'LAB') return;
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
  let savedRadialStrength = params.radialStrength.value;
  let savedRadialEnabled = params.radialEnabled.value;

  // LAB: Pruebas adaptadas al proyecto "Singularidad"
  const applyPreset = (id) => {
    params.windEnabled.value = 0;
    params.radialEnabled.value = 0;
    params.vortexEnabled.value = 0;
    params.dragEnabled.value = 0;
    params.wind.value.set(0, 0, 0);
    params.initialSpeed.value = 0;

    if (id === 'inertia') { params.initialSpeed.value = 0.8; } // Dispersión
    else if (id === 'wind') { params.windEnabled.value = 1; params.wind.value.set(1.5, 0, 0); } // Corriente estelar
    else if (id === 'attract') { params.radialEnabled.value = 1; params.radialStrength.value = 4.0; params.dragEnabled.value = 1; params.dragCoefficient.value = 0.1;} // Atracción masiva
    else if (id === 'repel') { params.radialEnabled.value = 1; params.radialStrength.value = -3.0; } // Rechazo
    else if (id === 'vortex') { // Sistema orbital
      params.radialEnabled.value = 1; params.radialStrength.value = 1.0;
      params.vortexEnabled.value = 1; params.vortexStrength.value = 3.0;
      params.dragEnabled.value = 1; params.dragCoefficient.value = 0.08;
    }
    simulation.reset();
    panel?.refresh();
  };

  const hud = document.createElement('div');
  hud.className = 'hud';
  document.body.append(hud);

  // PERFORMANCE SCENES: Expandido a 7 fases para mayor fluidez
  const sceneTargets = {
    1: { radialStrength: 0.0, vortexStrength: 0.0, dragCoefficient: 0.05, maxSpeed: 1.5 },   // Reposo
    2: { radialStrength: 0.5, vortexStrength: 0.1, dragCoefficient: 0.10, maxSpeed: 2.0 },   // Despertar gravitacional
    3: { radialStrength: 1.2, vortexStrength: 0.6, dragCoefficient: 0.15, maxSpeed: 2.8 },   // Formación de la espiral
    4: { radialStrength: 2.0, vortexStrength: 2.2, dragCoefficient: 0.12, maxSpeed: 4.5 },   // Disco de acreción
    5: { radialStrength: 3.5, vortexStrength: 3.0, dragCoefficient: 0.08, maxSpeed: 6.5 },   // Resonancia orbital
    6: { radialStrength: 5.5, vortexStrength: 1.2, dragCoefficient: 0.04, maxSpeed: 9.0 },   // Colapso acelerado
    7: { radialStrength: -8.0, vortexStrength: 0.5, dragCoefficient: 0.02, maxSpeed: 12.0 }  // Supernova
  };

  const SCENE_NAMES = {
    1: 'Nube en reposo', 2: 'Despertar', 3: 'Formación', 
    4: 'Disco de acreción', 5: 'Resonancia', 6: 'Colapso acelerado', 7: 'Supernova'
  };

  const SCENE_LERP_SPEED = 0.035; // Lo bajé un poco para que las transiciones sean aún más orgánicas
  let currentScene = 1;
  let sceneTarget = sceneTargets[1];
  let supernovaTimer = null;

  const goToScene = (id) => {
    currentScene = id;
    sceneTarget = sceneTargets[id];
    
    // Solo actualizamos el nombre si estamos en PERFORMANCE
    if (mode === 'PERFORMANCE') {
      hud.innerHTML = `<strong>PERFORMANCE</strong> · <span class="scene-name">${id} · ${SCENE_NAMES[id]}</span> · 1–7: escenas`;
    }

    if (supernovaTimer) { clearTimeout(supernovaTimer); supernovaTimer = null; }
    if (id === 7) supernovaTimer = setTimeout(() => goToScene(4), 1400); // Decae a la escena 4 (Disco) en vez de la 3
  };

  const lerp = (a, b, t) => a + (b - a) * t;

  const setMode = (next) => {
    mode = next;
    const lab = mode === 'LAB';
    panel.setVisible(lab);
    axes.visible = lab;
    attractorHelper.visible = lab;
    document.body.classList.toggle('hide-cursor', !lab);
  
    if (!lab) {
      params.attractor.value.set(0, 0, 0);
      attractorHelper.position.set(0, 0, 0);
      params.radialEnabled.value = 1;
      params.vortexEnabled.value = 1;
      params.dragEnabled.value = 1;
      params.windEnabled.value = 0;
      goToScene(1);
    } else if (supernovaTimer) {
      clearTimeout(supernovaTimer);
      supernovaTimer = null;
    }
  
    if (lab) {
      hud.innerHTML = '<strong>LAB</strong> · P: performance · R: reset · 1–5: fuerzas de prueba';
    }
  };

  panel = createLabPanel({
    params,
    onReset: () => simulation.reset(),
    onPreset: applyPreset,
    onModeChange: () => setMode(mode === 'LAB' ? 'PERFORMANCE' : 'LAB'),
    onPauseChange: () => paused = !paused
  });

  setMode('LAB');

  addEventListener('keydown', (event) => {
    if (event.repeat) return;
    if (event.code === 'KeyP') setMode(mode === 'LAB' ? 'PERFORMANCE' : 'LAB');
    if (event.code === 'KeyR') {
      simulation.reset();
      if (mode === 'PERFORMANCE') goToScene(1);
    }
  
    if (mode === 'LAB') {
      // LAB conserva sus 5 atajos para evaluar las fuerzas
      if (event.code === 'Digit1') applyPreset('inertia');
      if (event.code === 'Digit2') applyPreset('wind');
      if (event.code === 'Digit3') applyPreset('attract');
      if (event.code === 'Digit4') applyPreset('repel');
      if (event.code === 'Digit5') applyPreset('vortex');
  
      if (event.code === 'Space') {
        event.preventDefault();
        savedRadialStrength = params.radialStrength.value;
        savedRadialEnabled = params.radialEnabled.value;
        params.radialEnabled.value = 1;
        params.radialStrength.value = -(savedRadialStrength || 2.0);
      }
    } else {
      // PERFORMANCE ahora escucha del 1 al 7
      if (event.code === 'Digit1') goToScene(1);
      if (event.code === 'Digit2') goToScene(2);
      if (event.code === 'Digit3') goToScene(3);
      if (event.code === 'Digit4') goToScene(4);
      if (event.code === 'Digit5') goToScene(5);
      if (event.code === 'Digit6') goToScene(6);
      if (event.code === 'Digit7') goToScene(7);
    }
  });
  
  addEventListener('keyup', (event) => {
    if (event.code === 'Space' && mode === 'LAB') {
      params.radialEnabled.value = savedRadialEnabled;
      params.radialStrength.value = savedRadialStrength;
    }
  });

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  simulation.reset();

  // FRAME LOOP
  renderer.setAnimationLoop(() => {
    if (!paused) {
      if (mode === 'PERFORMANCE') {
        params.radialStrength.value = lerp(params.radialStrength.value, sceneTarget.radialStrength, SCENE_LERP_SPEED);
        params.vortexStrength.value = lerp(params.vortexStrength.value, sceneTarget.vortexStrength, SCENE_LERP_SPEED);
        params.dragCoefficient.value = lerp(params.dragCoefficient.value, sceneTarget.dragCoefficient, SCENE_LERP_SPEED);
        params.maxSpeed.value = lerp(params.maxSpeed.value, sceneTarget.maxSpeed, SCENE_LERP_SPEED);
      }
      simulation.stepSimulation();
    }
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
