(function() {
    const term = new Terminal();
    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(document.getElementById('terminal'));
    fitAddon.fit()

    const vscode = acquireVsCodeApi();

    term.onData((data) => {
        vscode.postMessage(['stdin', data]);
        console.log(data);
    });

    window.addEventListener('message', event => {
        switch (event.data[0]) {
            default:
            case 'stdin':
                term.write(event.data[1])
                break;
        }
    });

}())




