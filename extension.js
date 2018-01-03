"use strict";
// const {
//     html_beautify
// } = require('./js-beautify/beautify-html');
const vscode = require("vscode");
const { commands, workspace, window, languages, Range, Position } = vscode;
const fs = require("fs");
const os = require("os");
const cp = require("child_process");
const TmpDir = os.tmpdir();
let autoFixing = false;

class PHPCBF {
  constructor() {
    this.loadSettings();
  }

  loadSettings() {
    let config = workspace.getConfiguration("phpcbf");
    if (!config.get("enable") == true) {
      return;
    }
    this.onsave = config.get("onsave", true);

    this.executablePath = config.get(
      "executablePath",
      process.platform === "win32" ? "php-cbf.bat" : "phpcbf"
    );
    if (
      process.platform == "win32" &&
      config.has("executablePathWindows") &&
      config.get("executablePathWindows").length > 0
    ) {
      this.executablePath = config.get("executablePathWindows");
    }
    if (workspace.rootPath != undefined) {
      this.executablePath = this.executablePath.replace(
        "${workspaceRoot}",
        workspace.rootPath
      );
    }
    this.executablePath = this.executablePath.replace(
      /^~\//,
      os.homedir() + "/"
    );
    this.standard = config.get("standard", null);

    this.documentFormattingProvider = config.get(
      "documentFormattingProvider",
      true
	);
  }

  getArgs(fileName) {
    let args = ["-lq", fileName];
    if (this.standard) {
      args.push("--standard=" + this.standard);
    }
    return args;
  }

  format(text) {
    autoFixing = true;

    let fileName =
      TmpDir +
      "/temp-" +
      Math.random()
        .toString(36)
        .replace(/[^a-z]+/g, "")
        .substr(0, 10) +
      ".php";
    fs.writeFileSync(fileName, text);

    let exec = cp.spawn(this.executablePath, this.getArgs(fileName));

    let promise = new Promise((resolve, reject) => {
      exec.on("error", err => {
        reject();
        autoFixing = false;
        console.log(err);
        if (err.code == "ENOENT") {
          window.showErrorMessage(
            "PHPCBF: " + err.message + ". executablePath not found."
          );
        }
      });
      exec.on("exit", code => {
        /*  phpcbf exit codes:
				Exit code 0 is used to indicate that no fixable errors were found, so nothing was fixed
				Exit code 1 is used to indicate that all fixable errors were fixed correctly
				Exit code 2 is used to indicate that PHPCBF failed to fix some of the fixable errors it found
				Exit code 3 is used for general script execution errors
		*/
        switch (code) {
          case 0:
            break;
          case 1:
          case 2:
            let fixed = fs.readFileSync(fileName, "utf-8");
            if (fixed.length > 0) {
              resolve(fixed);
            } else {
              reject();
            }
            break;

          default:
            let msgs = {
              16: "PHPCBF: Configuration error of the application.",
              32: "PHPCBF: Configuration error of a Fixer.",
              64: "PHPCBF: Exception raised within the application."
            };
            window.showErrorMessage(msgs[code]);
            reject();
            break;
        }

        fs.unlink(fileName, function(err) {});
        autoFixing = false;
      });
    });

    exec.stdout.on("data", buffer => {
      // console.log(buffer.toString());
    });
    exec.stderr.on("data", buffer => {
      console.log(buffer.toString());
    });
    exec.on("close", code => {
      // console.log(code);
    });

    return promise;
  }
}

exports.activate = context => {
  let phpcbf = new PHPCBF();

  context.subscriptions.push(
    workspace.onWillSaveTextDocument(event => {
      if (
        event.document.languageId == "php" &&
        phpcbf.onsave /*&& workspace.getConfiguration('editor').get('formatOnSave') == false*/
      ) {
        event.waitUntil(
          commands.executeCommand("editor.action.formatDocument")
        );
      }
    })
  );

  context.subscriptions.push(
    commands.registerTextEditorCommand("phpcbf-soderlind", textEditor => {
      if (textEditor.document.languageId == "php") {
        commands.executeCommand("editor.action.formatDocument");
      }
    })
  );

  context.subscriptions.push(
    workspace.onDidChangeConfiguration(() => {
      phpcbf.loadSettings();
    })
  );

  if (phpcbf.documentFormattingProvider) {
    context.subscriptions.push(
      languages.registerDocumentFormattingEditProvider("php", {
        provideDocumentFormattingEdits: (document, options, token) => {
          autoFixing = false;
          return new Promise((resolve, reject) => {
            let originalText = document.getText();
            let lastLine = document.lineAt(document.lineCount - 1);
            let range = new Range(new Position(0, 0), lastLine.range.end);
            phpcbf
              .format(originalText)
              .then(text => {
                if (text != originalText) {
                  resolve([new vscode.TextEdit(range, text)]);
                } else {
                  reject();
                }
              })
              .catch(err => {
                console.log(err);
                reject();
              });
          });
        }
      })
    );
  }
};
