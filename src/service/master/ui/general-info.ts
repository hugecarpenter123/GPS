// TODO: tragically needs rework because it's super lame and faulty at the moment (but works)

import generalInfoStyle from './general-info.css';
import generalInfoTemplate from './info-template.html';

export default class GeneralInfo {
  private static instance: GeneralInfo;
  // private info: string = '';
  // private error: string = '';
  private infoTimeout: NodeJS.Timeout | undefined = undefined;
  private errorTimeout: NodeJS.Timeout | undefined = undefined;

  private constructor() {
    this.initInfoContainer();
  }

  public static getInstance(): GeneralInfo {
    if (!GeneralInfo.instance) {
      GeneralInfo.instance = new GeneralInfo();
    }
    return GeneralInfo.instance;
  }

  private initInfoContainer() {
    console.log('initInfoContainer');
    const style = document.createElement('style');
    style.innerHTML = generalInfoStyle;
    document.head.appendChild(style);

    const infoContainer = document.createElement('div');
    infoContainer.innerHTML = generalInfoTemplate;
    document.body.appendChild(infoContainer);
  }

  public showInfo(title: string, text: string, duration?: number) {
    clearTimeout(this.infoTimeout);
    const infoContainer = document.getElementById('info-container')!;
    infoContainer.querySelector('.info-title')!.textContent = title;
    infoContainer.querySelector('.info-text')!.textContent = text;
    infoContainer.classList.remove('hidden');
    if (duration) {
      this,
        (this.infoTimeout = setTimeout(() => {
          this.hideInfo();
        }, duration));
    }
  }

  public hideInfo() {
    const infoContainer = document.getElementById('info-container')!;
    infoContainer.classList.add('hidden');
    clearTimeout(this.infoTimeout);
  }

  // TODO: add method for recognizing what manageer used it, in order to allow it to hide the message safely
  // TODO extend to have many errors at once
  public showError(title: string, text: string, duration?: number) {
    clearTimeout(this.errorTimeout);
    const errorContainer = document.getElementById('error-container')!;
    errorContainer.querySelector('.error-title')!.textContent = title;
    errorContainer.querySelector('.error-text')!.textContent = text;
    errorContainer.classList.remove('hidden');
    if (duration) {
      this.errorTimeout = setTimeout(() => {
        this.hideError();
      }, duration);
    }
  }

  public hideError() {
    const errorContainer = document.getElementById('error-container')!;
    errorContainer.classList.add('hidden');
    clearTimeout(this.errorTimeout);
  }
}
