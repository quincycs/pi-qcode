const vscode = require('vscode');

function activate(context) {
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('qcode.hello', {
      resolveWebviewView(view) {
        view.webview.html = '<!doctype html><html><body>hello world</body></html>';
      }
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
