type AttackType = 'blunt' | 'sharp' | 'distance';
export type LandArmyUnitName =
  | 'militia'
  | 'sword'
  | 'slinger'
  | 'archer'
  | 'hoplite'
  | 'rider'
  | 'chariot'
  | 'catapult'
  | 'minotaur'
  | 'manticore'
  | 'cyclop'
  | 'harpy'
  | 'medusa'
  | 'centaur'
  | 'pegasus'
  | 'cerberus'
  | 'erinys'
  | 'griffin'
  | 'calydonian boar'
  | 'satyr'
  | 'ladon'
  | 'spartoi'
  | 'godsent';

interface ArmyUnit {
  name: LandArmyUnitName;
  attackType: AttackType;
  attack: number;
  defence: Record<AttackType, number>;
  speed: number;
}

export interface LandArmyUnit extends ArmyUnit {
  booty: number;
}

interface ShipArmyUnit extends ArmyUnit {
  capacity: number;
}

export const landArmyUnits = {
  militia: {
    name: 'militia',
    attackType: 'blunt',
    attack: 0,
    defence: { blunt: 6, sharp: 8, distance: 4 },
    speed: 0,
    booty: 0,
  },
  sword: {
    name: 'sword',
    attackType: 'blunt',
    attack: 5,
    defence: { blunt: 14, sharp: 8, distance: 30 },
    speed: 8,
    booty: 16,
  },
  slinger: {
    name: 'slinger',
    attackType: 'distance',
    attack: 23,
    defence: { blunt: 7, sharp: 8, distance: 2 },
    speed: 14,
    booty: 8,
  },
  archer: {
    name: 'archer',
    attackType: 'distance',
    attack: 8,
    defence: { blunt: 7, sharp: 25, distance: 13 },
    speed: 12,
    booty: 24,
  },
  hoplite: {
    name: 'hoplite',
    attackType: 'sharp',
    attack: 16,
    defence: { blunt: 18, sharp: 12, distance: 7 },
    speed: 6,
    booty: 8,
  },
  rider: {
    name: 'rider',
    attackType: 'blunt',
    attack: 60,
    defence: { blunt: 18, sharp: 1, distance: 24 },
    speed: 22,
    booty: 72,
  },
  chariot: {
    name: 'chariot',
    attackType: 'sharp',
    attack: 56,
    defence: { blunt: 76, sharp: 16, distance: 56 },
    speed: 18,
    booty: 64,
  },
  catapult: {
    name: 'catapult',
    attackType: 'distance',
    attack: 100,
    defence: { blunt: 30, sharp: 30, distance: 30 },
    speed: 2,
    booty: 400,
  },
  minotaur: {
    name: 'minotaur',
    attackType: 'blunt',
    attack: 650,
    defence: { blunt: 750, sharp: 330, distance: 640 },
    speed: 10,
    booty: 480,
  },
  manticore: {
    name: 'manticore',
    attackType: 'sharp',
    attack: 1010,
    defence: { blunt: 170, sharp: 225, distance: 505 },
    speed: 22,
    booty: 360,
  },
  cyclop: {
    name: 'cyclop',
    attackType: 'distance',
    attack: 1035,
    defence: { blunt: 1050, sharp: 10, distance: 1450 },
    speed: 8,
    booty: 320,
  },
  harpy: {
    name: 'harpy',
    attackType: 'blunt',
    attack: 295,
    defence: { blunt: 105, sharp: 70, distance: 1 },
    speed: 28,
    booty: 340,
  },
  medusa: {
    name: 'medusa',
    attackType: 'sharp',
    attack: 425,
    defence: { blunt: 480, sharp: 345, distance: 290 },
    speed: 6,
    booty: 400,
  },
  centaur: {
    name: 'centaur',
    attackType: 'distance',
    attack: 134,
    defence: { blunt: 195, sharp: 585, distance: 80 },
    speed: 18,
    booty: 200,
  },
  pegasus: {
    name: 'pegasus',
    attackType: 'sharp',
    attack: 100,
    defence: { blunt: 750, sharp: 275, distance: 275 },
    speed: 35,
    booty: 160,
  },
  cerberus: {
    name: 'cerberus',
    attackType: 'blunt',
    attack: 210,
    defence: { blunt: 825, sharp: 300, distance: 1575 },
    speed: 4,
    booty: 240,
  },
  erinys: {
    name: 'erinys',
    attackType: 'distance',
    attack: 1700,
    defence: { blunt: 460, sharp: 460, distance: 595 },
    speed: 10,
    booty: 440,
  },
  griffin: {
    name: 'griffin',
    attackType: 'blunt',
    attack: 900,
    defence: { blunt: 320, sharp: 330, distance: 100 },
    speed: 18,
    booty: 350,
  },
  'calydonian boar': {
    name: 'calydonian boar',
    attackType: 'sharp',
    attack: 180,
    defence: { blunt: 700, sharp: 700, distance: 100 },
    speed: 16,
    booty: 240,
  },
  satyr: {
    name: 'satyr',
    attackType: 'sharp',
    attack: 385,
    defence: { blunt: 55, sharp: 105, distance: 170 },
    speed: 136,
    booty: 335,
  },
  ladon: {
    name: 'ladon',
    attackType: 'distance',
    attack: 2350,
    defence: { blunt: 2390, sharp: 1950, distance: 2100 },
    speed: 100,
    booty: 2200,
  },
  spartoi: {
    name: 'spartoi',
    attackType: 'blunt',
    attack: 205,
    defence: { blunt: 100, sharp: 100, distance: 150 },
    speed: 16,
    booty: 275,
  },
  godsent: {
    name: 'godsent',
    attackType: 'blunt',
    attack: 45,
    defence: { blunt: 40, sharp: 40, distance: 40 },
    speed: 16,
    booty: 5,
  },
} as const satisfies Record<LandArmyUnitName, LandArmyUnit>;

export const offLandArmyUnitNames = [
  'slinger',
  'hoplite',
  'rider',
  'chariot',
  'catapult',
  'manticore',
  'harpy',
  'erinys',
  'griffin',
  'ladon',
  'spartoi',
  'godsent',
] as const satisfies LandArmyUnitName[];

export const getLandCounterUnits = (
  unit: LandArmyUnit,
  as: 'attacker' | 'defender',
  except?: LandArmyUnitName[],
): LandArmyUnitName[] => {
  return (
    as === 'attacker'
      ? Object.values(landArmyUnits).filter(
          filteredUnit => unit.attack < filteredUnit.defence[unit.attackType] && !except?.includes(filteredUnit.name),
        )
      : Object.values(landArmyUnits).filter(
          filteredUnit =>
            unit.defence[filteredUnit.attackType] < filteredUnit.attack && !except?.includes(filteredUnit.name),
        )
  ).map(u => u.name);
};
