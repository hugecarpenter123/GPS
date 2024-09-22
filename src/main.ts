import MasterManager from "./service/master/master-manager";
import { onPageLoad } from "./utility/ui-utility";

const main = async () => {
  console.log('VERY POLITE GPS v.0.5.0 MVP walikonie special edition (c) 2024');
  const masterManager = await MasterManager.getInstance();
}

onPageLoad(main);