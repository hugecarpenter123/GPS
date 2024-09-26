function mouseDownEvent(element) {
  const mouseDownEvent = new MouseEvent('mousedown', {
    bubbles: true,
    cancelable: true,
    view: window
  });
  if (element) {
    element.dispatchEvent(mouseDownEvent);
  }
}

async function performComplexClick(element) {
  mouseDownEvent(element);
  mouseUpEvent(element);
}

function mouseUpEvent(element) {
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

const addDelay = (time = 1000) => {
  return new Promise(resolve => setTimeout(resolve, time));
}

// Funkcja do ustawienia wartości i wywołania zdarzeń
function setInputValue(inputElement, value) {
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

const triggerHover = (element) => {
  element.dispatchEvent(new Event('mouseover', {
    bubbles: true,
    cancelable: true,
  }));
}

const cancelHover = (element) => {
  element.dispatchEvent(new Event('mouseout', {
    bubbles: true,
    cancelable: true,
  }));
}