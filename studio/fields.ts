import { element } from "#studio/model.ts";

interface FieldInput {
  name: string;
  label: string;
  value: string;
  multiline?: boolean;
  type?: string;
}

interface SelectOption {
  id: string;
  label: string;
}

interface SubmitInput {
  label: string;
}

interface SelectInput {
  name: string;
  label: string;
  value: string;
  options: SelectOption[];
}

export function field({
  name,
  label,
  value,
  multiline = false,
  type = "text",
}: FieldInput): HTMLElement {
  const wrapper = element({ tag: "label", className: "field" });
  const input = document.createElement(multiline ? "textarea" : "input");

  wrapper.append(element({ tag: "span", text: label }));
  input.name = name;
  input.value = value;

  if (input instanceof HTMLInputElement) input.type = type;

  if (input instanceof HTMLTextAreaElement)
    input.rows = name === "state" ? 12 : 4;

  wrapper.append(input);

  return wrapper;
}

export function selectField({
  name,
  label,
  value,
  options,
}: SelectInput): HTMLElement {
  const wrapper = element({ tag: "label", className: "field" });
  const input = document.createElement("select");

  wrapper.append(element({ tag: "span", text: label }));
  input.name = name;

  for (const option of options) input.add(new Option(option.label, option.id));

  input.value = value;
  wrapper.append(input);

  return wrapper;
}

export function submitButton({ label }: SubmitInput): HTMLButtonElement {
  const button = document.createElement("button");

  button.type = "submit";
  button.className = "primary-button apply-button";
  button.textContent = label;

  return button;
}
