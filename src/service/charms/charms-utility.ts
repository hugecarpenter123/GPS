import { addDelay, waitUntil } from "../../utility/plain-utility";
import { waitForElement } from "../../utility/ui-utility";

const baseIconClasses = 'power_icon30x30 new_ui_power_icon animated_power_icon animated_power_icon_30x30'

export type CityCharm = {
  dataPowerId: string;
  classes: string;
}

type OptionalCharmsArg = {
  required?: CityCharm[];
  optional?: CityCharm[];
}

export default class CharmsUtility {
  public static cityCharms: CityCharm[] = [
    { dataPowerId: 'divine_sign', classes: baseIconClasses + ' ' + 'divine_sign' },
    { dataPowerId: 'kingly_gift', classes: baseIconClasses + ' ' + 'kingly_gift' },
    { dataPowerId: 'call_of_the_ocean', classes: baseIconClasses + ' ' + 'call_of_the_ocean' },
    { dataPowerId: 'wedding', classes: baseIconClasses + ' ' + 'wedding' },
    { dataPowerId: 'happiness', classes: baseIconClasses + ' ' + 'happiness' },
    { dataPowerId: 'fertility_improvement', classes: baseIconClasses + ' ' + 'fertility_improvement' },
    { dataPowerId: 'patroness', classes: baseIconClasses + ' ' + 'patroness' },
    { dataPowerId: 'town_protection', classes: baseIconClasses + ' ' + 'town_protection' },
    { dataPowerId: 'underworld_treasures', classes: baseIconClasses + ' ' + 'underworld_treasures' },
    { dataPowerId: 'natures_gift', classes: baseIconClasses + ' ' + 'natures_gift' },
    { dataPowerId: 'cleanse', classes: baseIconClasses + ' ' + 'cleanse' },
    { dataPowerId: 'charitable_festival', classes: baseIconClasses + ' ' + 'charitable_festival' },
    { dataPowerId: 'hymn_to_aphrodite', classes: baseIconClasses + ' ' + 'hymn_to_aphrodite' },
    { dataPowerId: 'ares_sacrifice', classes: baseIconClasses + ' ' + 'ares_sacrifice' },
    { dataPowerId: 'spartan_training', classes: baseIconClasses + ' ' + 'spartan_training' },
  ]

  public static getCurrentCityWorkingCharms(): CityCharm[] {
    const castedPowersArea = document.querySelector('.casted_powers_area')
    const workingCharms = Array.from(castedPowersArea?.querySelectorAll('.casted_power.power_icon16x16') ?? [])
      .map(el => {
        const charm = el.classList[2];
        return this.cityCharms.find(c => c.dataPowerId === charm) as CityCharm
      })
      .filter(c => c !== undefined);
    return workingCharms;
  }

  private static async performCastCharms(charms: CityCharm[]): Promise<void> {
    for (const charm of charms) {
      const powerElement = document.querySelector<HTMLDivElement>(`[data-power_id="${charm.dataPowerId}"]`);
      if (powerElement) {
        powerElement.click();
        await waitUntil(() => !document.querySelector<HTMLDivElement>(`[data-power_id="${charm.dataPowerId}"]`)?.classList.contains('active_animation'),
          { delay: 333, maxIterations: 4, onError: () => console.warn('CharmUtility: charm not activated after clicking!:', charm) });
      } else {
        console.warn('CharmUtility: charm not found:', charm);
      }
    }
  }

  public static getRecruitmentSpecificCharms(): CityCharm[] {
    return [
      { dataPowerId: 'call_of_the_ocean', classes: baseIconClasses + ' ' + 'call_of_the_ocean' },
      { dataPowerId: 'fertility_improvement', classes: baseIconClasses + ' ' + 'fertility_improvement' },
      { dataPowerId: 'spartan_training', classes: baseIconClasses + ' ' + 'spartan_training' },
    ]
  }

  /**
   * Casts the charms if not casted. Returns true if all charms can be casted (and casts them) or are already casted.
   * Else returns false and does not cast the charms. If required is false then casts all charms no matter if can be casted or not.
   * @param charms 
   * @param required 
   * @returns true if all charms can be casted or are already casted
   */
  private static async castCharmsIfNotCasted(charms: CityCharm[], required: boolean = true): Promise<boolean> {
    console.warn('castCharmsIfNotCasted', { charms, required });
    const castedCharms = this.getCurrentCityWorkingCharms();
    console.log('castedCharms in the city:', castedCharms);
    const castedCharmsIds = castedCharms.map(c => c.dataPowerId);
    const charmsToCast = charms.filter((c) => !castedCharmsIds.includes(c.dataPowerId));
    console.log('remaining charms to cast:', charmsToCast);

    if (required) {
      const canCastAll = charmsToCast.every(c => this.canCastCharm(c));
      console.log('can cast all:', canCastAll);
      if (canCastAll) {
        await this.performCastCharms(charmsToCast);
        return true;
      }
      return false;
    } else {
      const charmsPossibleToCast = charmsToCast.filter(c => this.canCastCharm(c));
      console.log('cast charms possible to cast:', charmsPossibleToCast);
      await this.performCastCharms(charmsPossibleToCast);
      return true;
    }
  }

  /**
   * Casts the required charms if not casted and then casts the optional charms if not casted but only if all required ones were casted (or already set)
   * @param cityCharms 
   * @returns true if all required charms were casted (or already set)
   */
  public static async castCharms(cityCharms: OptionalCharmsArg): Promise<boolean> {
    let requiredCasted = false;
    if (cityCharms.required && cityCharms.required.length) {
      requiredCasted = await this.castCharmsIfNotCasted(cityCharms.required, true);
    } else {
      requiredCasted = true;
    }
    if (requiredCasted && cityCharms.optional && cityCharms.optional.length) {
      await this.castCharmsIfNotCasted(cityCharms.optional, false);
    }
    return requiredCasted;
  }

  /**
   * Checks if the charm can be casted
   * @param charm 
   * @returns true if the charm can be casted
   */
  private static canCastCharm(charm: CityCharm): boolean {
    return !document.querySelector<HTMLDivElement>(`[data-power_id="${charm.dataPowerId}"]`)?.classList.contains('disabled');
  }

  public static getCharmByPowerId(powerId: string): CityCharm | undefined {
    return this.cityCharms.find(c => c.dataPowerId === powerId);
  }

  public static areCharmsCastedOrAvailable(charms: CityCharm[]) {
    const workingCharms = this.getCurrentCityWorkingCharms();
    return charms.every((charm) => workingCharms.includes(charm) || this.canCastCharm(charm))
  }
}