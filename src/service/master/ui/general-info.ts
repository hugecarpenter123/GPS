import generalInfoStyle from "./general-info.css";
import generalInfoTemplate from "./info-template.html";

export default class GeneralInfo {
  private static instance: GeneralInfo;

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

  public showInfo(title: string, text: string) {
    const infoContainer = document.getElementById('info-container')!;
    infoContainer.querySelector('.info-title')!.textContent = title;
    infoContainer.querySelector('.info-text')!.textContent = text;
    infoContainer.classList.remove('hidden');
  }

  public hideInfo() {
    const infoContainer = document.getElementById('info-container')!;
    infoContainer.classList.add('hidden');
  }

}