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
  scene.background = new THREE.Color('#010206');

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
  attractorHelper.visible = false; 
  
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

  const hud = document.createElement('div');
  hud.className = 'hud';
  document.body.append(hud);

  // LOS 7 ESTADOS DE LA OBRA
  const sceneTargets = {
    1: { radialStrength: 0.0, vortexStrength: 0.1, dragCoefficient: 0.20, maxSpeed: 0.8 },
    2: { radialStrength: 0.8, vortexStrength: 0.8, dragCoefficient: 0.10, maxSpeed: 2.0 },
    3: { radialStrength: 1.5, vortexStrength: 2.5, dragCoefficient: 0.05, maxSpeed: 4.0 },
    4: { radialStrength: 3.0, vortexStrength: 6.0, dragCoefficient: 0.02, maxSpeed: 7.0 },
    5: { radialStrength: 6.0, vortexStrength: 10.0, dragCoefficient: 0.08, maxSpeed: 10.0 },
    6: { radialStrength: 15.0, vortexStrength: 0.0, dragCoefficient: 0.01, maxSpeed: 15.0 },
    7: { radialStrength: -5.0, vortexStrength: 0.5, dragCoefficient: 0.05, maxSpeed: 15.0 }
  };

  const SCENE_LERP_SPEED = 0.02;
  let currentScene = 1;
  let sceneTarget = sceneTargets[1];
  let supernovaTimer = null;

  // Lógica para aplicar estado en Modo LAB (Inmediato)
  const applyPreset = (id) => {
    if (id >= 1 && id <= 7) {
      const target = sceneTargets[id];
      params.radialEnabled.value = 1;
      params.vortexEnabled.value = 1;
      params.dragEnabled.value = 1;
      params.windEnabled.value = 0;

      if (id === 7) {
        params.radialStrength.value = -40.0;
        params.vortexStrength.value = 0.0;
        params.dragCoefficient.value = 0.0;
        params.maxSpeed.value = 20.0;
      } else {
        params.radialStrength.value = target.radialStrength;
        params.vortexStrength.value = target.vortexStrength;
        params.dragCoefficient.value = target.dragCoefficient;
        params.maxSpeed.value = target.maxSpeed;
      }
      
      // Actualiza los sliders del panel para inspeccionar
      panel?.refresh();
    }
  };

  // Lógica para aplicar estado en Modo PERFORMANCE (Transición visual)
  const goToScene = (id) => {
    currentScene = id;
    sceneTarget = sceneTargets[id];
    
    if (supernovaTimer) { clearTimeout(supernovaTimer); supernovaTimer = null; }
    
    if (id === 7) {
      params.radialStrength.value = -40.0; 
      params.dragCoefficient.value = 0.0;  
      params.vortexStrength.value = 0.0;   
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
    
    document.body.classList.toggle('hide-cursor', !lab);
    
    // MAGIA: El texto y el HUD se apagan por completo si no estamos en LAB
    hud.style.display = lab ? 'block' : 'none';
  
    if (!lab) {
      params.attractor.value.set(0, 0, 0);
      params.radialEnabled.value = 1;
      params.vortexEnabled.value = 1;
      params.dragEnabled.value = 1;
      params.windEnabled.value = 0;
      goToScene(1);
    } else {
      if (supernovaTimer) {
        clearTimeout(supernovaTimer);
        supernovaTimer = null;
      }
      hud.innerHTML = '<strong>LAB</strong> · P: Performance · R: Reset · 1–7: Estados';
    }
  };

  panel = createLabPanel({
    params,
    onReset: () => { simulation.reset(); goToScene(1); },
    onPreset: applyPreset, // Conecta los botones del panel con applyPreset
    onModeChange: () => setMode(mode === 'LAB' ? 'PERFORMANCE' : 'LAB'),
    onPauseChange: () => paused = !paused
  });

  setMode('LAB');

  // Mapeo unificado de teclado
  addEventListener('keydown', (event) => {
    if (event.repeat) return;
    if (event.code === 'KeyP') setMode(mode === 'LAB' ? 'PERFORMANCE' : 'LAB');
    if (event.code === 'KeyR') {
      simulation.reset();
      if (mode === 'PERFORMANCE') goToScene(1);
    }
  
    // Las teclas 1 a 7 funcionan en ambos modos
    const match = event.code.match(/^Digit([1-7])$/);
    if (match) {
      const id = parseInt(match[1], 10);
      if (mode === 'LAB') {
        applyPreset(id); // Instantáneo + actualiza Sliders
      } else {
        goToScene(id);   // Transición + Clímax
      }
    }

    if (mode === 'LAB' && event.code === 'Space') {
      event.preventDefault();
      savedRadialStrength = params.radialStrength.value;
      savedRadialEnabled = params.radialEnabled.value;
      params.radialEnabled.value = 1;
      params.radialStrength.value = -(savedRadialStrength || 2.0);
      panel?.refresh();
    }
  });
  
  addEventListener('keyup', (event) => {
    if (event.code === 'Space' && mode === 'LAB') {
      params.radialEnabled.value = savedRadialEnabled;
      params.radialStrength.value = savedRadialStrength;
      panel?.refresh();
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
