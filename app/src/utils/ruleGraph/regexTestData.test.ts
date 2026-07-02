import { describe, expect, it } from "vitest";
import type { RuleGraph } from "../../types/ruleGraph";
import g01 from "../../../../regex-test-data/01-default-non-empty-line.json";
import g02 from "../../../../regex-test-data/02-numbered-list.json";
import g03 from "../../../../regex-test-data/03-playlist-split.json";
import g04 from "../../../../regex-test-data/04-playlist-sequence.json";
import g05 from "../../../../regex-test-data/05-email-regex.json";
import g06 from "../../../../regex-test-data/06-phone-cn-regex.json";
import g07 from "../../../../regex-test-data/07-url-regex.json";
import g08 from "../../../../regex-test-data/08-id-card-regex.json";
import g09 from "../../../../regex-test-data/09-email-or-url-line.json";
import { compileGraphPredicate } from "./compileGraph";
import { compileToPython } from "./compileToPython";

const allGraphs: Array<[string, RuleGraph]> = [
  ["01-default-non-empty-line.json", g01 as RuleGraph],
  ["02-numbered-list.json", g02 as RuleGraph],
  ["03-playlist-split.json", g03 as RuleGraph],
  ["04-playlist-sequence.json", g04 as RuleGraph],
  ["05-email-regex.json", g05 as RuleGraph],
  ["06-phone-cn-regex.json", g06 as RuleGraph],
  ["07-url-regex.json", g07 as RuleGraph],
  ["08-id-card-regex.json", g08 as RuleGraph],
  ["09-email-or-url-line.json", g09 as RuleGraph],
];

function pythonFlagsToJs(flags: ("IGNORECASE" | "MULTILINE" | "DOTALL")[]): string {
  let out = "";
  if (flags.includes("IGNORECASE")) out += "i";
  if (flags.includes("MULTILINE")) out += "m";
  if (flags.includes("DOTALL")) out += "s";
  return out;
}

function assertPredicateMatchesRegex(graph: RuleGraph, cases: Array<{ text: string; pass: boolean }>) {
  const result = compileToPython(graph);
  const predicate = compileGraphPredicate(graph);
  const re = new RegExp(result.pattern!, pythonFlagsToJs(result.flags));

  for (const { text, pass } of cases) {
    expect(predicate(text).pass, `谓词「${text.slice(0, 40)}」`).toBe(pass);
    expect(re.test(text), `正则「${text.slice(0, 40)}」`).toBe(pass);
  }
}

describe("regex-test-data 导出", () => {
  for (const [file, graph] of allGraphs) {
    it(`${file}：complete 且可粘贴`, () => {
      const result = compileToPython(graph);
      expect(result.error).toBeUndefined();
      expect(result.complete).toBe(true);
      expect(result.pattern).toBeTruthy();
      expect(result.code ?? result.snippet).toBeTruthy();
    });
  }

  it("01：每一行非空", () => {
    assertPredicateMatchesRegex(g01 as RuleGraph, [
      { text: "第一行有内容", pass: true },
      { text: "", pass: false },
      { text: "   ", pass: false },
    ]);
  });

  it("02：非空行以数字开头", () => {
    assertPredicateMatchesRegex(g02 as RuleGraph, [
      { text: "1. 第一项", pass: true },
      { text: "普通文字行", pass: false },
    ]);
  });

  it("03：歌单拆段", () => {
    assertPredicateMatchesRegex(g03 as RuleGraph, [
      { text: "周杰伦 - 晴天", pass: true },
      { text: "只有一段没有分隔符", pass: false },
      { text: "歌手 - 歌名 - 多了一段", pass: false },
    ]);
  });

  it("04：歌单段链", () => {
    assertPredicateMatchesRegex(g04 as RuleGraph, [
      { text: "周杰伦 - 晴天", pass: true },
      { text: "周杰伦 - Live 演唱会", pass: false },
      { text: "林俊杰 - 江南", pass: false },
    ]);
  });

  it("05：邮箱", () => {
    assertPredicateMatchesRegex(g05 as RuleGraph, [
      { text: "user@example.com", pass: true },
      { text: "zhang.san+tag@mail.co.uk", pass: true },
      { text: "not-an-email", pass: false },
      { text: "user@example", pass: false },
    ]);
  });

  it("06：手机号", () => {
    assertPredicateMatchesRegex(g06 as RuleGraph, [
      { text: "13812345678", pass: true },
      { text: "12812345678", pass: false },
    ]);
  });

  it("07：URL", () => {
    assertPredicateMatchesRegex(g07 as RuleGraph, [
      { text: "https://www.example.com/path?q=1", pass: true },
      { text: "www.example.com", pass: false },
    ]);
  });

  it("08：身份证", () => {
    assertPredicateMatchesRegex(g08 as RuleGraph, [
      { text: "110101199003071234", pass: true },
      { text: "44010619851212345X", pass: true },
      { text: "11010119900307123", pass: false },
      { text: "1101011990030712", pass: false },
    ]);
  });

  it("09：邮箱或 URL 行", () => {
    assertPredicateMatchesRegex(g09 as RuleGraph, [
      { text: "联系邮箱 user@example.com", pass: true },
      { text: "https://toolbox.example.com", pass: true },
      { text: "普通文本一行", pass: false },
      { text: "HTTP://UPPER.CASE.COM/ok", pass: true },
    ]);
  });
});
