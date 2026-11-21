// Fixture for the clipboard rule (AST-14): the window never touches the clipboard.
export const copy = (text: string) => navigator.clipboard.writeText(text);
