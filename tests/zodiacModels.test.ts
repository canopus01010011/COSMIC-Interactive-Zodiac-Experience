import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import { ZODIAC_SIGNS } from '../src/data/zodiacSigns';
import { CreatureController } from '../src/three/creatureController';
import { buildCreature, SHARED_GEOMETRIES } from '../src/three/zodiacModels';

describe('sculpted zodiac model details', () => {
  it('builds every sign with visible contrasting detail materials', () => {
    const body = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    for (const sign of ZODIAC_SIGNS) {
      const creature = buildCreature(sign.id, body);
      let detailedParts = 0;
      let meshes = 0;
      creature.group.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        meshes++;
        if (object.material !== body) detailedParts++;
        if (!SHARED_GEOMETRIES.has(object.geometry)) object.geometry.dispose();
      });
      assert.ok(meshes > 10, `${sign.name} should have a detailed 3D form`);
      assert.ok(detailedParts > 0, `${sign.name} should include contrasting details`);
    }
    body.dispose();
  });

  it('fades accent materials with the rest of the creature', () => {
    const controller = new CreatureController({ worldH: 2 });
    const built = buildCreature('leo', controller.material);
    const modelMaterials = new Set<THREE.Material>();
    built.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (material !== controller.material) modelMaterials.add(material);
      }
    });
    controller.setModel(
      {
        root: built.group,
        initialYaw: built.initialYaw,
        source: 'procedural',
        update: (tSec, dt) => built.update?.(tSec, dt),
        dispose: () => {
          built.group.traverse((object) => {
            if (object instanceof THREE.Mesh && !SHARED_GEOMETRIES.has(object.geometry)) object.geometry.dispose();
          });
        },
      },
      'leo',
    );

    controller.setOpacityImmediate(0.4);
    for (const material of modelMaterials) {
      assert.equal(material.opacity, 0.4);
      assert.equal(material.transparent, true);
      assert.equal(material.depthWrite, false);
    }

    controller.setOpacityImmediate(1);
    for (const material of modelMaterials) {
      assert.equal(material.opacity, 1);
      assert.equal(material.transparent, false);
      assert.equal(material.depthWrite, true);
    }
    controller.dispose();
  });
});
