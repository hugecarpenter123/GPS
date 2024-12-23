export default class Cliner {
  private static instance: Cliner;

  private constructor() { }

  public static getInstance(): Cliner {
    if (!Cliner.instance) {
      Cliner.instance = new Cliner();
    }
    return Cliner.instance;
  }
}
/*
podgląd
counter: .activity attack_indicator.count.js-caption textcontent
#toolbar_activity_attack_indicator click

wszystkie ataki:
  const attackElements = Array.from(document.querySelectorAll('#command_overview [data-command_type]')).filter(el => 
    el.getAttribute('data-command_type').startsWith('attack')
  );
  unikalny identyfikator: id="command_1259702"
  target city: document.querySelector('.cmd_span a:nth-child(4)').textContent
  soruce city: document.querySelector('.cmd_span a:nth-child(1)').click() potem #info .click()
  time-counter: .cmd_info_box .countdown.eta-command-1259562
  arrival time: .cmd_info_box .troops_arrive_at.eta-arrival-1259564 textcontent np. '(Czas przybycia dzisiaj o godzinie 12:59:29)'
  cancel: .cmd_info_box .game_arrow_delete

*/
