import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import WebGPU from 'three/addons/capabilities/WebGPU.js';
import './styles.css';

import { createParameters } from './simulation/parameters.js';
import { createSimulation } from './simulation/createSimulation.js';
import { createLabPanel } from './ui/labPanel.js';

const PARTICLE_COUNT = 131072;

async function main() {
  const mount = document.querySelector('#app');

  if (!WebGPU.isAvailable()) {
    mount.appendChild(WebGPU.getErrorMessage());
    throw new Error('Este proyecto requiere WebGPU para ejecutar compute shaders.');
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#010206'); // Vacío del espacio ultra oscuro

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
  // Ocultamos la esfera blanca para no arruinar la ilusión del agujero negro
  attractorHelper.visible = false; 
  
  const axes = new THREE.AxesHelper(1.5);
  scene.add(axes);

  const pointerNdc = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  const interactionPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const hit = new THREE.Vector3();

  // El mouse sigue interactuando con el panel en LAB
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

  const applyPreset = (id) => {
    params.windEnabled.value = 0;
    params.radialEnabled.value = 0;
    params.vortexEnabled.value = 0;
    params.dragEnabled.value = 0;
    params.wind.value.set(0, 0, 0);
    params.initialSpeed.value = 0;

    if (id === 'inertia') { params.initialSpeed.value = 0.8; }
    else if (id === 'wind') { params.windEnabled.value = 1; params.wind.value.set(1.5, 0, 0); }
    else if (id === 'attract') { params.radialEnabled.value = 1; params.radialStrength.value = 4.0; params.dragEnabled.value = 1; params.dragCoefficient.value = 0.1;}
    else if (id === 'repel') { params.radialEnabled.value = 1; params.radialStrength.value = -3.0; }
    else if (id === 'vortex') {
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

  // FÍSICA RADICAL: Cada etapa es drásticamente diferente
  const sceneTargets = {
    // 1. Nebulosa oscura: Fricción alta, velocidad lenta, giro mínimo.
    1: { radialStrength: 0.0, vortexStrength: 0.1, dragCoefficient: 0.20, maxSpeed: 0.8 },
    // 2. Corrientes gravitacionales: Comienza una atracción sutil.
    2: { radialStrength: 0.8, vortexStrength: 0.8, dragCoefficient: 0.10, maxSpeed: 2.0 },
    // 3. Espiral de materia: Brazos galácticos definidos.
    3: { radialStrength: 1.5, vortexStrength: 2.5, dragCoefficient: 0.05, maxSpeed: 4.0 },
    // 4. Disco de acreción: Altísima rotación, mínima fricción (anillo brillante).
    4: { radialStrength: 3.0, vortexStrength: 6.0, dragCoefficient: 0.02, maxSpeed: 7.0 },
    // 5. Órbita crítica: Caída inminente, máxima tensión orbital.
    5: { radialStrength: 6.0, vortexStrength: 10.0, dragCoefficient: 0.08, maxSpeed: 10.0 },
    // 6. Colapso masivo (Singularidad): Cero rotación, succión violenta directa al centro.
    6: { radialStrength: 15.0, vortexStrength: 0.0, dragCoefficient: 0.01, maxSpeed: 15.0 },
    // 7. Supernova (Decaimiento pos-explosión).
    7: { radialStrength: -5.0, vortexStrength: 0.5, dragCoefficient: 0.05, maxSpeed: 15.0 }
  };

  const SCENE_NAMES = {
    1: 'Materia oscura', 2: 'Corrientes', 3: 'Espiral', 
    4: 'Disco de Acreción', 5: 'Órbita Crítica', 6: 'Colapso (Singularidad)', 7: 'Supernova'
  };

  // Interpolación muy lenta (0.02) para que las transiciones sean colosales y progresivas
  const SCENE_LERP_SPEED = 0.02;
  let currentScene = 1;
  let sceneTarget = sceneTargets[1];
  let supernovaTimer = null;

  const goToScene = (id) => {
    currentScene = id;
    sceneTarget = sceneTargets[id];
    
    if (mode === 'PERFORMANCE') {
      hud.innerHTML = `<strong>SINGULARIDAD</strong> · <span class="scene-name">${id} · ${SCENE_NAMES[id]}</span> · 1–7: transiciones`;
    }

    if (supernovaTimer) { clearTimeout(supernovaTimer); supernovaTimer = null; }
    
    if (id === 7) {
      // 💥 SUPERNOVA FIX: Explosión instantánea
      params.radialStrength.value = -40.0; // Rechazo masivo brutal
      params.dragCoefficient.value = 0.0;  // Sin fricción espacial
      params.vortexStrength.value = 0.0;   // Sin rotación
      params.maxSpeed.value = 20.0;
      
      supernovaTimer = setTimeout(() => goToScene(1), 1800); 
    }
  };

  const lerp = (a, b, t) => a + (b - a) * t;

  const setMode = (next) => {
    mode = next;
    const lab = mode === 'LAB';
    panel.setVisible(lab);
    axes.visible = lab;
    // Ocultamos ejes visuales en modo performance
    document.body.classList.toggle('hide-cursor', !lab);
  
    if (!lab) {
      params.attractor.value.set(0, 0, 0);
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
});
