import { addDelay, isVisible } from "./plain-utility";

export function simulateClick(element: HTMLElement) {
  if (element) {
    const rect = element.getBoundingClientRect();
    const event = new MouseEvent('click', {
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      bubbles: true,
      cancelable: true,
      view: window
    });
    element.dispatchEvent(event);
  }
}

// Funkcja do ustawienia wartości i wywołania zdarzeń
export function setInputValue(inputElement: HTMLInputElement, value: string | number) {
  // Sprawdzenie, czy element jest rzeczywiście <input>
  if (inputElement && inputElement.tagName === 'INPUT') {
    // Ustawienie wartości inputu
    inputElement.value = typeof value === "number" ? value.toString() : value;

    // Tworzenie zdarzenia input
    const inputEvent = new Event('input', { bubbles: true });
    inputElement.dispatchEvent(inputEvent);

    // Tworzenie zdarzenia change
    const changeEvent = new Event('change', { bubbles: true });
    inputElement.dispatchEvent(changeEvent);
  } else {
    console.warn(`setInputValue(${inputElement.name}) unsuccessful`)
  }
}

export function waitForElements(selector: string, timeoutMs: number = 8000): Promise<NodeListOf<HTMLElement>> {
  return new Promise<NodeListOf<HTMLElement>>((resolve, reject) => {
    // Funkcja do aktualizacji wyników
    const elements = document.querySelectorAll(selector) as NodeListOf<HTMLElement>;
    if (elements.length > 0) {
      resolve(elements);
    }
    else {
      // Ustawienie observera do monitorowania DOM
      let timeout = setTimeout(() => {
        observer.disconnect();
        reject(`waitForElements(${selector}) - not found within timeout`);
      }, timeoutMs);

      const observer = new MutationObserver(() => {
        const elements = document.querySelectorAll(selector) as NodeListOf<HTMLElement>;
        if (elements.length > 0) {
          observer.disconnect();
          clearTimeout(timeout);
          resolve(elements);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });
    }

  });
}


export function waitForElement(selector: string, timeout: number = 8000): Promise<HTMLElement> {
  return new Promise((resolve, reject) => {
    const element = document.querySelector(selector) as HTMLElement;

    // Jeśli element już istnieje to zostaje zwrócony odrazu
    if (element) {
      // console.log(`${selector} - FOUND, resolve:`, element);
      return resolve(element);
    } else {
      // console.log(`${selector} - not found, mount observer`);

      // Inicjalizacja timeoutu
      const timeoutId = setTimeout(() => {
        observer.disconnect();
        reject(`${selector} - not found within timeout`);
      }, timeout);

      // Inicjalizacja MutationObserver
      const observer = new MutationObserver(() => {
        // console.log(`${selector}.observer fired`);
        const element = document.querySelector(selector) as HTMLElement;
        if (element) {
          observer.disconnect();
          clearTimeout(timeoutId); // Czyszczenie timeoutu
          // console.log(`\t${selector} - FOUND resolve element:`, element);
          resolve(element);
        }
      });

      // Rozpoczęcie obserwacji
      observer.observe(document.body, { childList: true, subtree: true });
    }
  });
}

export function waitForElementFromNode(parentNode: HTMLElement | Document, selector: string, timeout: number = 8000): Promise<HTMLElement> {
  return new Promise((resolve, reject) => {
    const element = parentNode.querySelector(selector) as HTMLElement;

    // Jeśli element już istnieje to zostaje zwrócony odrazu
    if (element) {
      // console.log(`${selector} - FOUND, resolve:`, element);
      return resolve(element);
    } else {
      // console.log(`${selector} - not found, mount observer`);

      // Inicjalizacja timeoutu
      const timeoutId = setTimeout(() => {
        observer.disconnect();
        reject(`${selector} - not found within timeout`);
      }, timeout);

      // Inicjalizacja MutationObserver
      const observer = new MutationObserver(() => {
        // console.log(`${selector}.observer fired`);
        const element = parentNode.querySelector(selector) as HTMLElement;
        if (element) {
          observer.disconnect();
          clearTimeout(timeoutId); // Czyszczenie timeoutu
          // console.log(`\t${selector} - FOUND resolve element:`, element);
          resolve(element);
        }
      });

      // Rozpoczęcie obserwacji
      observer.observe(
        parentNode instanceof Document ? parentNode.body : parentNode,
        { childList: true, subtree: true }
      );
    }
  });
}

/** Function that waits for DOM to load then applies main loop. */
export function onPageLoad(callback: () => Promise<void>) {
  const initWrapper = () => {
    // const lodadingContainer = document.querySelector('#screen-loading');
    const timeout = setTimeout(() => {
      clearTimeout(timeout);
      setTimeout(callback, 2000);
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWrapper);
  } else {
    initWrapper();
  }
}

function simulateKeyPress(key: string) {
  // Tworzenie zdarzenia keydown
  const keydownEvent = new KeyboardEvent('keydown', {
    key: key,
    code: `Key${key.toUpperCase()}`, // Zakładając, że używasz klawisza alfanumerycznego
    keyCode: key.charCodeAt(0), // Kod klawisza w starszych przeglądarkach
    which: key.charCodeAt(0),
    bubbles: true,
    cancelable: true
  });

  // Tworzenie zdarzenia keyup
  const keyupEvent = new KeyboardEvent('keyup', {
    key: key,
    code: `Key${key.toUpperCase()}`,
    keyCode: key.charCodeAt(0),
    which: key.charCodeAt(0),
    bubbles: true,
    cancelable: true
  });

  // Wywoływanie zdarzeń na całym dokumencie
  document.dispatchEvent(keydownEvent);
  setTimeout(() => {
    document.dispatchEvent(keyupEvent);
  }, 100); // Czas trwania wciśnięcia klawisza, w milisekundach
}

export function mouseDownEvent(element: HTMLElement) {
  const mouseDownEvent = new MouseEvent('mousedown', {
    bubbles: true,
    cancelable: true,
    view: window
  });
  if (element) {
    element.dispatchEvent(mouseDownEvent);
  }
}

export async function performComplexClick(element: HTMLElement) {
  mouseDownEvent(element);
  await addDelay(100);
  mouseUpEvent(element);
}

export function mouseUpEvent(element: HTMLElement) {
  const mouseUpEvent = new MouseEvent('mouseup', {
    bubbles: true,
    cancelable: true,
    view: window
  });
  if (element) {
    element.dispatchEvent(mouseUpEvent);
  } else {
    console.warn(`mouseUpEvent() - ${element} not found`);
  }
}
