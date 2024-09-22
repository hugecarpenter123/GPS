(()=>{"use strict";var e={7:e=>{var t,n="object"==typeof Reflect?Reflect:null,r=n&&"function"==typeof n.apply?n.apply:function(e,t,n){return Function.prototype.apply.call(e,t,n)};t=n&&"function"==typeof n.ownKeys?n.ownKeys:Object.getOwnPropertySymbols?function(e){return Object.getOwnPropertyNames(e).concat(Object.getOwnPropertySymbols(e))}:function(e){return Object.getOwnPropertyNames(e)};var i=Number.isNaN||function(e){return e!=e};function o(){o.init.call(this)}e.exports=o,e.exports.once=function(e,t){return new Promise((function(n,r){function i(n){e.removeListener(t,o),r(n)}function o(){"function"==typeof e.removeListener&&e.removeListener("error",i),n([].slice.call(arguments))}m(e,t,o,{once:!0}),"error"!==t&&function(e,t){"function"==typeof e.on&&m(e,"error",t,{once:!0})}(e,i)}))},o.EventEmitter=o,o.prototype._events=void 0,o.prototype._eventsCount=0,o.prototype._maxListeners=void 0;var s=10;function a(e){if("function"!=typeof e)throw new TypeError('The "listener" argument must be of type Function. Received type '+typeof e)}function c(e){return void 0===e._maxListeners?o.defaultMaxListeners:e._maxListeners}function l(e,t,n,r){var i,o,s,l;if(a(n),void 0===(o=e._events)?(o=e._events=Object.create(null),e._eventsCount=0):(void 0!==o.newListener&&(e.emit("newListener",t,n.listener?n.listener:n),o=e._events),s=o[t]),void 0===s)s=o[t]=n,++e._eventsCount;else if("function"==typeof s?s=o[t]=r?[n,s]:[s,n]:r?s.unshift(n):s.push(n),(i=c(e))>0&&s.length>i&&!s.warned){s.warned=!0;var u=new Error("Possible EventEmitter memory leak detected. "+s.length+" "+String(t)+" listeners added. Use emitter.setMaxListeners() to increase limit");u.name="MaxListenersExceededWarning",u.emitter=e,u.type=t,u.count=s.length,l=u,console&&console.warn&&console.warn(l)}return e}function u(){if(!this.fired)return this.target.removeListener(this.type,this.wrapFn),this.fired=!0,0===arguments.length?this.listener.call(this.target):this.listener.apply(this.target,arguments)}function d(e,t,n){var r={fired:!1,wrapFn:void 0,target:e,type:t,listener:n},i=u.bind(r);return i.listener=n,r.wrapFn=i,i}function f(e,t,n){var r=e._events;if(void 0===r)return[];var i=r[t];return void 0===i?[]:"function"==typeof i?n?[i.listener||i]:[i]:n?function(e){for(var t=new Array(e.length),n=0;n<t.length;++n)t[n]=e[n].listener||e[n];return t}(i):p(i,i.length)}function h(e){var t=this._events;if(void 0!==t){var n=t[e];if("function"==typeof n)return 1;if(void 0!==n)return n.length}return 0}function p(e,t){for(var n=new Array(t),r=0;r<t;++r)n[r]=e[r];return n}function m(e,t,n,r){if("function"==typeof e.on)r.once?e.once(t,n):e.on(t,n);else{if("function"!=typeof e.addEventListener)throw new TypeError('The "emitter" argument must be of type EventEmitter. Received type '+typeof e);e.addEventListener(t,(function i(o){r.once&&e.removeEventListener(t,i),n(o)}))}}Object.defineProperty(o,"defaultMaxListeners",{enumerable:!0,get:function(){return s},set:function(e){if("number"!=typeof e||e<0||i(e))throw new RangeError('The value of "defaultMaxListeners" is out of range. It must be a non-negative number. Received '+e+".");s=e}}),o.init=function(){void 0!==this._events&&this._events!==Object.getPrototypeOf(this)._events||(this._events=Object.create(null),this._eventsCount=0),this._maxListeners=this._maxListeners||void 0},o.prototype.setMaxListeners=function(e){if("number"!=typeof e||e<0||i(e))throw new RangeError('The value of "n" is out of range. It must be a non-negative number. Received '+e+".");return this._maxListeners=e,this},o.prototype.getMaxListeners=function(){return c(this)},o.prototype.emit=function(e){for(var t=[],n=1;n<arguments.length;n++)t.push(arguments[n]);var i="error"===e,o=this._events;if(void 0!==o)i=i&&void 0===o.error;else if(!i)return!1;if(i){var s;if(t.length>0&&(s=t[0]),s instanceof Error)throw s;var a=new Error("Unhandled error."+(s?" ("+s.message+")":""));throw a.context=s,a}var c=o[e];if(void 0===c)return!1;if("function"==typeof c)r(c,this,t);else{var l=c.length,u=p(c,l);for(n=0;n<l;++n)r(u[n],this,t)}return!0},o.prototype.addListener=function(e,t){return l(this,e,t,!1)},o.prototype.on=o.prototype.addListener,o.prototype.prependListener=function(e,t){return l(this,e,t,!0)},o.prototype.once=function(e,t){return a(t),this.on(e,d(this,e,t)),this},o.prototype.prependOnceListener=function(e,t){return a(t),this.prependListener(e,d(this,e,t)),this},o.prototype.removeListener=function(e,t){var n,r,i,o,s;if(a(t),void 0===(r=this._events))return this;if(void 0===(n=r[e]))return this;if(n===t||n.listener===t)0==--this._eventsCount?this._events=Object.create(null):(delete r[e],r.removeListener&&this.emit("removeListener",e,n.listener||t));else if("function"!=typeof n){for(i=-1,o=n.length-1;o>=0;o--)if(n[o]===t||n[o].listener===t){s=n[o].listener,i=o;break}if(i<0)return this;0===i?n.shift():function(e,t){for(;t+1<e.length;t++)e[t]=e[t+1];e.pop()}(n,i),1===n.length&&(r[e]=n[0]),void 0!==r.removeListener&&this.emit("removeListener",e,s||t)}return this},o.prototype.off=o.prototype.removeListener,o.prototype.removeAllListeners=function(e){var t,n,r;if(void 0===(n=this._events))return this;if(void 0===n.removeListener)return 0===arguments.length?(this._events=Object.create(null),this._eventsCount=0):void 0!==n[e]&&(0==--this._eventsCount?this._events=Object.create(null):delete n[e]),this;if(0===arguments.length){var i,o=Object.keys(n);for(r=0;r<o.length;++r)"removeListener"!==(i=o[r])&&this.removeAllListeners(i);return this.removeAllListeners("removeListener"),this._events=Object.create(null),this._eventsCount=0,this}if("function"==typeof(t=n[e]))this.removeListener(e,t);else if(void 0!==t)for(r=t.length-1;r>=0;r--)this.removeListener(e,t[r]);return this},o.prototype.listeners=function(e){return f(this,e,!0)},o.prototype.rawListeners=function(e){return f(this,e,!1)},o.listenerCount=function(e,t){return"function"==typeof e.listenerCount?e.listenerCount(t):h.call(e,t)},o.prototype.listenerCount=h,o.prototype.eventNames=function(){return this._eventsCount>0?t(this._events):[]}},813:(e,t,n)=>{n.r(t),n.d(t,{default:()=>r});const r='<div style="margin-top: 8px;">\r\n  <input id="schedule-date" type="date" />\r\n  <input id="schedule-time" type="text" size="5" placeholder="hh:mm:ss" />\r\n  <button type="button" id="schedule-button">Schedule</button>\r\n</div>'},604:(e,t,n)=>{n.r(t),n.d(t,{default:()=>r});const r="#config-popup-container * {\r\n  margin: 0;\r\n  padding: 0;\r\n  box-sizing: border-box;\r\n  font-family: Arial, Helvetica, sans-serif;\r\n  color: black;\r\n}\r\n\r\n#config-popup-header {\r\n  margin-bottom: 24px;\r\n  text-shadow: 2px 2px 2px gray;\r\n}\r\n\r\n#config-popup-container {\r\n  position: absolute;\r\n  top: 50%;\r\n  right: 50%;\r\n  transform: translate(50%, -50%);\r\n  box-shadow: 0px 3px 8px 0px rgba(157, 157, 157, 0.4);\r\n  border-radius: 4px;\r\n  width: 350px;\r\n  max-width: 80%;\r\n  overflow: hidden;\r\n  background-color: antiquewhite;\r\n  border: 1px solid rgba(165, 125, 11, 1);\r\n  z-index: 100;\r\n  padding: 16px;\r\n}\r\n\r\n.input-wrapper {\r\n  display: grid;\r\n  grid-template-columns: auto 1fr;\r\n  justify-items: start;\r\n  column-gap: 8px;\r\n  row-gap: 8px;\r\n  align-items: center;\r\n  margin-top: 16px;\r\n}\r\n\r\n.input-wrapper label {\r\n  background-color: none;\r\n}\r\n\r\n.expandable-section {\r\n  grid-column-start: 2;\r\n}\r\n\r\n#config-popup-content {\r\n  display: flex;\r\n  flex-direction: column;\r\n  border-radius: 4px;\r\n  gap: 8px;\r\n}\r\n\r\n#config-popup-content h1 {\r\n  font-weight: 500;\r\n  font-size: 1.7rem;\r\n  align-self: center;\r\n  margin-bottom: 8px;\r\n}\r\n\r\n.label-chevron {\r\n  display: flex;\r\n  align-items: center;\r\n  gap:8px\r\n}\r\n\r\n\r\n#button-panel {\r\n  align-self: flex-end;\r\n  margin-top: 20px;\r\n}\r\n\r\n#button-panel button {\r\n  padding: 4px;\r\n  cursor: pointer;\r\n}\r\n\r\n#config-popup-container.minimized {\r\n  top: auto;\r\n  bottom: 150px;\r\n  right: 30px;\r\n  width: 40px;\r\n  height: 40px;\r\n  border-radius: 50%;\r\n  box-shadow: none;\r\n}\r\n\r\n\r\n.show-trigger {\r\n  display: none;\r\n}\r\n\r\n#close-popup {\r\n  cursor: pointer;\r\n  position: absolute;\r\n  right: 10px;\r\n  top: 10px;\r\n  transition-duration: 125ms;\r\n  color: tomato;\r\n  text-shadow: 0px 0px 2px black;\r\n}\r\n\r\n#close-popup:hover {\r\n  animation: freak 1s ease-in both infinite;\r\n}\r\n\r\n#config-popup-container.minimized #config-popup-content {\r\n  display: none;\r\n}\r\n\r\n#config-popup-container.minimized #config-popup-header {\r\n  display: none;\r\n}\r\n\r\n#config-popup-container.minimized {\r\n  padding: 0;\r\n}\r\n\r\n#config-popup-container.minimized .show-trigger {\r\n  cursor: pointer;\r\n  width: 100%;\r\n  height: 100%;\r\n  display: flex;\r\n  align-items: center;\r\n  justify-content: center;\r\n  font-size: 0.7rem;\r\n  font-weight: 600;\r\n  text-shadow: 0px 1px 1px rgba(165, 125, 11, 1);\r\n}\r\n\r\n.section-header {\r\n  display: flex;\r\n  flex-direction: row;\r\n  align-items: center;\r\n  gap: 5px;\r\n}\r\n\r\n.section-content {\r\n  display: flex;\r\n  flex-direction: column;\r\n  margin-left: 20px;\r\n}\r\n\r\n.arrow-down {\r\n  cursor: pointer;\r\n}\r\n\r\n.hidden {\r\n  display: none !important;\r\n}\r\n\r\n.rotate {\r\n  transform: rotate(180deg);\r\n}\r\n\r\n@keyframes freak {\r\n  0% {\r\n    transform: scale(1);\r\n  }\r\n\r\n  33.33% {\r\n    transform: scale(0.8);\r\n  }\r\n\r\n  66.66% {\r\n    transform: scale(1.2);\r\n  }\r\n}"},396:(e,t,n)=>{n.r(t),n.d(t,{default:()=>r});const r='<div id="config-popup-container" class="">\r\n  <div id="config-popup-header">\r\n    <h1>GPS config</h1>\r\n    <div id="close-popup">&#10006;</div>\r\n  </div>\r\n  <div id="config-popup-content">\r\n    <div class="input-wrapper">\r\n      <input type="checkbox" id="city-switch" checked />\r\n      <label for="city-switch">Switch cities automatically</label>\r\n    </div>\r\n    <div class="input-wrapper">\r\n      <input type="checkbox" id="farm" checked />\r\n      <div class="label-chevron">\r\n        <label for="farm">\r\n          Farm manager\r\n        </label>\r\n        <svg xmlns="http://www.w3.org/2000/svg" class="arrow-down" width="16" height="16" fill="currentColor"\r\n          class="bi bi-chevron-down" viewBox="0 0 16 16">\r\n          <path fill-rule="evenodd"\r\n            d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708" />\r\n        </svg>\r\n      </div>\r\n      <div class="expandable-section hidden">\r\n        <div class="section-header"></div>\r\n        <div class="section-content">\r\n          <div class="input-wapper">\r\n            <label>\r\n              Time interval\r\n            </label>\r\n            <select id="time-interval-select">\r\n            </select>\r\n          </div>\r\n        </div>\r\n      </div>\r\n    </div>\r\n    <div class="input-wrapper">\r\n      <input type="checkbox" id="resources" disabled />\r\n      <label for="resources">Resources manager (in progress)</label>\r\n    </div>\r\n    <div class="input-wrapper">\r\n      <input type="checkbox" id="guard" disabled />\r\n      <label for="guard">Guard (in progress)</label>\r\n    </div>\r\n\r\n    <div id="button-panel">\r\n      <button id="submit">Submit</button>\r\n      <button type="reset" id="cancel-all">Cancel all</button>\r\n    </div>\r\n  </div>\r\n  <div class="show-trigger">\r\n    GPS\r\n  </div>\r\n</div>'},773:(e,t)=>{var n;Object.defineProperty(t,"__esModule",{value:!0}),t.FarmTimeInterval=void 0,function(e){e[e.FiveMinutes=3e5]="FiveMinutes",e[e.TenMinutes=6e5]="TenMinutes",e[e.TwentyMinutes=12e5]="TwentyMinutes",e[e.FortyMinutes=24e5]="FortyMinutes",e[e.OneHourAndHalf=54e5]="OneHourAndHalf",e[e.ThreeHours=108e5]="ThreeHours",e[e.FourHours=144e5]="FourHours",e[e.EightHours=288e5]="EightHours"}(n||(t.FarmTimeInterval=n={}));const r={resources:{minPopulationBuffer:100,storeAlmostFullPercentage:.9},farmConfig:{farmInterval:n.FiveMinutes},general:{antyTimingMs:3e3}};t.default=r},927:function(e,t,n){var r=this&&this.__awaiter||function(e,t,n,r){return new(n||(n=Promise))((function(i,o){function s(e){try{c(r.next(e))}catch(e){o(e)}}function a(e){try{c(r.throw(e))}catch(e){o(e)}}function c(e){var t;e.done?i(e.value):(t=e.value,t instanceof n?t:new n((function(e){e(t)}))).then(s,a)}c((r=r.apply(e,t||[])).next())}))},i=this&&this.__importDefault||function(e){return e&&e.__esModule?e:{default:e}};Object.defineProperty(t,"__esModule",{value:!0});const o=i(n(299));(0,n(15).onPageLoad)((()=>r(void 0,void 0,void 0,(function*(){console.log("VERY POLITE GPS v.0.5.0 MVP walikonie special edition (c) 2024"),yield o.default.getInstance()}))))},2:function(e,t,n){var r=this&&this.__awaiter||function(e,t,n,r){return new(n||(n=Promise))((function(i,o){function s(e){try{c(r.next(e))}catch(e){o(e)}}function a(e){try{c(r.throw(e))}catch(e){o(e)}}function c(e){var t;e.done?i(e.value):(t=e.value,t instanceof n?t:new n((function(e){e(t)}))).then(s,a)}c((r=r.apply(e,t||[])).next())}))};Object.defineProperty(t,"__esModule",{value:!0});const i=n(15);class o{constructor(){this.RUN=!1,this.cityList=[]}static getInstance(){return r(this,void 0,void 0,(function*(){return o.instance||(o.instance=new o,o.instance.cityList=yield o.instance.initCityList()),o.instance}))}initCityList(){return r(this,void 0,void 0,(function*(){(yield(0,i.waitForElement)(".caption.js-viewport")).click();const e=(yield(0,i.waitForElement)(".group_towns")).querySelectorAll("span.town_name"),t=Array.from(e).map((e=>({name:e.textContent||"unresolved",switchAction:()=>r(this,void 0,void 0,(function*(){try{let t=yield(0,i.waitForElement)(".group_towns",500).catch((()=>null));t||(yield(0,i.waitForElement)(".caption.js-viewport")).click(),t=yield(0,i.waitForElement)(".group_towns",3e3),Array.from(t.querySelectorAll("span.town_name")).find((t=>t.textContent===e.textContent)).click()}catch(e){console.warn("switchAction.catch:",e)}}))})));return console.log("CitySwitchManager.cityList.initialized:",t),t}))}getCurrentCity(){var e,t;const n=null!==(t=null===(e=document.querySelector("div.town_name"))||void 0===e?void 0:e.textContent)&&void 0!==t?t:"";return console.log("getCurrentCity.name:",n),this.getCityByName(n)}getCityByName(e){return console.log("getCityByName:",this.cityList.find((t=>t.name===e))),this.cityList.find((t=>t.name===e))}getCityList(){return this.cityList}isRunning(){return this.RUN}run(){this.RUN=!0}stop(){this.RUN=!1}}t.default=o},543:function(e,t,n){var r=this&&this.__awaiter||function(e,t,n,r){return new(n||(n=Promise))((function(i,o){function s(e){try{c(r.next(e))}catch(e){o(e)}}function a(e){try{c(r.throw(e))}catch(e){o(e)}}function c(e){var t;e.done?i(e.value):(t=e.value,t instanceof n?t:new n((function(e){e(t)}))).then(s,a)}c((r=r.apply(e,t||[])).next())}))},i=this&&this.__importDefault||function(e){return e&&e.__esModule?e:{default:e}};Object.defineProperty(t,"__esModule",{value:!0});const o=i(n(7)),s=n(773),a=i(n(639)),c=n(910),l=i(n(785)),u=n(15);class d extends o.default{constructor(){super(),this.scheduler=null,this.scheduledDate=null,this.messageDialogObserver=null,this.RUN=!1,this.scheduleNextFarmingOperation=e=>{console.log("Schedule next farming operation at:",(0,c.getTimeInFuture)(e)),this.scheduledDate=new Date(Date.now()+e),this.scheduler=setTimeout((()=>{this.scheduler=null,this.farmVillages()}),e)},this.mountMessageDailogObserver=()=>r(this,void 0,void 0,(function*(){const e=new MutationObserver((e=>r(this,void 0,void 0,(function*(){for(const t of e)if("childList"===t.type)for(const e of t.addedNodes)if(e instanceof HTMLElement&&"window_curtain ui-front show_curtain is_modal_window"===e.getAttribute("class"))return yield(0,c.addDelay)(100),void e.querySelector(".btn_confirm.button_new").click()}))));e.observe(document.body,{childList:!0}),this.messageDialogObserver=e}))}static getInstance(){return d.instance||(d.instance=new d,d.instance.configManager=a.default.getInstance(),d.instance.config=d.instance.configManager.getConfig().farmConfig,d.instance.lock=l.default.getInstance()),d.instance}start(){return r(this,void 0,void 0,(function*(){console.log("FarmManager started"),this.RUN=!0,yield this.farmVillages()}))}farmVillages(){return r(this,void 0,void 0,(function*(){var e;try{this.lock.acquire(),yield(0,u.waitForElement)('[name="island_view"]').then((e=>null==e?void 0:e.click())),yield(0,c.addDelay)(333);const e=yield(0,u.waitForElements)('a.owned.farm_town[data-same_island="true"]');if(e.length,!e||0===e.length)return;const t=Array.from(e).map((e=>`[style="${e.getAttribute("style")}"]`));yield(0,u.performComplexClick)(e[0]);const n=yield this.getUnlockTimeOrNull(yield(0,u.waitForElement)(".farm_towns"));if(n)return yield(0,u.waitForElement)(".btn_wnd.close",1e3).then((e=>e.click())).catch((()=>{})),void this.scheduleNextFarmingOperation(n);this.mountMessageDailogObserver();for(const e of t){let t=null,n=null;do{t=yield(0,u.waitForElement)(e),yield(0,u.performComplexClick)(t),yield(0,c.addDelay)(100)}while(!(n=yield(0,u.waitForElements)(".action_card.resources_bpv .card_click_area",500).catch((()=>null))));n[this.getFarmOptionIndex(n.length)].click();const r=yield(0,u.waitForElement)(".btn_wnd.close",1e3).catch((()=>{}));null==r||r.click(),yield(0,c.addDelay)(100)}this.scheduleNextFarmingOperation(this.config.farmInterval)}catch(e){console.warn("FarmManager.farmVillages().catch",e)}finally{this.lock.release(),null===(e=this.messageDialogObserver)||void 0===e||e.disconnect(),this.emit("farmingFinished")}}))}getUnlockTimeOrNull(e){return r(this,void 0,void 0,(function*(){const t=yield(0,u.waitForElementFromNode)(e,".actions_locked_banner.cooldown",500).catch((()=>null));if(t){const e=t.querySelector(".pb_bpv_unlock_time");return new Promise(((t,n)=>{const r=setInterval((()=>{(null==e?void 0:e.textContent)&&(clearInterval(r),t((0,c.textToMs)(e.textContent)))}),100)}))}return null}))}getFarmOptionIndex(e){if(4===e)switch(this.config.farmInterval){case s.FarmTimeInterval.FiveMinutes:return 0;case s.FarmTimeInterval.TwentyMinutes:return 1;case s.FarmTimeInterval.OneHourAndHalf:return 2;case s.FarmTimeInterval.FourHours:return 3;default:return 0}else switch(this.config.farmInterval){case s.FarmTimeInterval.FiveMinutes:return 0;case s.FarmTimeInterval.TenMinutes:return 4;case s.FarmTimeInterval.TwentyMinutes:return 1;case s.FarmTimeInterval.FortyMinutes:return 5;case s.FarmTimeInterval.OneHourAndHalf:return 2;case s.FarmTimeInterval.ThreeHours:return 6;case s.FarmTimeInterval.FourHours:return 3;case s.FarmTimeInterval.EightHours:return 7;default:return 0}}stop(){this.RUN=!1,console.log("FarmManager stopped"),this.scheduler&&(clearInterval(this.scheduler),this.scheduler=null)}isRunning(){return this.RUN}}t.default=d},299:function(e,t,n){var r=this&&this.__awaiter||function(e,t,n,r){return new(n||(n=Promise))((function(i,o){function s(e){try{c(r.next(e))}catch(e){o(e)}}function a(e){try{c(r.throw(e))}catch(e){o(e)}}function c(e){var t;e.done?i(e.value):(t=e.value,t instanceof n?t:new n((function(e){e(t)}))).then(s,a)}c((r=r.apply(e,t||[])).next())}))},i=this&&this.__importDefault||function(e){return e&&e.__esModule?e:{default:e}};Object.defineProperty(t,"__esModule",{value:!0});const o=i(n(278)),s=i(n(2)),a=i(n(543)),c=i(n(567));class l{constructor(){}static getInstance(){return r(this,void 0,void 0,(function*(){return l.instance||(l.instance=new l,l.instance.farmManager=a.default.getInstance(),l.instance.switchManager=yield s.default.getInstance(),l.instance.scheduler=yield c.default.getInstance(),l.instance.initConfigDialog()),l.instance}))}initConfigDialog(){return r(this,void 0,void 0,(function*(){this.configMenuWindow=new o.default,this.configMenuWindow.addListener("managersChange",(()=>r(this,void 0,void 0,(function*(){console.log("managersChange event triggered"),this.configMenuWindow.isSwitchChecked()?this.switchManager.isRunning()||(console.log("switchManager will be started..."),this.switchManager.run()):this.switchManager.isRunning()&&(console.log("switchManager will be stopped..."),this.switchManager.stop()),this.configMenuWindow.isFarmChecked()?this.farmManager.isRunning()||(console.log("FarmManager will be started..."),yield this.farmManager.start()):this.farmManager.isRunning()&&(console.log("FarmManager will be stopped..."),this.farmManager.stop())})))),this.configMenuWindow.render()}))}run(){this.farmManager.start()}stopAll(){this.farmManager.stop()}}t.default=l},567:function(e,t,n){var r=this&&this.__awaiter||function(e,t,n,r){return new(n||(n=Promise))((function(i,o){function s(e){try{c(r.next(e))}catch(e){o(e)}}function a(e){try{c(r.throw(e))}catch(e){o(e)}}function c(e){var t;e.done?i(e.value):(t=e.value,t instanceof n?t:new n((function(e){e(t)}))).then(s,a)}c((r=r.apply(e,t||[])).next())}))},i=this&&this.__importDefault||function(e){return e&&e.__esModule?e:{default:e}};Object.defineProperty(t,"__esModule",{value:!0});const o=i(n(2)),s=i(n(299)),a=i(n(813)),c=n(910),l=n(15),u=i(n(639));var d;!function(e){e[e.ARMY_ATTACK=0]="ARMY_ATTACK",e[e.ARMY_SUPPORT=1]="ARMY_SUPPORT",e[e.ARMY_WITHDRAW=2]="ARMY_WITHDRAW",e[e.RESOURCE_SHIPMENT=3]="RESOURCE_SHIPMENT"}(d||(d={}));class f{constructor(){this.schedule=[]}privateconstructor(){}static getInstance(){return r(this,void 0,void 0,(function*(){return f.instance||(f.instance=new f,f.instance.masterManager=yield s.default.getInstance(),f.instance.citySwitchManager=yield o.default.getInstance(),f.instance.config=u.default.getInstance().getConfig(),f.instance.addUIExtenstion()),f.instance}))}addUIExtenstion(){return r(this,void 0,void 0,(function*(){yield this.mountCityDialogObserver()}))}extendAttackSupportUI(e){return r(this,void 0,void 0,(function*(){const t=e.querySelector(".button_wrapper"),n=document.createElement("div");n.innerHTML=a.default,t.appendChild(n);const i=document.querySelector("#schedule-date");i.value=this.getFormattedInputValueFromDate(new Date),n.querySelector("#schedule-button").addEventListener("click",(()=>r(this,void 0,void 0,(function*(){const t=e.querySelector(".way_duration").textContent.slice(1),n=(0,c.textToMs)(t),r=Array.from(e.querySelectorAll(".unit_input")).map((e=>({name:e.getAttribute("name"),value:e.value}))),o="attack"===e.firstElementChild.getAttribute("data-type")?d.ARMY_ATTACK:d.ARMY_SUPPORT,s=i.value,a=document.querySelector("#schedule-time").value,u=this.getDateFromDateTimeInputValues(s,a),f=this.citySwitchManager.getCurrentCity();if(!f)throw new Error("Source city not found");const h=document.querySelector("#town_info-info");null==h||h.click();const p=yield(0,l.waitForElement)(".sea_coords",2e3).then((e=>e.parentElement)),m=null==p?void 0:p.textContent.match(/\(\d{3},\d{3}\)/)[0].slice(1,-1).split(",").map(Number);u.getTime(),(new Date).getTime(),console.log("parsed info:"),console.log("inputData:",r),console.log("wayDuration",n),console.log("operationType",o===d.ARMY_ATTACK?"attack":"support"),console.log("destinationCityGrid",m),console.log("sourceCity",f),console.log("targetDate",u)}))))}))}getDateFromDateTimeInputValues(e,t){const n=t.match(/(\d{2})\D*(\d{2})\D*(\d{2})/);if(!n||!e.match(/^\d{4}-\d{2}-\d{2}$/))throw new Error("Invalid time format");const[,r,i,o]=n;return new Date(`${e}T${r}:${i}:${o}`)}getFormattedInputValueFromDate(e){return`${e.getFullYear()}-${String(e.getMonth()+1).padStart(2,"0")}-${String(e.getDate()).padStart(2,"0")}`}mountAttackSupportSubpageObserver(e){console.log("Scheduler.mountAttackSupportSubpageObserver");const t=new MutationObserver((e=>{for(const t of e)if("childList"===t.type)for(const e of t.addedNodes)if(e.nodeType===Node.ELEMENT_NODE&&e.classList.contains("attack_support_window"))return console.log("Scheduler.mountAttackSupportSubpageObserver: found attack/support subpage"),void this.extendAttackSupportUI(e)}));return t.observe(e,{childList:!0,subtree:!0}),()=>t.disconnect()}mountCityDialogObserver(){return r(this,void 0,void 0,(function*(){console.log("Scheduler.mountCityDialogObserver");let e=null;new MutationObserver((t=>{for(const n of t)if("childList"===n.type){for(const t of n.addedNodes)if(t.nodeType===Node.ELEMENT_NODE&&"ui-dialog ui-corner-all ui-widget ui-widget-content ui-front ui-draggable ui-resizable js-window-main-container"===t.getAttribute("class"))return console.log("Scheduler.mountCityDialogObserver: found dialog node"),void(e=this.mountAttackSupportSubpageObserver(t));for(const t of n.removedNodes)if(t.nodeType===Node.ELEMENT_NODE&&"dialog"===t.getAttribute("role")&&t.classList.contains("ui-dialog")&&t.classList.contains("js-window-main-container")&&e)return e(),void(e=null)}})).observe(document.body,{childList:!0})}))}}t.default=f},278:function(e,t,n){var r=this&&this.__importDefault||function(e){return e&&e.__esModule?e:{default:e}};Object.defineProperty(t,"__esModule",{value:!0});const i=r(n(604)),o=r(n(396)),s=r(n(7)),a=r(n(639)),c=n(773);class l extends s.default{constructor(){super(),this.isSwitchChecked=()=>this.switch,this.isFarmChecked=()=>this.farm,this.isResourcesChecked=()=>this.resources,this.isGuardChecked=()=>this.guard,this.getPlunderConfig=()=>{},this.getManagersFlags=()=>({farm:this.farm,resources:this.resources,guard:this.guard}),this.configManager=a.default.getInstance(),this.config=this.configManager.getConfig(),this.switch=!0,this.farm=!0,this.resources=!1,this.guard=!1,this.farmInterval=this.config.farmConfig.farmInterval}initEventListeners(){var e;const t=document.querySelector("#config-popup-container"),n=t.querySelector("#city-switch"),r=t.querySelector("#farm"),i=t.querySelector("#resources"),o=t.querySelector("#guard"),s=t.querySelector("#time-interval-select"),a=t.querySelector(".show-trigger"),c=t.querySelector("#close-popup");if(!t)throw new Error('"#config-popup-container" couldn\'t be found.');c.addEventListener("click",(()=>{t.classList.contains("minimized")||t.classList.add("minimized")})),t.querySelectorAll("#button-panel button").forEach((e=>e.addEventListener("click",(()=>{"reset"===e.type&&(n.checked=!1,this.switch=!1,r.checked=!1,this.farm=!1,i.checked=!1,this.resources=!1,o.checked=!1,this.guard=!1),this.config.farmConfig.farmInterval!==this.farmInterval&&(this.config.farmConfig.farmInterval=this.farmInterval,this.configManager.persistConfig()),t.classList.add("minimized"),this.emit("managersChange")})))),a.addEventListener("click",(()=>{t.classList.contains("minimized")&&t.classList.remove("minimized")})),n.addEventListener("change",(()=>{this.switch=n.checked})),r.addEventListener("change",(()=>{this.farm=r.checked})),i.addEventListener("change",(()=>{this.resources=i.checked})),o.addEventListener("change",(()=>{this.guard=o.checked})),s.addEventListener("change",(()=>{this.farmInterval=Number(s.value)}));const l=null===(e=t.querySelector("#farm"))||void 0===e?void 0:e.parentElement,u=l.querySelector(".expandable-section"),d=l.querySelector(".arrow-down");d.addEventListener("click",(()=>{u.classList.toggle("hidden"),d.classList.toggle("rotate")}))}createInitialElement(){const e=document.createElement("div");e.innerHTML=o.default,e.querySelector("#city-switch").checked=this.switch,e.querySelector("#farm").checked=this.farm,e.querySelector("#resources").checked=this.resources,e.querySelector("#guard").checked=this.guard;const t=e.querySelector("#time-interval-select"),n=Object.values(c.FarmTimeInterval);return n.slice(n.length/2,-1).forEach((e=>{const n=document.createElement("option");n.value=e.toString(),n.textContent=this.mapTimeIntervalKeyToText(e),t.appendChild(n)})),e.querySelector("#time-interval-select").value=c.FarmTimeInterval.FiveMinutes.toString(),e}mapTimeIntervalKeyToText(e){switch(e){case c.FarmTimeInterval.FiveMinutes:return"5m";case c.FarmTimeInterval.TenMinutes:return"10m";case c.FarmTimeInterval.TwentyMinutes:return"20m";case c.FarmTimeInterval.FortyMinutes:return"40m";case c.FarmTimeInterval.OneHourAndHalf:return"1h 30m";case c.FarmTimeInterval.ThreeHours:return"3h";case c.FarmTimeInterval.FourHours:return"4h";case c.FarmTimeInterval.EightHours:return"8h";default:return"Unknown interval"}}addStyle(){const e=document.createElement("style");e.textContent=i.default,document.head.appendChild(e)}render(){this.addStyle();const e=this.createInitialElement();document.body.appendChild(e),this.initEventListeners()}}t.default=l},639:function(e,t,n){var r=this&&this.__importDefault||function(e){return e&&e.__esModule?e:{default:e}};Object.defineProperty(t,"__esModule",{value:!0});const i=r(n(773)),o=r(n(16));class s{constructor(){}static getInstance(){return s.instance||(s.instance=new s,s.instance.storageManager=o.default.getInstance(),s.instance.config=s.instance.initConfig()),s.instance}initConfig(){return this.storageManager.readFromLocalStorage("config")||(this.storageManager.writeToLocalStorage("config",i.default),i.default)}getConfig(){return this.config}persistConfig(){this.storageManager.writeToLocalStorage("config",this.config)}getConfigValue(e){return this.config[e]}}t.default=s},910:(e,t)=>{Object.defineProperty(t,"__esModule",{value:!0}),t.cancelHover=t.triggerHover=t.areGridsEqual=t.getTimeInFuture=t.addDelay=t.isVisible=t.textToMs=void 0,t.getRandomInt=function(e){return Math.floor(Math.random()*e)},t.textToMs=e=>{const t=e.split(":").map((e=>parseInt(e))),n=1e3*t[0]*60*60+1e3*t[1]*60+1e3*t[2];return console.log("sparsowano czas:",n),n},t.isVisible=e=>e.offsetParent,t.addDelay=(e=1e3)=>new Promise((t=>setTimeout(t,e))),t.getTimeInFuture=e=>{const t=new Date,n=new Date(t.getTime()+e);return`${n.getHours()}:${n.getMinutes()}:${n.getSeconds()}`},t.areGridsEqual=(e,t)=>e[0]===t[0]&&e[1]===t[1],t.triggerHover=e=>{e.dispatchEvent(new Event("mouseover",{bubbles:!0,cancelable:!0}))},t.cancelHover=e=>{e.dispatchEvent(new Event("mouseout",{bubbles:!0,cancelable:!0}))}},16:(e,t)=>{Object.defineProperty(t,"__esModule",{value:!0});class n{constructor(){}static getInstance(){return n.instance||(n.instance=new n),n.instance}readFromLocalStorage(e){const t=localStorage.getItem(e);return t?JSON.parse(t):null}writeToLocalStorage(e,t){localStorage.setItem(e,JSON.stringify(t))}}t.default=n},785:function(e,t){var n=this&&this.__awaiter||function(e,t,n,r){return new(n||(n=Promise))((function(i,o){function s(e){try{c(r.next(e))}catch(e){o(e)}}function a(e){try{c(r.throw(e))}catch(e){o(e)}}function c(e){var t;e.done?i(e.value):(t=e.value,t instanceof n?t:new n((function(e){e(t)}))).then(s,a)}c((r=r.apply(e,t||[])).next())}))};Object.defineProperty(t,"__esModule",{value:!0});class r{constructor(){this.isLocked=!1,this.queue=[]}static getInstance(){return this.instance||(this.instance=new r),this.instance}acquire(){return n(this,void 0,void 0,(function*(){if(console.log("try acquiring"),!this.isLocked)return console.log("\tlock is free, acquire Lock"),void(this.isLocked=!0);console.log("\tlock is locked, add to queue"),yield new Promise((e=>{this.queue.push(e)}))}))}release(){if(console.log("release lock()"),this.queue.length>0){const e=this.queue.shift();e&&(console.log("- but next element in the queue takes it turn"),e())}else this.isLocked=!1,console.log("lock released ()")}}r.instance=null,t.default=r},15:function(e,t,n){var r=this&&this.__awaiter||function(e,t,n,r){return new(n||(n=Promise))((function(i,o){function s(e){try{c(r.next(e))}catch(e){o(e)}}function a(e){try{c(r.throw(e))}catch(e){o(e)}}function c(e){var t;e.done?i(e.value):(t=e.value,t instanceof n?t:new n((function(e){e(t)}))).then(s,a)}c((r=r.apply(e,t||[])).next())}))};Object.defineProperty(t,"__esModule",{value:!0}),t.simulateClick=function(e){if(e){const t=e.getBoundingClientRect(),n=new MouseEvent("click",{clientX:t.left+t.width/2,clientY:t.top+t.height/2,bubbles:!0,cancelable:!0,view:window});e.dispatchEvent(n)}},t.setInputValue=function(e,t){if(e&&"INPUT"===e.tagName){e.value="number"==typeof t?t.toString():t;const n=new Event("input",{bubbles:!0});e.dispatchEvent(n);const r=new Event("change",{bubbles:!0});e.dispatchEvent(r)}else console.warn(`setInputValue(${e.name}) unsuccessful`)},t.waitForElements=function(e,t=8e3){return new Promise(((n,r)=>{const i=document.querySelectorAll(e);if(i.length>0)n(i);else{let i=setTimeout((()=>{o.disconnect(),r(`waitForElements(${e}) - not found within timeout`)}),t);const o=new MutationObserver((()=>{const t=document.querySelectorAll(e);t.length>0&&(o.disconnect(),clearTimeout(i),n(t))}));o.observe(document.body,{childList:!0,subtree:!0})}}))},t.waitForElement=function(e,t=8e3){return new Promise(((n,r)=>{const i=document.querySelector(e);if(i)return n(i);{const i=setTimeout((()=>{o.disconnect(),r(`${e} - not found within timeout`)}),t),o=new MutationObserver((()=>{const t=document.querySelector(e);t&&(o.disconnect(),clearTimeout(i),n(t))}));o.observe(document.body,{childList:!0,subtree:!0})}}))},t.waitForElementFromNode=function(e,t,n=8e3){return new Promise(((r,i)=>{const o=e.querySelector(t);if(o)return r(o);{const o=setTimeout((()=>{s.disconnect(),i(`${t} - not found within timeout`)}),n),s=new MutationObserver((()=>{const n=e.querySelector(t);n&&(s.disconnect(),clearTimeout(o),r(n))}));s.observe(e instanceof Document?e.body:e,{childList:!0,subtree:!0})}}))},t.onPageLoad=function(e){const t=()=>{const t=setTimeout((()=>{clearTimeout(t),setTimeout(e,2e3)}),500)};"loading"===document.readyState?document.addEventListener("DOMContentLoaded",t):t()},t.mouseDownEvent=o,t.performComplexClick=function(e){return r(this,void 0,void 0,(function*(){o(e),yield(0,i.addDelay)(100),s(e)}))},t.mouseUpEvent=s;const i=n(910);function o(e){const t=new MouseEvent("mousedown",{bubbles:!0,cancelable:!0,view:window});e&&e.dispatchEvent(t)}function s(e){const t=new MouseEvent("mouseup",{bubbles:!0,cancelable:!0,view:window});e?e.dispatchEvent(t):console.warn(`mouseUpEvent() - ${e} not found`)}}},t={};function n(r){var i=t[r];if(void 0!==i)return i.exports;var o=t[r]={exports:{}};return e[r].call(o.exports,o,o.exports,n),o.exports}n.d=(e,t)=>{for(var r in t)n.o(t,r)&&!n.o(e,r)&&Object.defineProperty(e,r,{enumerable:!0,get:t[r]})},n.o=(e,t)=>Object.prototype.hasOwnProperty.call(e,t),n.r=e=>{"undefined"!=typeof Symbol&&Symbol.toStringTag&&Object.defineProperty(e,Symbol.toStringTag,{value:"Module"}),Object.defineProperty(e,"__esModule",{value:!0})},n(927)})();
//# sourceMappingURL=bundle.js.map