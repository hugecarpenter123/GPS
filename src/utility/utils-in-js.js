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