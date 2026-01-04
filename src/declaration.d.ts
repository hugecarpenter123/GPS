declare module '*.css';
declare module '*.html';
declare module '*.css?raw' {
  const content: string;
  export default content;
}
declare module '*.html?raw' {
  const content: string;
  export default content;
}
declare function GM_setValue(name: string, value: any): void;
declare function GM_getValue(name: string, defaultValue?: any): any;
