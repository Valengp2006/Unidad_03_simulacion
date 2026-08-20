import * as THREE from 'three/webgpu';
import {
  Fn,
  If,
  color,
  distance, // <-- Nueva función importada
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
  vec4
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
    
    // 1. Color dictado por la velocidad (Azul a Dorado)
    const speedFactor = smoothstep(1.5, 6.0, speed);
    const slowColor = color('#3ea8ff'); 
    const fastColor = color('#fff4d6'); 
    const baseColor = mix(slowColor, fastColor, speedFactor);
    
    // 2. Color dictado por el campo de atracción del mouse (Magenta/Fucsia Cósmico)
    const distToMouse = distance(pos, params.attractor);
    // Las partículas dentro de un radio de 3.0 se tiñen gradualmente
    const mouseFactor = smoothstep(3.0, 0.0, distToMouse); 
    const auraColor = color('#ff1493'); // Puedes cambiar el '#ff1493' por cualquier otro color HEX
    
    return vec4(mix(baseColor, auraColor, mouseFactor), 1.0);
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
