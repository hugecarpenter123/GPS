import MasterManager from "./service/master/master-manager";
import { setCookie } from "./utility/plain-utility";
import { onPageLoad } from "./utility/ui-utility";
// https://pl-play.grepolis.com/?logout=true&lps_flow=after_glps_shim
const main = async () => {
  console.log('VERY POLITE GPS v.0.5.0 MVP walikonie special edition (c) 2024');
  const currentUrl = window.location.href;
  if (/.*grepolis.com\/game\/.*/.test(currentUrl)) {
    const masterManager = await MasterManager.getInstance();
  } else if (currentUrl.includes('start?nosession')) {
    console.log('will try to reconnect in 5 minutes');
    setInterval(() => {
      setCookie('forceRestart', true);
      document.querySelector<HTMLElement>('.world_name.end_game_type_world_wonder')?.click();
    }, 1 * 1000 * 60 * 5);
  }
}

onPageLoad(main);