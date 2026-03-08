import MasterManager from './service/master/master-manager';
import { addDelay, getCookie, setCookie } from './utility/plain-utility';
import { onPageLoad, setNativeValue, waitForElementInterval } from './utility/ui-utility';
import tailwindCssRaw from '~/styles/tailwind.css';

let timeoutId: NodeJS.Timeout | undefined = undefined;

// https://pl-play.grepolis.com/?logout=true&lps_flow=after_glps_shim
const main = async () => {
  console.log('VERY POLITE GPS v.0.5.0 MVP walikonie special edition (c) 2024');

  // master css injection
  const tailwindCssStyle = document.createElement('style');
  tailwindCssStyle.setAttribute('data-source', 'gps-tailwind');
  tailwindCssStyle.textContent = tailwindCssRaw;
  document.head.appendChild(tailwindCssStyle);

  const currentUrl = window.location.href;
  const isInGameRegex = /.*grepolis.com\/game\/.*/;
  if (isInGameRegex.test(currentUrl)) {
    // actual boot
    await MasterManager.getInstance();
  } else {
    const autoRelogin = getCookie('autoRelogin') as { value: boolean; after: number } | null;

    if (currentUrl.includes('/start/index') && autoRelogin?.value) {
      waitForElementInterval(`[data-worldname="${getCookie('worldname')}"]`, {
        retries: 15,
        interval: 500,
      })
        .then(el => el.click())
        .catch(e => {
          console.error("[AutoRelogin]: could't enter the world:", e);
        });
    }

    if (currentUrl.includes('start?nosession')) {
      if (autoRelogin?.value) {
        console.log(`will try to reconnect in ${autoRelogin?.after / 1000 || 0} seconds`);
        timeoutId = setTimeout(() => {
          if (isInGameRegex.test(window.location.href)) {
            return;
          }
          setCookie('autoStart', 1);
          waitForElementInterval(`[data-worldname="${getCookie('worldname')}"]`, {
            retries: 15,
            interval: 500,
          })
            .then(el => el.click())
            .catch();
        }, autoRelogin?.after || 0);
      }
    }
    // signed out entirely
    else if (
      currentUrl.includes('logout') &&
      document.querySelector('#page_login_always-visible_input_player-identifier')
    ) {
      const credentials = getCookie('cr3');
      if (credentials && autoRelogin?.value) {
        console.log(`will try to reconnect in ${autoRelogin?.after / 1000 || 0} seconds`);
        timeoutId = setTimeout(async () => {
          if (isInGameRegex.test(window.location.href)) {
            return;
          }
          setCookie('autoStart', 1);
          const [login, pwd] = atob(credentials).split(':');
          setNativeValue(
            document.querySelector<HTMLInputElement>('#page_login_always-visible_input_player-identifier')!,
            login,
          );
          setNativeValue(document.querySelector<HTMLInputElement>('#page_login_always-visible_input_password')!, pwd);
          await addDelay(1000);
          document.querySelector<HTMLButtonElement>('#page_login_always-visible_button_login')!.click();
        }, autoRelogin?.after || 0);
      }
    }
  }
};

onPageLoad(main);
