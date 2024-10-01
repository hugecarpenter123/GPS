import { waitForElement } from "../../../utility/ui-utility";

export type Building = {
  backgroundImageProp: string;
  elementSelector: string;
  currentLvlElSelector: string
  name: string;
  buildAction: () => Promise<void>;
};

const buildActionSafe = async (selector: string) => {
  const cityViewBtn = document.querySelector<HTMLDivElement>('[name="city_overview"]');
  if (!cityViewBtn?.classList.contains('checked')) {
    cityViewBtn?.click();
  }
  const buildModeButton = document.querySelector<HTMLElement>('[class="construction_queue_build_button"] div')!;
  if (!buildModeButton.classList.contains('active')) {
    buildModeButton.click();
  }
  await waitForElement(selector).then((element) => element.click());
};

export const buildingsSelectors = {
  buildButton: `.btn_build.build_button`,
  currentLvl: `[class="twa_content js-content-area"] span:nth-of-type(3)`,
  disabled: 'disabled'
}

// .city_overview_overlay.main .btn_build.build_button
export const buildings: Record<string, Building> = {
  main: {
    backgroundImageProp: 'url(https://gpen.innogamescdn.com/images/game/main/main.png)',
    elementSelector: '.city_overview_overlay.main',
    currentLvlElSelector: '.city_overview_overlay.main [class="twa_content js-content-area"] span:nth-of-type(3)',
    name: 'Senate',
    buildAction: () => buildActionSafe('.city_overview_overlay.main .btn_build.build_button'),
  },
  hide: {
    backgroundImageProp: 'url(https://gpen.innogamescdn.com/images/game/main/hide.png)',
    elementSelector: '.city_overview_overlay.hide',
    currentLvlElSelector: '.city_overview_overlay.hide [class="twa_content js-content-area"] span:nth-of-type(3)',
    name: 'Cave',
    buildAction: () => buildActionSafe('.city_overview_overlay.hide .btn_build.build_button'),
  },
  lumber: {
    backgroundImageProp: 'url(https://gpen.innogamescdn.com/images/game/main/lumber.png)',
    elementSelector: '.city_overview_overlay.lumber',
    currentLvlElSelector: '.city_overview_overlay.lumber [class="twa_content js-content-area"] span:nth-of-type(3)',
    name: 'Lumber mill',
    buildAction: () => buildActionSafe('.city_overview_overlay.lumber .btn_build.build_button'),
  },
  stoner: {
    backgroundImageProp: 'url(https://gpen.innogamescdn.com/images/game/main/stoner.png)',
    elementSelector: '.city_overview_overlay.stoner',
    currentLvlElSelector: '.city_overview_overlay.stoner [class="twa_content js-content-area"] span:nth-of-type(3)',
    name: 'Quarry',
    buildAction: () => buildActionSafe('.city_overview_overlay.stoner .btn_build.build_button'),
  },
  ironer: {
    backgroundImageProp: 'url(https://gpen.innogamescdn.com/images/game/main/ironer.png)',
    elementSelector: '.city_overview_overlay.ironer',
    currentLvlElSelector: '.city_overview_overlay.ironer [class="twa_content js-content-area"] span:nth-of-type(3)',
    name: 'Silver mine',
    buildAction: () => buildActionSafe('.city_overview_overlay.ironer .btn_build.build_button'),
  },
  market: {
    backgroundImageProp: 'url(https://gpen.innogamescdn.com/images/game/main/market.png)',
    elementSelector: '.city_overview_overlay.market',
    currentLvlElSelector: '.city_overview_overlay.market [class="twa_content js-content-area"] span:nth-of-type(3)',
    name: 'Market',
    buildAction: () => buildActionSafe('.city_overview_overlay.market .btn_build.build_button'),
  },
  docks: {
    backgroundImageProp: 'url(https://gpen.innogamescdn.com/images/game/main/docks.png)',
    elementSelector: '.city_overview_overlay.docks',
    currentLvlElSelector: '.city_overview_overlay.docks [class="twa_content js-content-area"] span:nth-of-type(3)',
    name: 'Harbor',
    buildAction: () => buildActionSafe('.city_overview_overlay.docks .btn_build.build_button'),
  },
  barracks: {
    backgroundImageProp: 'url(https://gpen.innogamescdn.com/images/game/main/barracks.png)',
    elementSelector: '.city_overview_overlay.barracks',
    currentLvlElSelector: '.city_overview_overlay.barracks [class="twa_content js-content-area"] span:nth-of-type(3)',
    name: 'Barracks',
    buildAction: () => buildActionSafe('.city_overview_overlay.barracks .btn_build.build_button'),
  },
  wall: {
    backgroundImageProp: 'url(https://gpen.innogamescdn.com/images/game/main/wall.png)',
    elementSelector: '.city_overview_overlay.wall',
    currentLvlElSelector: '.city_overview_overlay.wall [class="twa_content js-content-area"] span:nth-of-type(3)',
    name: 'City wall',
    buildAction: () => buildActionSafe('.city_overview_overlay.wall .btn_build.build_button'),
  },
  storage: {
    backgroundImageProp: 'url(https://gpen.innogamescdn.com/images/game/main/storage.png)',
    elementSelector: '.city_overview_overlay.storage',
    currentLvlElSelector: '.city_overview_overlay.storage [class="twa_content js-content-area"] span:nth-of-type(3)',
    name: 'Warehouse',
    buildAction: () => buildActionSafe('.city_overview_overlay.storage .btn_build.build_button'),
  },
  farm: {
    backgroundImageProp: 'url(https://gpen.innogamescdn.com/images/game/main/farm.png)',
    elementSelector: '.city_overview_overlay.farm',
    currentLvlElSelector: '.city_overview_overlay.farm [class="twa_content js-content-area"] span:nth-of-type(3)',
    name: 'Farm',
    buildAction: () => buildActionSafe('.city_overview_overlay.farm .btn_build.build_button'),
  },
  academy: {
    backgroundImageProp: 'url(https://gpen.innogamescdn.com/images/game/main/academy.png)',
    elementSelector: '.city_overview_overlay.academy',
    currentLvlElSelector: '.city_overview_overlay.academy [class="twa_content js-content-area"] span:nth-of-type(3)',
    name: 'Academy',
    buildAction: () => buildActionSafe('.city_overview_overlay.academy .btn_build.build_button'),
  },
  temple: {
    backgroundImageProp: 'url(https://gpen.innogamescdn.com/images/game/main/temple.png)',
    elementSelector: '.city_overview_overlay.temple',
    currentLvlElSelector: '.city_overview_overlay.temple [class="twa_content js-content-area"] span:nth-of-type(3)',
    name: 'Temple',
    buildAction: () => buildActionSafe('.city_overview_overlay.temple .btn_build.build_button'),
  }
};