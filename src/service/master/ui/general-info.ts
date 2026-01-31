import generalInfoStyle from './general-info.css?raw';
import generalInfoTemplate from './template.html?raw';

export default class GeneralInfo {
  private static instance: GeneralInfo;
  private container!: HTMLDivElement;
  private timeoutMap: Record<number, NodeJS.Timeout> = {};

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
    infoContainer.id = 'general-info';
    document.body.appendChild(infoContainer);
    this.container = infoContainer;
  }

  public showInfo(title: string, text: string, infoType: 'error' | 'info', duration?: number) {
    const id = Date.now();
    const info = document.createElement('div');
    this.container.appendChild(info);

    info.outerHTML = generalInfoTemplate
      .replace('{{title}}', title)
      .replace('{{description}}', text)
      .replace('{{infoType}}', `general-info-${infoType}`)
      .replace('{{id}}', id.toString());

    this.timeoutMap[id] = setTimeout(() => {
      this.hideInfo(id);
    }, duration ?? 60000);
    return id;
  }

  public hideInfo(id: number) {
    clearTimeout(this.timeoutMap[id]);
    delete this.timeoutMap[id];
    const el = document.querySelector(`[data-general-info-id="${id}"]`);
    el?.classList.replace('general-info-in', 'general-info-out');
    setTimeout(() => {
      el?.remove();
    }, 400);
  }
}
