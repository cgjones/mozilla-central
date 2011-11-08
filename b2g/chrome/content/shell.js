/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is B2G.
 *
 * The Initial Developer of the Original Code is
 * Mozilla Foundation.
 * Portions created by the Initial Developer are Copyright (C) 2011
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

const Cc = Components.classes;
const Ci = Components.interfaces;
const CC = Components.Constructor;

// The default homescreen url to use if there is no B2G_HOMESCREEN
// environment variable or if it is empty.
const kDefaultHomeScreen = "/data/local/homescreen.html";
const kDefaultSystemHomeScreen = "/system/home/homescreen.html";

var LocalFile = CC("@mozilla.org/file/local;1", "nsILocalFile", "initWithPath");

var shell = {
  get home() {
    delete this.home;
    return this.home = document.getElementById("homescreen");
  },

  get homeSrc() {
    let homeSrc = Cc["@mozilla.org/process/environment;1"]
                    .getService(Ci.nsIEnvironment)
                    .get("B2G_HOMESCREEN");
    if (homeSrc)
      return homeSrc;

    let file = new LocalFile(kDefaultHomeScreen);
    if (file.exists())
      return "file://" + kDefaultHomeScreen;

    return "file://" + kDefaultSystemHomeScreen;
  },

  start: function shell_init() {
    window.controllers.appendController(this);

    let ioService = Cc["@mozilla.org/network/io-service;1"]
                      .getService(Ci.nsIIOService2);
    ioService.offline = false;

    let browser = this.home;
    browser.homePage = this.homeSrc;
    browser.goHome();
  },

  stop: function shell_stop() {
  },

  supportsCommand: function shell_supportsCommand(cmd) {
    let isSupported = false;
    switch (cmd) {
      case "cmd_close":
        isSupported = true;
        break;
      default:
        isSupported = false;
        break;
    }    
    return isSupported;
  },

  isCommandEnabled: function shell_isCommandEnabled(cmd) {
    return true;
  },

  doCommand: function shell_doCommand(cmd) {
    switch (cmd) {
      case "cmd_close":
        let win = this.home.contentWindow;
        let evt = win.document.createEvent("UIEvents");
        evt.initUIEvent("appclose", true, true, win, 1);
        win.document.dispatchEvent(evt);
        break;
    }    
  },

  _keyPressListener: function shell_keyPressListener(e) {
    //if (e.keyCode == e.DOM_VK_HOME) {
      doCommand("cmd_close");
    //}
  }
};

window.addEventListener("keypress", shell._keyPressListener, true);
/*Cc["@mozilla.org/observer-service;1"]
  .getService(Ci.nsIObserverService)
  .addObserver(function() { shell.doCommand('cmd_close'); },
               'home-button-pressed', false);*/
