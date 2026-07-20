import { LandArmyUnit, SeaArmyUnit } from './army-units';

export interface PlayerSpeedBonuses {
  hasLighthouse: boolean;
  hasCartography: boolean;
  hasMeteorology: boolean;
  hasSetSail: boolean;
  sirenCountInArmy: number;
  atalantaLevel: number;
  hasIslandQuestBonus: boolean;
}

export const DEFAULT_NO_BONUSES: PlayerSpeedBonuses = {
  hasLighthouse: false,
  hasCartography: false,
  hasMeteorology: false,
  hasSetSail: false,
  sirenCountInArmy: 0,
  atalantaLevel: 0,
  hasIslandQuestBonus: false,
};

export interface SpeedBonusConfig {
  lighthouse: boolean;
  cartography: boolean;
  meteorology: boolean;
  setSail: boolean;
  sirenCount: number;
  atalantaLevel: number;
  islandQuestBonus: boolean;
}

export interface SpeedMultiplierResult {
  multiplier: number;
  bonuses: Partial<SpeedBonusConfig>;
}

const ATALANTA_BONUS_BY_LEVEL: Record<number, number> = {
  0: 0,
  1: 0.132,
  2: 0.144,
  3: 0.156,
  4: 0.168,
  5: 0.18,
  6: 0.192,
  7: 0.204,
  8: 0.216,
  9: 0.228,
  10: 0.24,
  11: 0.252,
  12: 0.264,
  13: 0.276,
  14: 0.288,
  15: 0.3,
  16: 0.312,
  17: 0.324,
  18: 0.336,
  19: 0.348,
  20: 0.36,
};

const SPEED_BONUSES = {
  LIGHTHOUSE: 0.15,
  CARTOGRAPHY: 0.1,
  METEOROLOGY: 0.1,
  SET_SAIL: 0.1,
  SIREN_PER_UNIT: 0.02,
  SIREN_MAX: 1.0,
  ISLAND_QUEST: 0.3,
} as const;

type UnitType = 'land' | 'sea' | 'flying' | 'colonize_ship';

function getUnitType(unit: LandArmyUnit | SeaArmyUnit): UnitType {
  if ('canFly' in unit && unit.canFly) return 'flying';
  if ('navalAttack' in unit) {
    return unit.name === 'colonize_ship' ? 'colonize_ship' : 'sea';
  }
  return 'land';
}

function generateAtalantaOptions(): number[] {
  return [0, 1, 5, 10, 15, 20];
}

function generateSirenOptions(): number[] {
  return [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50];
}

export function generateSpeedMultipliers(unit: LandArmyUnit | SeaArmyUnit): SpeedMultiplierResult[] {
  const unitType = getUnitType(unit);
  const results: SpeedMultiplierResult[] = [];

  const atalantaOptions = generateAtalantaOptions();
  const islandQuestOptions = [false, true];

  switch (unitType) {
    case 'land': {
      const meteorologyOptions = [false, true];
      for (const meteorology of meteorologyOptions) {
        for (const atalantaLevel of atalantaOptions) {
          for (const islandQuest of islandQuestOptions) {
            const multiplier = calculateMultiplier({
              meteorology,
              atalantaLevel,
              islandQuestBonus: islandQuest,
            });
            results.push({
              multiplier,
              bonuses: { meteorology, atalantaLevel, islandQuestBonus: islandQuest },
            });
          }
        }
      }
      break;
    }

    case 'flying': {
      for (const atalantaLevel of atalantaOptions) {
        for (const islandQuest of islandQuestOptions) {
          const multiplier = calculateMultiplier({
            atalantaLevel,
            islandQuestBonus: islandQuest,
          });
          results.push({
            multiplier,
            bonuses: { atalantaLevel, islandQuestBonus: islandQuest },
          });
        }
      }
      break;
    }

    case 'sea': {
      const lighthouseOptions = [false, true];
      const cartographyOptions = [false, true];
      const sirenOptions = generateSirenOptions();

      for (const lighthouse of lighthouseOptions) {
        for (const cartography of cartographyOptions) {
          for (const sirenCount of sirenOptions) {
            for (const atalantaLevel of atalantaOptions) {
              for (const islandQuest of islandQuestOptions) {
                const multiplier = calculateMultiplier({
                  lighthouse,
                  cartography,
                  sirenCount,
                  atalantaLevel,
                  islandQuestBonus: islandQuest,
                });
                results.push({
                  multiplier,
                  bonuses: { lighthouse, cartography, sirenCount, atalantaLevel, islandQuestBonus: islandQuest },
                });
              }
            }
          }
        }
      }
      break;
    }

    case 'colonize_ship': {
      const lighthouseOptions = [false, true];
      const cartographyOptions = [false, true];
      const setSailOptions = [false, true];
      const sirenOptions = generateSirenOptions();

      for (const lighthouse of lighthouseOptions) {
        for (const cartography of cartographyOptions) {
          for (const setSail of setSailOptions) {
            for (const sirenCount of sirenOptions) {
              for (const atalantaLevel of atalantaOptions) {
                for (const islandQuest of islandQuestOptions) {
                  const multiplier = calculateMultiplier({
                    lighthouse,
                    cartography,
                    setSail,
                    sirenCount,
                    atalantaLevel,
                    islandQuestBonus: islandQuest,
                  });
                  results.push({
                    multiplier,
                    bonuses: {
                      lighthouse,
                      cartography,
                      setSail,
                      sirenCount,
                      atalantaLevel,
                      islandQuestBonus: islandQuest,
                    },
                  });
                }
              }
            }
          }
        }
      }
      break;
    }
  }

  return deduplicateByMultiplier(results);
}

function calculateMultiplier(config: Partial<SpeedBonusConfig>): number {
  let bonus = 0;

  if (config.lighthouse) bonus += SPEED_BONUSES.LIGHTHOUSE;
  if (config.cartography) bonus += SPEED_BONUSES.CARTOGRAPHY;
  if (config.meteorology) bonus += SPEED_BONUSES.METEOROLOGY;
  if (config.setSail) bonus += SPEED_BONUSES.SET_SAIL;

  if (config.sirenCount && config.sirenCount > 0) {
    const sirenBonus = Math.min(config.sirenCount * SPEED_BONUSES.SIREN_PER_UNIT, SPEED_BONUSES.SIREN_MAX);
    bonus += sirenBonus;
  }

  if (config.atalantaLevel && config.atalantaLevel > 0) {
    bonus += ATALANTA_BONUS_BY_LEVEL[config.atalantaLevel] ?? 0;
  }

  if (config.islandQuestBonus) bonus += SPEED_BONUSES.ISLAND_QUEST;

  return 1 + bonus;
}

function deduplicateByMultiplier(results: SpeedMultiplierResult[]): SpeedMultiplierResult[] {
  const seen = new Map<number, SpeedMultiplierResult>();
  for (const result of results) {
    const roundedMultiplier = Math.round(result.multiplier * 1000) / 1000;
    if (!seen.has(roundedMultiplier)) {
      seen.set(roundedMultiplier, result);
    }
  }
  return Array.from(seen.values());
}

export function calculatePossibleTravelTimes(
  unit: LandArmyUnit | SeaArmyUnit,
  baseDistanceTime: number,
): { timeMs: number; multiplier: number; bonuses: Partial<SpeedBonusConfig> }[] {
  const multipliers = generateSpeedMultipliers(unit);

  return multipliers.map(({ multiplier, bonuses }) => ({
    timeMs: Math.round(baseDistanceTime / multiplier),
    multiplier,
    bonuses,
  }));
}

export function doesUnitMatchTravelTime(
  unit: LandArmyUnit | SeaArmyUnit,
  observedTravelTimeMs: number,
  baseDistanceTime: number,
  toleranceMs: number = 10000,
): { matches: boolean; possibleBonuses: Partial<SpeedBonusConfig>[] } {
  const possibleTimes = calculatePossibleTravelTimes(unit, baseDistanceTime);
  const matchingBonuses: Partial<SpeedBonusConfig>[] = [];

  for (const { timeMs, bonuses } of possibleTimes) {
    if (Math.abs(timeMs - observedTravelTimeMs) <= toleranceMs) {
      matchingBonuses.push(bonuses);
    }
  }

  return {
    matches: matchingBonuses.length > 0,
    possibleBonuses: matchingBonuses,
  };
}

export function findMatchingUnits(
  units: (LandArmyUnit | SeaArmyUnit)[],
  observedTravelTimeMs: number,
  cleanBaseDistanceTime: number,
  toleranceMs: number = 10000,
): { unit: LandArmyUnit | SeaArmyUnit; possibleBonuses: Partial<SpeedBonusConfig>[] }[] {
  const matches: { unit: LandArmyUnit | SeaArmyUnit; possibleBonuses: Partial<SpeedBonusConfig>[] }[] = [];

  for (const unit of units) {
    const unitBaseTime = cleanBaseDistanceTime / unit.speed;
    const result = doesUnitMatchTravelTime(unit, observedTravelTimeMs, unitBaseTime, toleranceMs);
    if (result.matches) {
      matches.push({ unit, possibleBonuses: result.possibleBonuses });
    }
  }

  return matches;
}

/**
 * Calculates the speed multiplier for given player bonuses.
 * Used to "undo" player's bonuses from UI measurement to get clean base time.
 */
export function calculatePlayerBonusMultiplier(
  bonuses: PlayerSpeedBonuses,
  unitType: 'land' | 'sea' | 'flying',
): number {
  let bonus = 0;

  if (unitType === 'sea') {
    if (bonuses.hasLighthouse) bonus += SPEED_BONUSES.LIGHTHOUSE;
    if (bonuses.hasCartography) bonus += SPEED_BONUSES.CARTOGRAPHY;
    if (bonuses.sirenCountInArmy > 0) {
      bonus += Math.min(bonuses.sirenCountInArmy * SPEED_BONUSES.SIREN_PER_UNIT, SPEED_BONUSES.SIREN_MAX);
    }
  }

  if (unitType === 'land') {
    if (bonuses.hasMeteorology) bonus += SPEED_BONUSES.METEOROLOGY;
  }

  if (bonuses.atalantaLevel > 0) {
    bonus += ATALANTA_BONUS_BY_LEVEL[bonuses.atalantaLevel] ?? 0;
  }

  if (bonuses.hasIslandQuestBonus) bonus += SPEED_BONUSES.ISLAND_QUEST;

  return 1 + bonus;
}

/**
 * Calculates clean base distance time by removing player's bonuses from UI measurement.
 * @param refTimeWithBonuses - Travel time from UI (includes player's bonuses)
 * @param refUnitSpeed - Speed of the reference unit used
 * @param playerBonuses - Player's active bonuses
 * @param refUnitType - Type of reference unit ('land' | 'sea' | 'flying')
 */
export function calculateCleanBaseDistanceTime(
  refTimeWithBonuses: number,
  refUnitSpeed: number,
  playerBonuses: PlayerSpeedBonuses,
  refUnitType: 'land' | 'sea' | 'flying',
): number {
  const playerMultiplier = calculatePlayerBonusMultiplier(playerBonuses, refUnitType);
  return refTimeWithBonuses * refUnitSpeed * playerMultiplier;
}

/**
 * TODO: Implement actual detection of player's bonuses from game UI/state.
 * For now returns no bonuses (stub).
 */
export async function detectCurrentPlayerBonuses(): Promise<PlayerSpeedBonuses> {
  console.warn('[SpeedCalculator]: detectCurrentPlayerBonuses is not implemented, returning no bonuses');
  return DEFAULT_NO_BONUSES;
}
