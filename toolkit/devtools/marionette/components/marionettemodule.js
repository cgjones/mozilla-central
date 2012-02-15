/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

const kMARIONETTE_CONTRACTID = "@mozilla.org/marionette;1";
const kMARIONETTE_CID = Components.ID("{786a1369-dca5-4adc-8486-33d23c88010a}");

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import('resource:///modules/marionette-logger.jsm');
MarionetteLogger.write('MarionetteModule loaded');

function MarionetteModule() {
  this._loaded = false;
}

MarionetteModule.prototype = {
  classDescription: "Marionette module",
  classID: kMARIONETTE_CID,
  contractID: kMARIONETTE_CONTRACTID,
  QueryInterface: XPCOMUtils.generateQI([Ci.nsIObserver, Ci.nsIMarionette]),
  _xpcom_categories: [{category: "profile-after-change", service: true}],

  observe: function mm_observe(aSubject, aTopic, aData) {
    let observerService = Services.obs;
    switch (aTopic) {
      case "profile-after-change":
        observerService.addObserver(this, "final-ui-startup", false);
        observerService.addObserver(this, "xpcom-shutdown", false);
        break;
      case "final-ui-startup":
        observerService.removeObserver(this, "final-ui-startup");
        this.init();
        break;
      case "xpcom-shutdown":
        observerService.removeObserver(this, "xpcom-shutdown");
        this.uninit();
        break;
    }
  },

  init: function mm_init() {
    if (!this._loaded) {
      this._loaded = true;

      try {
        //check if marionette pref exists
        Services.prefs.getBoolPref('marionette.server.enabled');
      }
      catch(e) {
        //create them, but profile must enable them
        Services.prefs.setBoolPref('marionette.server.enabled', false);
        Services.prefs.setIntPref('marionette.server.port', 2828);
      }

      try {
        let port = Services.prefs.getIntPref('marionette.server.port');
        if (Services.prefs.getBoolPref('marionette.server.enabled')) {
          Cu.import('resource:///modules/devtools/dbg-server.jsm');
          DebuggerServer.addActors('resource:///modules/marionette-actors.js');
          DebuggerServer.initTransport();
          DebuggerServer.openListener(port, true);
        }
      }
      catch(e) {
        dump('exception: ' + e.name + ', ' + e.message);
      }
    }
  },

  uninit: function mm_uninit() {
    DebuggerServer.closeListener();
    this._loaded = false;
  },

};

const NSGetFactory = XPCOMUtils.generateNSGetFactory([MarionetteModule]);
