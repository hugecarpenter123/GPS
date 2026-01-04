export type Building = {
  backgroundImageProp: string;
  elementSelector: string;
  currentLvlElSelector: string;
  name: string;
};

export const buildingsSelectors = {
  buildButton: `.btn_build.build_button`,
  currentLvl: `[class="twa_content js-content-area"] span:nth-of-type(3)`,
  disabled: 'disabled',
};

export const buildings = {
  Senate: {
    backgroundImageProp: 'url(https://gpen.innogamescdn.com/images/game/main/main.png)',
    elementSelector: '.city_overview_overlay.main',
    currentLvlElSelector: '.city_overview_overlay.main [class="twa_content js-content-area"] span:nth-of-type(3)',
    name: 'Senate',
  },
  Cave: {
    backgroundImageProp: 'url(https://gpen.innogamescdn.com/images/game/main/hide.png)',
    elementSelector: '.city_overview_overlay.hide',
    currentLvlElSelector: '.city_overview_overlay.hide [class="twa_content js-content-area"] span:nth-of-type(3)',
    name: 'Cave',
  },
  'Lumber mill': {
    backgroundImageProp: 'url(https://gpen.innogamescdn.com/images/game/main/lumber.png)',
    elementSelector: '.city_overview_overlay.lumber',
    currentLvlElSelector: '.city_overview_overlay.lumber [class="twa_content js-content-area"] span:nth-of-type(3)',
    name: 'Lumber mill',
  },
  Quarry: {
    backgroundImageProp: 'url(https://gpen.innogamescdn.com/images/game/main/stoner.png)',
    elementSelector: '.city_overview_overlay.stoner',
    currentLvlElSelector: '.city_overview_overlay.stoner [class="twa_content js-content-area"] span:nth-of-type(3)',
    name: 'Quarry',
  },
  'Silver mine': {
    backgroundImageProp: 'url(https://gpen.innogamescdn.com/images/game/main/ironer.png)',
    elementSelector: '.city_overview_overlay.ironer',
    currentLvlElSelector: '.city_overview_overlay.ironer [class="twa_content js-content-area"] span:nth-of-type(3)',
    name: 'Silver mine',
  },
  Market: {
    backgroundImageProp: 'url(https://gpen.innogamescdn.com/images/game/main/market.png)',
    elementSelector: '.city_overview_overlay.market',
    currentLvlElSelector: '.city_overview_overlay.market [class="twa_content js-content-area"] span:nth-of-type(3)',
    name: 'Market',
  },
  Harbor: {
    backgroundImageProp: 'url(https://gpen.innogamescdn.com/images/game/main/docks.png)',
    elementSelector: '.city_overview_overlay.docks',
    currentLvlElSelector: '.city_overview_overlay.docks [class="twa_content js-content-area"] span:nth-of-type(3)',
    name: 'Harbor',
  },
  Barracks: {
    backgroundImageProp: 'url(https://gpen.innogamescdn.com/images/game/main/barracks.png)',
    elementSelector: '.city_overview_overlay.barracks',
    currentLvlElSelector: '.city_overview_overlay.barracks [class="twa_content js-content-area"] span:nth-of-type(3)',
    name: 'Barracks',
  },
  'City wall': {
    backgroundImageProp: 'url(https://gpen.innogamescdn.com/images/game/main/wall.png)',
    elementSelector: '.city_overview_overlay.wall',
    currentLvlElSelector: '.city_overview_overlay.wall [class="twa_content js-content-area"] span:nth-of-type(3)',
    name: 'City wall',
  },
  Warehouse: {
    backgroundImageProp: 'url(https://gpen.innogamescdn.com/images/game/main/storage.png)',
    elementSelector: '.city_overview_overlay.storage',
    currentLvlElSelector: '.city_overview_overlay.storage [class="twa_content js-content-area"] span:nth-of-type(3)',
    name: 'Warehouse',
  },
  Farm: {
    backgroundImageProp: 'url(https://gpen.innogamescdn.com/images/game/main/farm.png)',
    elementSelector: '.city_overview_overlay.farm',
    currentLvlElSelector: '.city_overview_overlay.farm [class="twa_content js-content-area"] span:nth-of-type(3)',
    name: 'Farm',
  },
  Academy: {
    backgroundImageProp: 'url(https://gpen.innogamescdn.com/images/game/main/academy.png)',
    elementSelector: '.city_overview_overlay.academy',
    currentLvlElSelector: '.city_overview_overlay.academy [class="twa_content js-content-area"] span:nth-of-type(3)',
    name: 'Academy',
  },
  Temple: {
    backgroundImageProp: 'url(https://gpen.innogamescdn.com/images/game/main/temple.png)',
    elementSelector: '.city_overview_overlay.temple',
    currentLvlElSelector: '.city_overview_overlay.temple [class="twa_content js-content-area"] span:nth-of-type(3)',
    name: 'Temple',
  },
} as const;
