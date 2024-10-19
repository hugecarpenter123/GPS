import MasterManager from "./service/master/master-manager";
import { onPageLoad } from "./utility/ui-utility";

const main = async () => {
  console.log('VERY POLITE GPS v.0.5.0 MVP walikonie special edition (c) 2024');
  const currentUrl = window.location.href;
  if (/.*grepolis.com\/game\/.*/.test(currentUrl)) {
    const masterManager = await MasterManager.getInstance();
  } else if (currentUrl.includes('start?nosession')) {
    setInterval(() => {
      GM_setValue('forceRestart', true);
      document.querySelector<HTMLElement>('.world_name.end_game_type_world_wonder')?.click();
    }, 1 * 1000 * 60 * 5);
  }
}

onPageLoad(main);