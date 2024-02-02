export function addRow(key: string, value?: any) {
  if (value !== undefined) {
    return /*html*/ `<tr>
      <td><vscode-label>${key}:</vscode-label></td>
      <td>${value}</td>
    </tr>`;
  }
  else {
    return /*html*/ `<tr>
      <td colspan="2"><h3><u>${key}</u></h3></td>
    </tr>`;
  }
}

export function capitalize(text: string) {
  return text[0].toUpperCase() + text.substring(1);
}