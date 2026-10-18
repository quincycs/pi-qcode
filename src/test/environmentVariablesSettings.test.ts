import * as assert from "node:assert/strict";
import { test } from "node:test";
import * as vm from "node:vm";
import { readQcodeSettings } from "../qcodeSettings";
import { renderSettings } from "../webviews/settings";
import { renderSessionDetail } from "../webviews/sessionDetail";

test("default Pi selection does not select the first provider, and selection survives submit", () => {
  const html = renderSessionDetail("", "nonce", { title: "New Session", messages: [] });
  const script = html.slice(html.indexOf("    let selectedDraftProvider;"), html.indexOf("    const initialInput ="));
  let select: { value: string } | undefined = { value: "" };
  const context = vm.createContext({
    form: { dataset: {} },
    providerOptions: [{ nickname: "Work", cliArgs: "--model example/model", environmentVariables: "Work" }],
    document: { getElementById: () => select },
  });
  vm.runInContext(script, context);
  assert.equal(vm.runInContext("getSelectedProviderOption()", context), undefined);
  select.value = "0";
  assert.equal(vm.runInContext("getSelectedProviderOption().environmentVariables", context), "Work");
  select = undefined;
  assert.equal(vm.runInContext("getSelectedProviderOption().environmentVariables", context), "Work");
});

class Element {
  children: Element[] = [];
  textContent = "";
  value = "";
  dataset: Record<string, string> = {};
  ariaLabel = "";
  classList = { toggle() {} };
  listeners = new Map<string, () => void>();
  constructor(readonly tagName = "div") {}
  append(...elements: Element[]) { this.children.push(...elements); }
  replaceChildren() { this.children = []; }
  addEventListener(event: string, listener: () => void) { this.listeners.set(event, listener); }
  focus() {}
  querySelector() { return this.find((element) => element.tagName === "input"); }
  find(predicate: (element: Element) => boolean): Element | undefined {
    if (predicate(this)) return this;
    for (const child of this.children) {
      const found = child.find(predicate);
      if (found) return found;
    }
    return undefined;
  }
  click() { this.listeners.get("click")?.(); }
  change(value: string, event = "input") {
    this.value = value;
    this.listeners.get(event)?.();
  }
}

test("environment settings support pencil editing, provider selection, rename, cancel and deletion", () => {
  const settings = {
    ...readQcodeSettings("/nonexistent/qcode-test-settings.json"),
    providerOptions: [{ nickname: "Work", cliArgs: "--model example/model" }],
  };
  const html = renderSettings("nonce", settings, "settings.json", "chime.wav");
  assert.ok(html.indexOf('id="provider-options-title"') < html.indexOf('id="environment-variables-title"'));
  assert.ok(html.indexOf('id="environment-variables-title"') < html.indexOf('id="command-options-title"'));
  const nodes = new Map<string, Element>();
  const get = (id: string) => {
    if (!nodes.has(id)) nodes.set(id, new Element());
    return nodes.get(id)!;
  };
  const posted: { command: string; settings?: typeof settings; index?: number }[] = [];
  let receive: (event: { data: unknown }) => void = () => {};
  const script = /<script nonce="nonce">([\s\S]*?)<\/script>/.exec(html)![1];
  vm.runInNewContext(script, {
    document: {
      getElementById: (id: string) => id === "whats-new-overlay" ? null : get(id),
      createElement: (tag: string) => new Element(tag),
    },
    window: { addEventListener: (_event: string, listener: typeof receive) => { receive = listener; } },
    acquireVsCodeApi: () => ({ postMessage: (message: typeof posted[number]) => posted.push(message) }),
    confirm: () => true,
  });
  const environment = get("environment-variables");
  const provider = get("provider-options");
  const button = (container: Element, text: string) => container.find((element) => element.tagName === "button" && element.textContent === text)!;
  const input = (container: Element, label: string) => container.find((element) => element.ariaLabel === label)!;
  const acknowledge = () => {
    const message = posted.at(-1)!;
    assert.equal(message.command, "saveSettings");
    receive({ data: { command: "settingsSaved", settings: message.settings } });
    return JSON.parse(JSON.stringify(message.settings)) as typeof settings;
  };

  get("add-environment-button").click();
  input(environment, "Environment variables title").change("Local");
  input(environment, "Environment variables .env file path").change("~/work/.env");
  button(environment, "Save").click();
  assert.deepEqual(acknowledge().environmentVariables, [{ title: "Local", value: "~/work/.env" }]);
  assert.ok(button(environment, "✎"));

  button(provider, "✎").click();
  const select = input(provider, "Environment variables file");
  assert.deepEqual(select.children.map((child) => child.value), ["", "Local"]);
  select.change("Local", "change");
  button(provider, "Save").click();
  assert.equal((acknowledge().providerOptions[0] as { environmentVariables?: string }).environmentVariables, "Local");

  button(environment, "✎").click();
  input(environment, "Environment variables title").change("Renamed");
  button(environment, "Save").click();
  assert.equal((acknowledge().providerOptions[0] as { environmentVariables?: string }).environmentVariables, "Renamed");

  get("add-environment-button").click();
  input(environment, "Environment variables title").change("Renamed");
  input(environment, "Environment variables .env file path").change("other.env");
  const before = posted.length;
  button(environment, "Save").click();
  assert.equal(posted.length, before);
  assert.equal(get("status").textContent, "Environment variables titles must be unique.");
  button(environment, "Cancel").click();
  assert.equal(environment.children.length, 1);

  button(environment, "✎").click();
  button(environment, "Delete").click();
  assert.equal(posted.at(-1)?.command, "confirmDeleteEnvironmentOption");
  receive({ data: { command: "deleteEnvironmentOptionConfirmed", index: 0 } });
  const deleted = acknowledge();
  assert.deepEqual(deleted.environmentVariables, []);
  assert.equal((deleted.providerOptions[0] as { environmentVariables?: string }).environmentVariables, "");
});
