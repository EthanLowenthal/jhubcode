const path = require('path');
const vscode = require('vscode');
var https = require('https');

const output = vscode.window.createOutputChannel("JHub");

const prefix = 'jhubfs'

const sendRequest = ({options, data}) => {
    return new Promise((resolve, reject) => {
        var req = https.request(options, function (res) {
            res.setEncoding('utf8');

            var body = '';

            res.on('data', function (chunk) {
                body = body + chunk;
            });

            res.on('end',function(){
                if (res.statusCode == 200) {
                    resolve(JSON.parse(body));
                } else {
                    reject();
                }
            });

        });
        
        req.on('error', function (e) {
            output.appendLine(e);
            reject();
        });

        if (data) {
            req.write(JSON.stringify(data));
        }
        req.end();
    });

}
class File {
    constructor(name) {
        this.type = vscode.FileType.File;
        this.ctime = Date.now();
        this.mtime = Date.now();
        this.size = 0;
        this.mimetype = "";
        this.name = name;
    }
}

class Directory {
    constructor(name) {
        this.type = vscode.FileType.Directory;
        this.ctime = Date.now();
        this.mtime = Date.now();
        this.size = 0;
        this.name = name;
        this.entries = new Map();
    }
}

class JHubFS {
    constructor() {
        this.root = new Directory('')

        this.username;
        this.token;

        this._emitter = new vscode.EventEmitter();
        this._bufferedEvents = [];
        this._fireSoonHandle;
    
        this.onDidChangeFile = this._emitter.event;

    }
    async init() {
        try {
            const res = await sendRequest({
                options:  {
                    hostname: "jhub.csc.uvic.ca",
                    port: 443,
                    path: `/user/${this.username}/api/status?token=${this.token}`,
                    method: 'GET',
                }
            })

            if (res.started) {
                return true;
            } else {
                vscode.window.showInformationMessage('Error: Server not started');
                return false;
            }

        } catch (e) {
            vscode.window.showInformationMessage('Error: Server not started');
            return false
        }

    }
    parseDir(dir, top=false) {
        const uri = `${prefix}:/${dir.path}/`;
        if (dir.type != 'directory') {
            throw vscode.FileSystemError.FileNotADirectory(uri);
        }
        if (!top) {
            this.createDirectory(vscode.Uri.parse(uri));
        }
        dir.content.forEach(item => {
            if (item.type == 'file') {
                const fileUri = `${prefix}:/${item.path}`;
                this.createFileEntry(vscode.Uri.parse(fileUri), item, { create: true, overwrite: true });
            } else if (item.type == 'directory') {
                this.loadPath(item.path).then(data => this.parseDir(data));   
            }
        });
        this._fireSoon({ type: vscode.FileChangeType.Changed, uri });
    }
    loadPath(path) {
        return sendRequest({
            options:  {
                hostname: "jhub.csc.uvic.ca",
                port: 443,
                path: `/user/${this.username}/api/contents${path.startsWith('/')?'':'/'}${path}?token=${this.token}`,
                method: 'GET',
              }
        });
    }

    loadFiles() {
        this.root = new Directory('')
        output.appendLine('loading files')

        this.loadPath('').then(data => {
            output.appendLine('got data')
            this.parseDir(data, true);
        });   
    }

    // --- manage file metadata

    stat(uri) {
        return this._lookup(uri, false);
    }

    readDirectory(uri) {
        const entry = this._lookupAsDirectory(uri, false);
        const result = [];
        for (const [name, child] of entry.entries) {
            result.push([name, child.type]);
        }
        return result;
    }

    // --- manage file contents

    readFile(uri) {
        const entry = this._lookupAsFile(uri, false);
        if (entry) {
            if (entry.data) {
                return entry.data;
            } else {
                return new Promise((resolve, reject) => {
                    this.loadPath(uri.path).then(file => {
                        let content = Buffer.from('');
                        switch (file.format) {
                            default:
                            case 'text':
                                content = Buffer.from(file.content);
                                break;
                            case 'base64':
                                content = Buffer.from(file.content, 'base64');
                                break;
                        }
                        resolve(content);
                    }).catch(err => {
                        reject(err);
                    });
                });
            }
        }
        throw vscode.FileSystemError.FileNotFound();
    }

    createFileEntry(uri, file, options) {
        const { create, overwrite } = options;

        const basename = path.posix.basename(uri.path);
        const parent = this._lookupParentDirectory(uri);
        let entry = parent.entries.get(basename);
        if (entry instanceof Directory) {
            throw vscode.FileSystemError.FileIsADirectory(uri);
        }
        if (!entry && !create) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        if (entry && create && !overwrite) {
            throw vscode.FileSystemError.FileExists(uri);
        }
        if (!entry) {
            entry = new File(basename);
            parent.entries.set(basename, entry);
            this._fireSoon({ type: vscode.FileChangeType.Created, uri });
        }
        entry.ctime = Date.parse(file.created);
        entry.mtime = Date.parse(file.last_modified);
        entry.size = file.size;
        entry.data = undefined;

        this._fireSoon({ type: vscode.FileChangeType.Changed, uri });
    }

    writeFile(uri, content, options) {
        return sendRequest({
            options: {
                hostname: "jhub.csc.uvic.ca",
                port: 443,
                path: `/user/${this.username}/api/contents${uri.path}?token=${this.token}`,
                method: 'PUT',
            }, 
            data: {
                content: content.toString(),
                format: 'text',
                path:  uri.path.substring(1),
                type: 'file'
            }
        })
    }

    // --- manage files/folders

    rename(oldUri, newUri, options) {
        // TODO
        if (!options.overwrite && this._lookup(newUri, true)) {
            throw vscode.FileSystemError.FileExists(newUri);
        }

        sendRequest({
            options: {
                hostname: "jhub.csc.uvic.ca",
                port: 443,
                path: `/user/${this.username}/api/contents${oldUri.path}?token=${this.token}`,
                method: 'PATCH',
            }, data: {
                'path': newUri.path.substring(1)
            }
        }).then(() => {
            const entry = this._lookup(oldUri, false);
            const oldParent = this._lookupParentDirectory(oldUri);
    
            const newParent = this._lookupParentDirectory(newUri);
            const newName = path.posix.basename(newUri.path);
    
            oldParent.entries.delete(entry.name);
            entry.name = newName;
            newParent.entries.set(newName, entry);

            this._fireSoon(
                { type: vscode.FileChangeType.Deleted, uri: oldUri },
                { type: vscode.FileChangeType.Created, uri: newUri }
            );
        });
    }

    delete(uri) {
        const dirname = uri.with({ path: path.posix.dirname(uri.path) });
        const basename = path.posix.basename(uri.path);
        const parent = this._lookupAsDirectory(dirname, false);
        if (!parent.entries.has(basename)) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        sendRequest({
            options: {
                hostname: "jhub.csc.uvic.ca",
                port: 443,
                path: `/user/${this.username}/api/contents${uri.path}?token=${this.token}`,
                method: 'DELETE',
            }, 
        }).then(() => {
            this._fireSoon({ type: vscode.FileChangeType.Changed, uri: dirname }, { uri, type: vscode.FileChangeType.Deleted });
        });
    }

    createDirectory(uri) {
        const basename = path.posix.basename(uri.path);
        const dirname = uri.with({ path: path.posix.dirname(uri.path) });
        const parent = this._lookupAsDirectory(dirname, false);
        
        const entry = new Directory(basename);
        parent.entries.set(entry.name, entry);
        parent.mtime = Date.now();
        parent.size += 1;

        this._fireSoon({ type: vscode.FileChangeType.Changed, uri: dirname }, { uri, type: vscode.FileChangeType.Deleted });
        
    }

    // --- lookup

    _lookup(uri, silent){
        const parts = uri.path.split('/');
        let entry = this.root;
        for (const part of parts) {
            if (!part) {
                continue;
            }
            let child;
            if (entry instanceof Directory) {
                child = entry.entries.get(part);
            }
            if (!child) {
                if (!silent) {
                    throw vscode.FileSystemError.FileNotFound(uri);
                } else {
                    return undefined;
                }
            }
            entry = child;
        }
        return entry;
    }

    _lookupAsDirectory(uri, silent) {
        const entry = this._lookup(uri, silent);
        if (entry instanceof Directory) {
            return entry;
        }
        throw vscode.FileSystemError.FileNotADirectory(uri);
    }

    _lookupAsFile(uri, silent) {
        const entry = this._lookup(uri, silent);
        if (entry instanceof File) {
            return entry;
        }
        throw vscode.FileSystemError.FileIsADirectory(uri);
    }

    _lookupParentDirectory(uri) {
        console.log(uri)
        const dirname = uri.with({ path: path.posix.dirname(uri.path) });
        return this._lookupAsDirectory(dirname, false);
    }

    // --- manage file events
    watch(_resource) {
        // ignore, fires for all changes...
        return new vscode.Disposable(() => { });
    }

    _fireSoon(...events) {
        this._bufferedEvents.push(...events);

        if (this._fireSoonHandle) {
            clearTimeout(this._fireSoonHandle);
        }

        this._fireSoonHandle = setTimeout(() => {
            this._emitter.fire(this._bufferedEvents);
            this._bufferedEvents.length = 0;
        }, 5);
    }
}

module.exports = {
    JHubFS,
    File,
    Directory
}