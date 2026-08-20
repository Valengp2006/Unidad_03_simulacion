import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import WebGPU from 'three/addons/capabilities/WebGPU.js';
import './styles.css';

import { createParameters } from './simulation/parameters.js';
import { createSimulation } from './simulation/createSimulation.js';
// ¡Adiós createLabPanel!

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

  // CONFIGURACIÓN BASE DE SINGULARIDAD
  // Forzamos el atractor al origen y activamos todas las fuerzas necesarias
  params.attractor.value.set(0, 0, 0);
  params.radialEnabled.value = 1;
  params.vortexEnabled.value = 1;
  params.dragEnabled.value = 1;
  params.windEnabled.value = 0;

  // HUD Minimalista
  const hud = document.createElement('div');
  hud.className = 'hud';
  document.body.append(hud);

  // ESTADOS Y ESCENAS DE LA PERFORMANCE
  const sceneTargets = {
    1: { radialStrength: 0.0, vortexStrength: 0.0, dragCoefficient: 0.05, maxSpeed: 1.5 },
    2: { radialStrength: 1.2, vortexStrength: 0.3, dragCoefficient: 0.15, maxSpeed: 2.5 },
    3: { radialStrength: 2.0, vortexStrength: 2.2, dragCoefficient: 0.12, maxSpeed: 4.0 },
    4: { radialStrength: 4.5, vortexStrength: 1.2, dragCoefficient: 0.04, maxSpeed: 8.0 },
    5: { radialStrength: -6.0, vortexStrength: 0.5, dragCoefficient: 0.02, maxSpeed: 10.0 }
  };

  const SCENE_NAMES = {
    1: 'Nube en reposo', 2: 'Formación', 3: 'Disco de acreción',
    4: 'Colapso acelerado', 5: 'Supernova'
  };

  const SCENE_LERP_SPEED = 0.05;
  let currentScene = 1;
  let sceneTarget = sceneTargets[1];
  let supernovaTimer = null;

  const goToScene = (id) => {
    currentScene = id;
    sceneTarget = sceneTargets[id];
    hud.innerHTML = `<strong>SINGULARIDAD</strong> · ${id} · ${SCENE_NAMES[id]}`;

    if (supernovaTimer) { clearTimeout(supernovaTimer); supernovaTimer = null; }
    
    // Si estalla la supernova, decae sola a la escena 3 después de 1.2 segundos
    if (id === 5) supernovaTimer = setTimeout(() => goToScene(3), 1200);
  };

  const lerp = (a, b, t) => a + (b - a) * t;

  // Arrancamos la experiencia visual en la escena 1
  goToScene(1);

  // CONTROLES DE TECLADO (Puros)
  addEventListener('keydown', (event) => {
    if (event.repeat) return;
    if (event.code === 'Digit1') goToScene(1);
    if (event.code === 'Digit2') goToScene(2);
    if (event.code === 'Digit3') goToScene(3);
    if (event.code === 'Digit4') goToScene(4);
    if (event.code === 'Digit5') goToScene(5);
  });

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  simulation.reset();

  // LOOP DE ANIMACIÓN
  renderer.setAnimationLoop(() => {
    // Interpolación suave y constante hacia la escena elegida
    params.radialStrength.value = lerp(params.radialStrength.value, sceneTarget.radialStrength, SCENE_LERP_SPEED);
    params.vortexStrength.value = lerp(params.vortexStrength.value, sceneTarget.vortexStrength, SCENE_LERP_SPEED);
    params.dragCoefficient.value = lerp(params.dragCoefficient.value, sceneTarget.dragCoefficient, SCENE_LERP_SPEED);
    params.maxSpeed.value = lerp(params.maxSpeed.value, sceneTarget.maxSpeed, SCENE_LERP_SPEED);
    
    simulation.stepSimulation();
    orbit.update();
    renderer.render(scene, camera);
  });
}

main().catch((error) => {
  console.error(error);
});
