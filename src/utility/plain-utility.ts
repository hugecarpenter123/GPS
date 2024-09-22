/**
 * Takes string in format of xx:xx:xx - parses and returns number in miliseconds
 * @param text string in format 00:02:38
 * @returns miliseconds
 */
export const textToMs = (text: string): number => {
  const timeArray = text.split(':').map(el => parseInt(el));
  const timeout = (timeArray[0] * 1000 * 60 * 60) + (timeArray[1] * 1000 * 60) + (timeArray[2] * 1000);
  console.log('sparsowano czas:', timeout)
  return timeout;
}

export const isVisible = (element: HTMLElement) => {
  return element.offsetParent;
}

export const addDelay = (time: number = 1000): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, time));
}

export const getTimeInFuture = (timeMs: number): string => {
  const now = new Date();
  const futureDate = new Date(now.getTime() + timeMs);
  return `${futureDate.getHours()}:${futureDate.getMinutes()}:${futureDate.getSeconds()}`;
}

export function getRandomInt(max: number) {
  return Math.floor(Math.random() * max);
}

export const areGridsEqual = (grid1: [number, number], grid2: [number, number]): boolean => {
  return grid1[0] === grid2[0] && grid1[1] === grid2[1];
}

export const triggerHover = (element: HTMLElement) => {
  element.dispatchEvent(new Event('mouseover', {
    bubbles: true,
    cancelable: true,
  }));
}

export const cancelHover = (element: HTMLElement) => {
  element.dispatchEvent(new Event('mouseout', {
    bubbles: true,
    cancelable: true,
  }));
}