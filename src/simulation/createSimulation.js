import * as THREE from 'three/webgpu';
import {
  Fn,
  If,
  color,
  distance,
  hash,
  instanceIndex,
  instancedArray,
  max,
  mix,
  mod,
  smoothstep,
  step,
  uint,
  uv,
  vec3,
  vec4,
  sin,  // <-- Importamos matemáticas para la paleta procedural
  cos
} from 'three/tsl';

export function createSimulation({ renderer, scene, params, count = 131072 }) {
  const positionBuffer = instancedArray(count, 'vec3');
  const velocityBuffer = instancedArray(count, 'vec3');

  const initParticles = Fn(() => {
    const i = instanceIndex;
    const p = positionBuffer.element(i);
    const v = velocityBuffer.element(i);

    const r1 = hash(i.add(uint(11)));
    const r2 = hash(i.add(uint(23)));
    const r3 = hash(i.add(uint(37)));
    const r4 = hash(i.add(uint(53)));
    const r5 = hash(i.add(uint(71)));
    const r6 = hash(i.add(uint(89)));

    const dir = vec3(r1, r2, r3).sub(0.5).normalize();
    const radius = params.boundsSize.mul(0.4).mul(r4);
    p.assign(vec3(dir.x, dir.y.mul(0.15), dir.z).mul(radius));

    v.assign(vec3(r4, r5, r6).sub(0.5).mul(params.initialSpeed));
  })().compute(count).setName('Initialize Particles');

  const updateParticles = Fn(() => {
    const p = positionBuffer.element(instanceIndex);
    const v = velocityBuffer.element(instanceIndex);

    const dt = params.dt.mul(params.timeScale);
    const force = vec3(0.0).toVar();

    force.addAssign(params.wind.mul(params.windEnabled));

    const toAttractor = params.attractor.sub(p);
    const distanceToAttractor = max(toAttractor.length(), params.softening);
    const radialDirection = toAttractor.div(distanceToAttractor);
    const radialForce = radialDirection
      .mul(params.radialStrength)
      .div(distanceToAttractor.pow(2))
      .mul(params.radialEnabled);
    force.addAssign(radialForce);

    const zAxis = vec3(0.0, 0.0, 1.0);
    const tangent = zAxis.cross(radialDirection);
    force.addAssign(tangent.mul(params.vortexStrength).mul(params.vortexEnabled));

    force.addAssign(v.mul(params.dragCoefficient).mul(params.dragEnabled).mul(-1.0));

    v.addAssign(force.mul(dt));

    const speed = v.length();
    If(speed.greaterThan(params.maxSpeed), () => {
      v.assign(v.normalize().mul(params.maxSpeed));
    });

    p.addAssign(v.mul(dt));

    const half = params.boundsSize.mul(0.5);
    p.assign(mod(p.add(half), params.boundsSize).sub(half));
  })().compute(count).setName('Update Particles');

  const material = new THREE.SpriteNodeMaterial({
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true
  });

  material.positionNode = positionBuffer.toAttribute();
  material.scaleNode = params.particleSize;

  material.colorNode = Fn(() => {
    const speed = velocityBuffer.toAttribute().length();
    const pos = positionBuffer.toAttribute();
    
    // 1. Color Físico (Azul a Dorado según la velocidad)
    const speedFactor = smoothstep(1.5, 6.0, speed);
    const slowColor = color('#3ea8ff'); 
    const fastColor = color('#fff4d6'); 
    const baseColor = mix(slowColor, fastColor, speedFactor);
    
    // 2. Color Procedural Orgánico del Mouse
    // Al usar senos y cosenos sobre la posición X e Y del mouse, generamos 
    // una paleta completa que muta suavemente. El multiplicador (0.15) controla 
    // qué tan rápido cambia el color al mover el mouse.
    const r = sin(params.attractor.x.mul(0.15)).mul(0.5).add(0.5);
    const g = cos(params.attractor.y.mul(0.15)).mul(0.5).add(0.5);
    const b = sin(params.attractor.x.add(params.attractor.y).mul(0.15)).mul(0.5).add(0.5);
    const auraColor = vec3(r, g, b);
    
    // 3. Área de Influencia Global
    const distToMouse = distance(pos, params.attractor);
    // Cambiamos el radio de 3.0 a 25.0 para que la influencia se extienda a toda la nebulosa
    const mouseFactor = smoothstep(25.0, 0.0, distToMouse); 
    
    // Mezclamos. Usamos mul(0.85) para teñir la escena intensamente con el mouse, 
    // pero sin borrar por completo los destellos dorados físicos del núcleo.
    return vec4(mix(baseColor, auraColor, mouseFactor.mul(0.85)), 1.0);
  })();

  material.opacityNode = step(uv().xy.sub(0.5).length(), 0.5);

  const geometry = new THREE.PlaneGeometry(1, 1);
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  scene.add(mesh);

  function reset() { renderer.compute(initParticles); }
  function stepSimulation() { renderer.compute(updateParticles); }
  function dispose() {
    geometry.dispose();
    material.dispose();
    scene.remove(mesh);
  }

  return { count, positionBuffer, velocityBuffer, reset, stepSimulation, dispose };
}
