import { parseHours } from "./parse.ts";

Deno.test("JST hourly cells preserve zero, skip missing data and roll 24:00 into the new year", () => {
  const row = (name: string, cell: (hour: number) => string) =>
    '<tr class="' + name + '">' + Array.from({length: 24}, (_, i) => '<td>' + cell(i+1) + '</td>').join('') + '</tr>';
  const body = '<th class="day-box">2026年12月31日</th>' +
    row("hour", String) + row("temperature", h => h === 3 ? "---" : String(2-h)) +
    row("weather", () => '<img alt="晴れ">');
  const times = parseHours('<table id="forecast-point-1h-today">' + body + '</table>' +
    '<table id="forecast-point-3h-today">' + body.replace("31日","30日") + '</table>');
  if (Object.keys(times).length !== 23 || times["2026-12-31T03:00"]) throw Error("Unexpected hours");
  if (times["2026-12-31T02:00"]?.[0] !== 0) throw Error("Zero temperature lost");
  if (JSON.stringify(times["2027-01-01T00:00"]) !== JSON.stringify([-22,"晴"])) throw Error("Incorrect midnight");
});
