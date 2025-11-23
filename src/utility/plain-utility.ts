/**
 * Takes string in format of xx:xx:xx - parses and returns number in miliseconds
 * @param text string in format 00:02:38
 * @returns miliseconds
 */
export const HHMMSS_toMS = (text: string): number => {
  const timeArray = text.split(':').map(el => parseInt(el));
  const timeout = timeArray[0] * 1000 * 60 * 60 + timeArray[1] * 1000 * 60 + timeArray[2] * 1000;
  return timeout;
};

export const isVisible = (element: HTMLElement) => {
  return element.offsetParent;
};

export const addDelay = (time: number = 1000): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, time));
};

export const msToFutureHHMMSS = (timeMs: number): string => {
  const now = new Date();
  const futureDate = new Date(now.getTime() + timeMs);
  return `${futureDate.getHours().toString().padStart(2, '0')}:${futureDate.getMinutes().toString().padStart(2, '0')}:${futureDate.getSeconds().toString().padStart(2, '0')}`;
};

export const dateToHHMMSS = (date: Date): string => {
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`;
};

export const msToHHMMSS = (ms: number): string => {
  let remaining = Math.floor(ms / 1000);
  const hours = Math.floor(remaining / 3600) % 24;
  remaining %= 3600;
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

export function getRandomInt(max: number) {
  return Math.floor(Math.random() * max);
}

export const areGridsEqual = (grid1: [number, number], grid2: [number, number]): boolean => {
  return grid1[0] === grid2[0] && grid1[1] === grid2[1];
};

export function areArraysContentsEqual(arr1: string[], arr2: string[]): boolean {
  if (arr1.length !== arr2.length) return false;
  for (let i = 0; i < arr1.length; i++) {
    if (arr1[i] !== arr2[i]) return false;
  }
  return true;
}

export function shuffleArray(array: any[]) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

export function isMobile(): boolean {
  if ((navigator as any).userAgentData) {
    return (navigator as any).userAgentData.mobile;
  } else {
    if (
      navigator.userAgent.match(/iPhone/i) ||
      navigator.userAgent.match(/iPad/i) ||
      navigator.userAgent.match(/Android/i)
    )
      return true;
    return false;
  }
}

export const getRandomMs = (min: number, max: number): number => {
  return Math.floor(Math.random() * (max - min + 1) + min);
};

export function calculateTimeToNextOccurrence(timeString: string): number {
  console.log('timeString to calculate: ', timeString);
  const [hours, minutes, seconds] = timeString.split(':').map(Number);
  const now = new Date();
  const targetTime = new Date(now);

  targetTime.setHours(hours, minutes, seconds, 0);

  // If the target time is earlier than or equal to the current time, assume it's for the next day
  if (targetTime <= now) {
    targetTime.setDate(targetTime.getDate() + 1);
  }

  return targetTime.getTime() - now.getTime();
}

export function getCookie(name: string) {
  const cookies = document.cookie.split('; ');
  for (let cookie of cookies) {
    const [key, value] = cookie.split('=');
    if (key === name) {
      return JSON.parse(decodeURIComponent(value));
    }
  }
  return null;
}

export function setCookie(
  name: string,
  value: any,
  options: { expires?: Date; path?: string; domain?: string; secure?: boolean; sameSite?: string } = {},
) {
  const {
    expires = new Date(Date.now() + 24 * 60 * 60 * 1000),
    path = '/',
    domain = '.grepolis.com',
    secure = false,
    sameSite = 'Lax',
  } = options;
  let cookieString = `${name}=${encodeURIComponent(JSON.stringify(value))}; path=${path}; SameSite=${sameSite}`;

  if (expires) {
    cookieString += `; expires=${expires.toUTCString()}`;
  }
  if (domain) {
    cookieString += `; domain=${domain}`;
  }
  if (secure) {
    cookieString += '; secure';
  }

  document.cookie = cookieString;
}

export const getCopyOf = (obj: any): any => {
  return JSON.parse(JSON.stringify(obj));
};

export const getBrowserStateSnapshot = (): any => {
  return {
    documentVisibility: document.visibilityState,
    windowFocus: document.hasFocus(),
    windowSize: { width: window.innerWidth, height: window.innerHeight },
  };
};

export const getElementStateSnapshot = (element: HTMLElement): any => {
  return {
    elementVisibility: element.offsetParent !== null,
    elementPosition: element.getBoundingClientRect(),
    elementZIndex: window.getComputedStyle(element).zIndex,
    elementInViewport:
      element.getBoundingClientRect().top >= 0 && element.getBoundingClientRect().bottom <= window.innerHeight,
    elementClickable: !!element.onclick,
  };
};

export function shuffle(array: any[]) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

export async function doWhile(
  condition: () => Promise<boolean> | boolean,
  action: (() => Promise<void> | void) | null,
  config: { delay?: number; maxIterations?: number; onError?: () => any } = {},
) {
  const defaultConfig = { delay: 333, maxIterations: 6 };
  const finalConfig = {
    delay: config.delay !== undefined ? config.delay : defaultConfig.delay,
    maxIterations: config.maxIterations !== undefined ? config.maxIterations : defaultConfig.maxIterations,
    onError: config.onError,
  };

  let counter = 0;
  while ((await condition()) && counter < finalConfig.maxIterations) {
    if (action) await action();
    await addDelay(finalConfig.delay);
    counter++;
  }

  if (counter >= finalConfig.maxIterations) {
    if (finalConfig.onError) finalConfig.onError();
    else throw new Error('Max iterations reached');
  }
}

export function waitWhile(
  condition: () => Promise<boolean> | boolean,
  config: { delay?: number; maxIterations?: number; onError?: () => any } = {},
) {
  const defaultConfig = { delay: 333, maxIterations: 6 };
  const finalConfig = {
    delay: config.delay !== undefined ? config.delay : defaultConfig.delay,
    maxIterations: config.maxIterations !== undefined ? config.maxIterations : defaultConfig.maxIterations,
    onError: config.onError,
  };
  return doWhile(condition, null, finalConfig);
}

export const hasAnyValue = (obj: { [key: string]: any }, targetValue: any): boolean => {
  for (const value of Object.values(obj)) {
    if (typeof value === 'object' && value !== null) {
      if (hasAnyValue(value, targetValue)) return true;
    } else if (value === targetValue) {
      return true;
    }
  }
  return false;
};

export function getDaysAhead(target: Date, now: Date = new Date()): number {
  // Tworzymy nowe daty tylko z rokiem, miesiącem i dniem (godzina 0:00:00)
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  // Różnica w milisekundach, dzielimy przez liczbę ms w dniu
  return Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

export function getTopmostAncestorByClass(element: HTMLElement, className: string) {
  let result = null;
  let current = element.parentElement;
  while (current) {
    if (current.classList.contains(className)) {
      result = current;
    }
    current = current.parentElement;
  }
  return result;
}

export const getMsFromStartOfDay = (unixTimestamp: number) => {
  const date = new Date(unixTimestamp);
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  return date.getTime() - startOfDay.getTime();
};

export const findLastIndex = <T>(arr: T[], condition: (item: T) => boolean): number => {
  let lastIndex = -1;
  for (let i = arr.length - 1; i >= 0; i--) {
    if (condition(arr[i])) {
      lastIndex = i;
      break;
    }
  }
  return lastIndex;
};
