const { JHubFS } = require('./fileSystemProvider');
const { TerminalViewProvider } = require('./terminalViewProvider');

const vscode = require('vscode');

function activate(context) {
	const FS = new JHubFS();
    let initialized = false;

	context.subscriptions.push(vscode.workspace.registerFileSystemProvider('jhubfs', FS, { isCaseSensitive: true }));

	context.subscriptions.push(vscode.commands.registerCommand('jhubcode.init', async () => {
        if (initialized) {
            return;
        }

		if (!FS.token) {
			FS.token = await vscode.window.showInputBox({ prompt: 'Api Token' });
		}

		if (!FS.username) {
			FS.username = await vscode.window.showInputBox({ prompt: 'Username' });
		}
		console.log('init')
		try {
			initialized = await FS.init();
		} catch (e) {
			console.log('error');

			console.log(e);
		}

		if (initialized) {
            vscode.workspace.updateWorkspaceFolders(0, 0, { uri: vscode.Uri.parse('jhubfs:/'), name: "Jupyterlab" });

			FS.loadFiles();

			context.subscriptions.push(vscode.commands.registerCommand('jhubcode.load', async () => {
				if (initialized) {
					FS.loadFiles();
				}
			}));
		
			const reloadIcon = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
			reloadIcon.command = 'jhubcode.load';
			context.subscriptions.push(reloadIcon);
			reloadIcon.text = 'reload jupyterlab files'
			reloadIcon.show();
		}
    }));

	context.subscriptions.push(
		vscode.commands.registerCommand('jhubcode.terminalStart', () => {
			if (initialized) {
				new TerminalViewProvider(context.extensionUri, FS);
			} else {
				vscode.window.showInformationMessage('Error: JHubCode not initialized');
			}
		})
	);
}

function deactivate() {}

module.exports = {
	activate,
	deactivate
}
