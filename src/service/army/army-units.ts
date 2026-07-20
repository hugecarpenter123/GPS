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
  | 'calydonian_boar'
  | 'satyr'
  | 'ladon'
  | 'spartoi'
  | 'godsent';

export interface LandArmyUnit {
  name: LandArmyUnitName;
  attackType: AttackType;
  attack: number;
  defence: Record<AttackType, number>;
  speed: number;
  booty: number;
  canFly: boolean;
}

export type SeaArmyUnitName =
  | 'big_transporter'
  | 'bireme'
  | 'attack_ship'
  | 'demolition_ship'
  | 'small_transporter'
  | 'trireme'
  | 'colonize_ship';

export interface SeaArmyUnit {
  name: SeaArmyUnitName;
  attack: number;
  navalAttack: number;
  capacity: number;
  speed: number;
}

export const landArmyUnits = {
  militia: {
    name: 'militia',
    attackType: 'blunt',
    attack: 0,
    defence: { blunt: 6, sharp: 8, distance: 4 },
    speed: 0,
    booty: 0,
    canFly: false,
  },
  sword: {
    name: 'sword',
    attackType: 'blunt',
    attack: 5,
    defence: { blunt: 14, sharp: 8, distance: 30 },
    speed: 8,
    booty: 16,
    canFly: false,
  },
  slinger: {
    name: 'slinger',
    attackType: 'distance',
    attack: 23,
    defence: { blunt: 7, sharp: 8, distance: 2 },
    speed: 14,
    booty: 8,
    canFly: false,
  },
  archer: {
    name: 'archer',
    attackType: 'distance',
    attack: 8,
    defence: { blunt: 7, sharp: 25, distance: 13 },
    speed: 12,
    booty: 24,
    canFly: false,
  },
  hoplite: {
    name: 'hoplite',
    attackType: 'sharp',
    attack: 16,
    defence: { blunt: 18, sharp: 12, distance: 7 },
    speed: 6,
    booty: 8,
    canFly: false,
  },
  rider: {
    name: 'rider',
    attackType: 'blunt',
    attack: 60,
    defence: { blunt: 18, sharp: 1, distance: 24 },
    speed: 22,
    booty: 72,
    canFly: false,
  },
  chariot: {
    name: 'chariot',
    attackType: 'sharp',
    attack: 56,
    defence: { blunt: 76, sharp: 16, distance: 56 },
    speed: 18,
    booty: 64,
    canFly: false,
  },
  catapult: {
    name: 'catapult',
    attackType: 'distance',
    attack: 100,
    defence: { blunt: 30, sharp: 30, distance: 30 },
    speed: 2,
    booty: 400,
    canFly: false,
  },
  minotaur: {
    name: 'minotaur',
    attackType: 'blunt',
    attack: 650,
    defence: { blunt: 750, sharp: 330, distance: 640 },
    speed: 10,
    booty: 480,
    canFly: false,
  },
  manticore: {
    name: 'manticore',
    attackType: 'sharp',
    attack: 1010,
    defence: { blunt: 170, sharp: 225, distance: 505 },
    speed: 22,
    booty: 360,
    canFly: true,
  },
  cyclop: {
    name: 'cyclop',
    attackType: 'distance',
    attack: 1035,
    defence: { blunt: 1050, sharp: 10, distance: 1450 },
    speed: 8,
    booty: 320,
    canFly: false,
  },
  harpy: {
    name: 'harpy',
    attackType: 'blunt',
    attack: 295,
    defence: { blunt: 105, sharp: 70, distance: 1 },
    speed: 28,
    booty: 340,
    canFly: true,
  },
  medusa: {
    name: 'medusa',
    attackType: 'sharp',
    attack: 425,
    defence: { blunt: 480, sharp: 345, distance: 290 },
    speed: 6,
    booty: 400,
    canFly: false,
  },
  centaur: {
    name: 'centaur',
    attackType: 'distance',
    attack: 134,
    defence: { blunt: 195, sharp: 585, distance: 80 },
    speed: 18,
    booty: 200,
    canFly: true,
  },
  pegasus: {
    name: 'pegasus',
    attackType: 'sharp',
    attack: 100,
    defence: { blunt: 750, sharp: 275, distance: 275 },
    speed: 35,
    booty: 160,
    canFly: true,
  },
  cerberus: {
    name: 'cerberus',
    attackType: 'blunt',
    attack: 210,
    defence: { blunt: 825, sharp: 300, distance: 1575 },
    speed: 4,
    booty: 240,
    canFly: false,
  },
  erinys: {
    name: 'erinys',
    attackType: 'distance',
    attack: 1700,
    defence: { blunt: 460, sharp: 460, distance: 595 },
    speed: 10,
    booty: 440,
    canFly: false,
  },
  griffin: {
    name: 'griffin',
    attackType: 'blunt',
    attack: 900,
    defence: { blunt: 320, sharp: 330, distance: 100 },
    speed: 18,
    booty: 350,
    canFly: true,
  },
  calydonian_boar: {
    name: 'calydonian_boar',
    attackType: 'sharp',
    attack: 180,
    defence: { blunt: 700, sharp: 700, distance: 100 },
    speed: 16,
    booty: 240,
    canFly: false,
  },
  satyr: {
    name: 'satyr',
    attackType: 'sharp',
    attack: 385,
    defence: { blunt: 55, sharp: 105, distance: 170 },
    speed: 136,
    booty: 335,
    canFly: false,
  },
  ladon: {
    name: 'ladon',
    attackType: 'distance',
    attack: 2350,
    defence: { blunt: 2390, sharp: 1950, distance: 2100 },
    speed: 100,
    booty: 2200,
    canFly: true,
  },
  spartoi: {
    name: 'spartoi',
    attackType: 'blunt',
    attack: 205,
    defence: { blunt: 100, sharp: 100, distance: 150 },
    speed: 16,
    booty: 275,
    canFly: false,
  },
  godsent: {
    name: 'godsent',
    attackType: 'blunt',
    attack: 45,
    defence: { blunt: 40, sharp: 40, distance: 40 },
    speed: 16,
    booty: 5,
    canFly: false,
  },
} as const satisfies Record<LandArmyUnitName, LandArmyUnit>;

export const seaArmyUnits = {
  big_transporter: {
    name: 'big_transporter',
    attack: 0,
    navalAttack: 0,
    capacity: 26,
    speed: 8,
  },
  bireme: {
    name: 'bireme',
    attack: 24,
    navalAttack: 160,
    capacity: 0,
    speed: 15,
  },
  attack_ship: {
    name: 'attack_ship',
    attack: 200,
    navalAttack: 60,
    capacity: 0,
    speed: 13,
  },
  demolition_ship: {
    name: 'demolition_ship',
    attack: 20,
    navalAttack: 1,
    capacity: 0,
    speed: 5,
  },
  small_transporter: {
    name: 'small_transporter',
    attack: 0,
    navalAttack: 0,
    capacity: 10,
    speed: 15,
  },
  trireme: {
    name: 'trireme',
    attack: 250,
    navalAttack: 250,
    capacity: 0,
    speed: 15,
  },
  colonize_ship: {
    name: 'colonize_ship',
    attack: 0,
    navalAttack: 0,
    capacity: 0,
    speed: 3,
  },
} as const satisfies Record<SeaArmyUnitName, SeaArmyUnit>;

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
