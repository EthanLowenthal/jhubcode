const vscode = require('vscode');
var https = require('https');
var WebSocketClient = require('websocket').client;

class TerminalViewProvider {
	constructor(extensionUri, FS) {
		const column = vscode.window.activeTextEditor
			? vscode.window.activeTextEditor.viewColumn
			: undefined;

		this._panel = vscode.window.createWebviewPanel(
			TerminalViewProvider.viewType,
			'JupyterLab Terminal',
			column || vscode.ViewColumn.One,
			getWebviewOptions(extensionUri),
		);

		this._extensionUri = extensionUri;
		this._FS = FS;
		this.connected = false;
		this.termID;

		this._update();

		this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

		this._panel.onDidChangeViewState(
			e => {
				if (this._panel.visible) {
					this._update();
				}
			},
			null,
			this._disposables
		);
	}

	doRefactor() {
		this._panel.webview.postMessage({ command: 'refactor' });
	}

	dispose() {
		this._panel.dispose();
		var req = https.request({
			hostname: this._FS.url,
			port: 443,
			path: `/user/${this._FS.username}/api/terminals/${this.termID}?token=${this._FS.token}`,
			method: 'DELETE',
		  }, () => {})
		req.end();
	}

	_update() {
		const panel = this._panel;
		panel.title = 'Jupyterlab Terminal';
		if (panel.webview) {
			panel.webview.html = this._getHtmlForWebview(panel.webview);
			if (!this.connected) {
				this.connect();
			}
		}

	}

	connect() {
		const panel = this._panel;
		const FS = this._FS;

		var req = https.request({
			hostname: this._FS.url,
			port: 443,
			path: `/user/${FS.username}/api/terminals?token=${FS.token}`,
			method: 'POST',
		  }, (res) => {
			res.setEncoding('utf8');

			var body = '';

			res.on('data', (chunk) => {
				body = body + chunk;
			});

			res.on('end', () => {
				if (res.statusCode == 200) {
					var client = new WebSocketClient();
	
					client.on('connectFailed', (error) => {
						panel.webview.postMessage(['stdin', 'Connect Error: ' + error.toString()]);
						this.connected = false;
					});
			
					client.on('connect', (connection) => {
						panel.webview.postMessage(['stdin', 'WebSocket Client Connected']);
						this.connected = true;
						connection.on('message', function(message) {
							if (message.type === 'utf8') {
								panel.webview.postMessage(JSON.parse(message.utf8Data));
							}
						});
		
						panel.webview.onDidReceiveMessage(
							message => {
									connection.sendUTF(JSON.stringify(message));
							},
							null,
							this._disposables
						);
	
						connection.on('error', (error)  => {
							panel.webview.postMessage(['stdin', "Connection Error: " + error.toString()]);
							this.connected = false;
						});
						connection.on('close', () => {
							panel.webview.postMessage(['stdin', 'echo-protocol Connection Closed']);
							this.connected = false;
						});
					});

					this.termID = JSON.parse(body).name;
			
					client.connect(`wss://jhub.csc.uvic.ca/user/${FS.username}/terminals/websocket/${this.termID}?token=${FS.token}`);
				}
			});
		});
		
		req.end();
	}

	_getHtmlForWebview(webview) {
		const scriptPathOnDisk = vscode.Uri.joinPath(this._extensionUri, 'src', 'terminal.js');
		const scriptUri = (scriptPathOnDisk).with({ 'scheme': 'vscode-resource' });

		const scriptXtermOnDisk = vscode.Uri.joinPath(this._extensionUri, 'node_modules', 'xterm', 'lib', 'xterm.js');
		const scriptXtermUri = (scriptXtermOnDisk).with({ 'scheme': 'vscode-resource' });

		const scriptXtermFitOnDisk = vscode.Uri.joinPath(this._extensionUri, 'node_modules', 'xterm-addon-fit', 'lib', 'xterm-addon-fit.js');
		const scriptXtermFitUri = (scriptXtermFitOnDisk).with({ 'scheme': 'vscode-resource' });

		const stylesPathXterm = vscode.Uri.joinPath(this._extensionUri, 'node_modules', 'xterm', 'css', 'xterm.css');
		const stylesXtermUri = webview.asWebviewUri(stylesPathXterm);

		const nonce = getNonce();

		return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<!--
					Use a content security policy to only allow loading images from https or from our extension directory,
					and only allow scripts that have a specific nonce.
				-->
				<title>Jupyterlab Terminal</title>
				<link href="${stylesXtermUri}" rel="stylesheet">
				<script nonce="${nonce}" src="${scriptXtermUri}"></script>
				<script nonce="${nonce}" src="${scriptXtermFitUri}"></script>
			</head>
			<body>
				<div id="terminal" style="width: 100vw; height: 100vh;"></div>
			</body>
			<script id="helper" nonce="${nonce}" src="${scriptUri}"></script>
			</html>`;
	}
}

function getNonce() {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

function getWebviewOptions(extensionUri) {
	return {
		enableScripts: true,
		localResourceRoots: [
			vscode.Uri.joinPath(extensionUri, 'src'),
			vscode.Uri.joinPath(extensionUri, 'node_modules', 'xterm', 'lib'),
			vscode.Uri.joinPath(extensionUri, 'node_modules', 'xterm', 'css'),
			vscode.Uri.joinPath(extensionUri, 'node_modules', 'xterm-addon-fit', 'lib')
		]
	};
}

module.exports = {
	TerminalViewProvider,
	getWebviewOptions
}